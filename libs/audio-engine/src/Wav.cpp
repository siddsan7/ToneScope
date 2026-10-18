#include "tonescope/Engine.h"
#include <bit>
#include <cmath>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <limits>
#include <stdexcept>
#include <algorithm>
namespace tonescope {
namespace {
constexpr std::uint64_t maxBytes=256ull*1024*1024;
void fail(const char* s){throw std::runtime_error(s);}
std::uint16_t u16(const unsigned char* p){return std::uint16_t(p[0])|(std::uint16_t(p[1])<<8);}
std::uint32_t u32(const unsigned char* p){return std::uint32_t(p[0])|(std::uint32_t(p[1])<<8)|(std::uint32_t(p[2])<<16)|(std::uint32_t(p[3])<<24);}
void put16(std::ostream& f,std::uint16_t v){char b[]={char(v),char(v>>8)};f.write(b,2);}void put32(std::ostream& f,std::uint32_t v){char b[]={char(v),char(v>>8),char(v>>16),char(v>>24)};f.write(b,4);}
void check(const AudioData& a){if(a.samples.empty()||a.samples.size()>2||a.frames()<=0||!std::isfinite(a.sampleRate)||a.sampleRate<8000||a.sampleRate>192000)fail("invalid audio shape/rate");for(auto& c:a.samples){if(c.size()!=static_cast<size_t>(a.frames()))fail("unequal channel lengths");for(float x:c)if(!std::isfinite(x))fail("nonfinite audio sample");}}
}
AudioData readWav(const std::string& path){
 std::ifstream f(std::filesystem::u8path(path),std::ios::binary|std::ios::ate);if(!f)fail("cannot open WAV");auto length=f.tellg();if(length<12||static_cast<std::uint64_t>(length)>maxBytes)fail("WAV file outside 12 byte..256 MiB supported limit");std::vector<unsigned char>b(static_cast<size_t>(length));f.seekg(0);if(!f.read(reinterpret_cast<char*>(b.data()),length))fail("WAV read failed");
 if(std::memcmp(b.data(),"RIFF",4)||std::memcmp(b.data()+8,"WAVE",4)||std::uint64_t(u32(b.data()+4))+8!=b.size())fail("invalid RIFF/WAVE length or signature");
 bool fmt=false,data=false;std::uint16_t format=0,channels=0,bits=0,align=0;std::uint32_t rate=0;size_t offset=0,bytes=0;
 for(size_t pos=12;pos<b.size();){if(b.size()-pos<8)fail("truncated chunk header");auto size=u32(b.data()+pos+4);size_t body=pos+8;if(size>b.size()-body)fail("truncated WAV chunk");if(!std::memcmp(b.data()+pos,"fmt ",4)){if(fmt||size<16)fail("duplicate/short fmt");fmt=true;auto p=b.data()+body;format=u16(p);channels=u16(p+2);rate=u32(p+4);align=u16(p+12);bits=u16(p+14);if((format!=1&&format!=3)||channels<1||channels>2||rate<8000||rate>192000||(format==1&&bits!=16&&bits!=24&&bits!=32)||(format==3&&bits!=32)||align!=channels*(bits/8)||u32(p+8)!=rate*align)fail("unsupported or inconsistent WAV format");}
 else if(!std::memcmp(b.data()+pos,"data",4)){if(data)fail("duplicate data chunk");data=true;offset=body;bytes=size;}
 size_t padded=size+(size&1u);if(padded>b.size()-body)fail("missing chunk padding");pos=body+padded;}
 if(!fmt||!data||bytes==0||bytes%align)fail("missing/empty/partial WAV frames");AudioData a;a.sampleRate=rate;a.samples.assign(channels,std::vector<float>(bytes/align));
 for(size_t n=0;n<bytes/align;++n)for(int c=0;c<channels;++c){const auto p=b.data()+offset+n*align+c*(bits/8);float x;if(format==3)x=std::bit_cast<float>(u32(p));else if(bits==16)x=static_cast<float>(static_cast<std::int16_t>(u16(p))/32768.);else if(bits==24){std::int32_t v=std::int32_t(p[0])|(std::int32_t(p[1])<<8)|(std::int32_t(p[2])<<16);if(v&0x800000)v-=0x1000000;x=static_cast<float>(v/8388608.);}else x=static_cast<float>(std::bit_cast<std::int32_t>(u32(p))/2147483648.);if(!std::isfinite(x))fail("nonfinite WAV sample");a.samples[c][n]=x;}return a;
}
void writeWav(const std::string& path,const AudioData& a){check(a);if(std::floor(a.sampleRate)!=a.sampleRate)fail("WAV sample rate must be integer");auto bytes=static_cast<std::uint64_t>(a.frames())*a.samples.size()*4;if(bytes+44>maxBytes)fail("export exceeds 256 MiB supported limit");std::ofstream f(std::filesystem::u8path(path),std::ios::binary|std::ios::trunc);if(!f)fail("cannot open WAV output");f.write("RIFF",4);put32(f,static_cast<std::uint32_t>(bytes+36));f.write("WAVEfmt ",8);put32(f,16);put16(f,3);put16(f,static_cast<std::uint16_t>(a.samples.size()));put32(f,static_cast<std::uint32_t>(a.sampleRate));put32(f,static_cast<std::uint32_t>(a.sampleRate*a.samples.size()*4));put16(f,static_cast<std::uint16_t>(a.samples.size()*4));put16(f,32);f.write("data",4);put32(f,static_cast<std::uint32_t>(bytes));for(std::int64_t n=0;n<a.frames();++n)for(auto& c:a.samples)put32(f,std::bit_cast<std::uint32_t>(c[static_cast<size_t>(n)]));f.flush();if(!f)fail("WAV export failed");}
AudioData render(const AudioData& source,const Parameters& p,int block){check(source);if(block<1||block>1048576)fail("invalid render block size");std::string error;if(!validate(p,source.sampleRate,error))throw std::invalid_argument(error);AudioData out=source;Engine engine;engine.prepare(source.sampleRate,static_cast<int>(source.samples.size()));engine.setParameters(p);engine.reset();for(std::int64_t n=0;n<source.frames();n+=block){const float* in[2]{};float* dest[2]{};for(size_t c=0;c<source.samples.size();++c){in[c]=source.samples[c].data()+n;dest[c]=out.samples[c].data()+n;}engine.process(in,dest,static_cast<int>(std::min<std::int64_t>(block,source.frames()-n)));}return out;}
}
