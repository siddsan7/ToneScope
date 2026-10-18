#include <tonescope/Streaming.h>
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>

namespace tonescope {
namespace {
constexpr std::uint64_t byteLimit=2ull*1024*1024*1024;
constexpr int chunkFrames=1024;
auto path(const std::string& s) { return std::filesystem::path(std::u8string(s.begin(),s.end())); }
[[noreturn]] void fail(const char* reason) { throw std::runtime_error(reason); }
std::uint16_t u16(const unsigned char* p) { return std::uint16_t(p[0])|(std::uint16_t(p[1])<<8); }
std::uint32_t u32(const unsigned char* p) { return std::uint32_t(p[0])|(std::uint32_t(p[1])<<8)|(std::uint32_t(p[2])<<16)|(std::uint32_t(p[3])<<24); }
void put16(std::ostream& f,std::uint16_t v) { char b[]{char(v),char(v>>8)};f.write(b,2); }
void put32(std::ostream& f,std::uint32_t v) { char b[]{char(v),char(v>>8),char(v>>16),char(v>>24)};f.write(b,4); }
}
struct WavStreamReader::Impl {
    std::ifstream file;
    WavInfo info;
    std::uint64_t dataOffset=0,dataBytes=0;
    std::int64_t at=0;
    int format=0,align=0;
    std::array<unsigned char,chunkFrames*2*4> scratch{};
};
WavStreamReader::WavStreamReader(const std::string& name):impl(std::make_unique<Impl>()) {
    auto& d=*impl;d.file.open(path(name),std::ios::binary|std::ios::ate);
    if(!d.file) fail("Cannot open WAV stream");
    auto end=d.file.tellg();
    if(end<12 || static_cast<std::uint64_t>(end)>byteLimit) fail("WAV stream exceeds RIFF/2 GiB supported bounds");
    const auto length=static_cast<std::uint64_t>(end);
    std::array<unsigned char,24> header{};
    auto get=[&](std::uint64_t offset,size_t count) {
        if(count>header.size() || offset>length || count>length-offset) fail("Truncated WAV stream metadata");
        d.file.seekg(static_cast<std::streamoff>(offset));
        if(!d.file.read(reinterpret_cast<char*>(header.data()),static_cast<std::streamsize>(count))) fail("WAV stream read failed");
    };
    get(0,12);
    if(std::memcmp(header.data(),"RIFF",4)||std::memcmp(header.data()+8,"WAVE",4)||std::uint64_t(u32(header.data()+4))+8!=length) fail("Invalid RIFF/WAVE stream header");
    bool formatFound=false,dataFound=false;
    int chunks=0;
    for(std::uint64_t offset=12;offset<length;) {
        if(++chunks>16384) fail("WAV stream metadata chunk count exceeds supported bound");
        get(offset,8);const auto size=u32(header.data()+4);const auto body=offset+8;
        if(size>length-body) fail("WAV stream chunk exceeds file bounds");
        const bool isFormat=std::memcmp(header.data(),"fmt ",4)==0;
        const bool isData=std::memcmp(header.data(),"data",4)==0;
        if(isFormat) {
            if(formatFound || size<16) fail("Duplicate or short WAV format chunk");
            get(body,16);formatFound=true;
            d.format=u16(header.data());d.info.channels=u16(header.data()+2);
            const auto rate=u32(header.data()+4),byteRate=u32(header.data()+8);
            d.align=u16(header.data()+12);d.info.bits=u16(header.data()+14);d.info.sampleRate=rate;
            d.info.floatingPoint=d.format==3;
            if((d.format!=1 && d.format!=3)||d.info.channels<1||d.info.channels>2||rate<8000||rate>192000||
               (d.format==1 && d.info.bits!=16 && d.info.bits!=24 && d.info.bits!=32)||
               (d.format==3 && d.info.bits!=32)||d.align!=d.info.channels*(d.info.bits/8)||byteRate!=rate*d.align) fail("Unsupported or inconsistent WAV stream format");
        } else if(isData) {
            if(dataFound) fail("Duplicate WAV stream data chunk");
            dataFound=true;d.dataOffset=body;d.dataBytes=size;
        }
        const auto padded=std::uint64_t(size)+(size&1u);
        if(padded>length-body) fail("Missing WAV stream chunk padding");
        offset=body+padded;
    }
    if(!formatFound||!dataFound||d.dataBytes==0||d.dataBytes%d.align) fail("Missing/empty/partial WAV stream samples");
    d.info.frames=static_cast<std::int64_t>(d.dataBytes/d.align);
    if(d.info.frames/d.info.sampleRate>7200) fail("WAV stream exceeds two-hour duration bound");
    seek(0);
}
WavStreamReader::~WavStreamReader()=default;
const WavInfo& WavStreamReader::info() const noexcept { return impl->info; }
std::int64_t WavStreamReader::position() const noexcept { return impl->at; }
void WavStreamReader::seek(std::int64_t frame) {
    auto& d=*impl;
    if(frame<0||frame>d.info.frames) fail("WAV stream seek outside source");
    d.file.clear();d.file.seekg(static_cast<std::streamoff>(d.dataOffset+frame*d.align));
    if(!d.file) fail("WAV stream seek failed");
    d.at=frame;
}
int WavStreamReader::read(float* const* output,int frames) {
    auto& d=*impl;
    if(frames<0||frames>65536||!output) fail("Invalid bounded WAV stream read");
    for(int c=0;c<d.info.channels;++c) if(!output[c]) fail("Null WAV stream destination");
    const auto wanted=static_cast<int>(std::min<std::int64_t>(frames,d.info.frames-d.at));
    for(int offset=0;offset<wanted;offset+=chunkFrames) {
        const int count=std::min(chunkFrames,wanted-offset),bytes=count*d.align;
        if(!d.file.read(reinterpret_cast<char*>(d.scratch.data()),bytes)) fail("WAV stream changed or truncated during read");
        for(int i=0;i<count;++i) for(int c=0;c<d.info.channels;++c) {
            const auto* p=d.scratch.data()+i*d.align+c*(d.info.bits/8);float value=0;
            if(d.format==3) value=std::bit_cast<float>(u32(p));
            else if(d.info.bits==16) value=static_cast<float>(static_cast<std::int16_t>(u16(p))/32768.);
            else if(d.info.bits==24) { int v=p[0]|(int(p[1])<<8)|(int(p[2])<<16);if(v&0x800000)v-=0x1000000;value=static_cast<float>(v/8388608.); }
            else value=static_cast<float>(std::bit_cast<std::int32_t>(u32(p))/2147483648.);
            if(!std::isfinite(value)) fail("Nonfinite WAV stream sample");
            output[c][offset+i]=value;
        }
    }
    for(int c=0;c<d.info.channels;++c) std::fill(output[c]+wanted,output[c]+frames,0.f);
    d.at+=wanted;return wanted;
}
struct WavStreamWriter::Impl {
    std::ofstream file;std::int64_t count=0;int channels=0;std::uint32_t rate=0;bool finished=false;
    std::array<unsigned char,chunkFrames*2*4> scratch{};
};
WavStreamWriter::WavStreamWriter(const std::string& name,double rate,int channels):impl(std::make_unique<Impl>()) {
    auto& d=*impl;
    if(!std::isfinite(rate)||rate<8000||rate>192000||rate!=std::floor(rate)||channels<1||channels>2) fail("Invalid WAV stream output format");
    if(std::filesystem::exists(path(name))) fail("WAV stream output already exists");
    d.file.open(path(name),std::ios::binary|std::ios::trunc);d.rate=static_cast<std::uint32_t>(rate);d.channels=channels;
    if(!d.file) fail("Cannot create WAV stream output");
    d.file.write("RIFF",4);put32(d.file,36);d.file.write("WAVEfmt ",8);put32(d.file,16);
    put16(d.file,3);put16(d.file,static_cast<std::uint16_t>(channels));put32(d.file,d.rate);
    put32(d.file,d.rate*channels*4);put16(d.file,static_cast<std::uint16_t>(channels*4));put16(d.file,32);
    d.file.write("data",4);put32(d.file,0);
    if(!d.file) fail("WAV stream header write failed");
}
WavStreamWriter::~WavStreamWriter()=default;
std::int64_t WavStreamWriter::frames() const noexcept { return impl->count; }
void WavStreamWriter::write(const float* const* input,int frames) {
    auto& d=*impl;
    if(d.finished||frames<0||frames>65536||!input) fail("Invalid bounded WAV stream write");
    if((std::uint64_t(d.count)+frames)*d.channels*4+44>byteLimit) fail("WAV recording/export reached 2 GiB limit");
    if(double(d.count+frames)/d.rate>7200) fail("WAV recording/export reached two-hour limit");
    for(int c=0;c<d.channels;++c) { if(!input[c]) fail("Null WAV stream input");for(int i=0;i<frames;++i) if(!std::isfinite(input[c][i])) fail("Nonfinite WAV stream output"); }
    for(int offset=0;offset<frames;offset+=chunkFrames) {
        int count=std::min(chunkFrames,frames-offset);
        for(int i=0;i<count;++i)for(int c=0;c<d.channels;++c) {
            auto value=std::bit_cast<std::uint32_t>(input[c][offset+i]);auto* p=d.scratch.data()+(i*d.channels+c)*4;
            for(int b=0;b<4;++b)p[b]=static_cast<unsigned char>(value>>(b*8));
        }
        d.file.write(reinterpret_cast<const char*>(d.scratch.data()),count*d.channels*4);
        if(!d.file) fail("WAV stream write failed; take is incomplete");
        d.count+=count;
    }
}
void WavStreamWriter::finish() {
    auto& d=*impl;
    if(d.finished)return;
    if(d.count==0) fail("Cannot finalize an empty WAV stream");
    const auto bytes=static_cast<std::uint32_t>(d.count*d.channels*4);
    d.file.seekp(4);put32(d.file,bytes+36);d.file.seekp(40);put32(d.file,bytes);d.file.flush();
    if(!d.file) fail("WAV stream finalization failed; take is incomplete");
    d.file.close();d.finished=true;
}
}
