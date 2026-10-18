#include "tonescope/Engine.h"
#include <cmath>
#include <atomic>
#include <cstdlib>
#include <new>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>
namespace {std::atomic<bool> trackAllocations{false};std::atomic<unsigned long long> allocationCount{0};}
void* operator new(std::size_t n){if(trackAllocations)++allocationCount;if(void* p=std::malloc(n?n:1))return p;throw std::bad_alloc();}
void* operator new[](std::size_t n){return ::operator new(n);}
void operator delete(void* p) noexcept {std::free(p);}void operator delete[](void* p) noexcept {std::free(p);}
void operator delete(void* p,std::size_t) noexcept {std::free(p);}void operator delete[](void* p,std::size_t) noexcept {std::free(p);}
using namespace tonescope;
namespace {void require(bool ok,const char* text){if(!ok)throw std::runtime_error(text);}bool near(double a,double b,double t){return std::abs(a-b)<=t;}AudioData sine(int frames=96000,double frequency=1000,float amplitude=.5f){AudioData a;a.samples.assign(2,std::vector<float>(frames));for(int n=0;n<frames;++n){a.samples[0][n]=float(amplitude*std::sin(2*3.14159265358979323846*frequency*n/a.sampleRate));a.samples[1][n]=-a.samples[0][n];}return a;}
void put(std::ofstream& f,unsigned value,int bytes){for(int i=0;i<bytes;++i)f.put(char(value>>(8*i)));}
void fixture(const std::filesystem::path& path,int format,int bits){std::ofstream f(path,std::ios::binary);int count=bits/8;int data=count*2;f.write("RIFF",4);put(f,36+data,4);f.write("WAVEfmt ",8);put(f,16,4);put(f,format,2);put(f,1,2);put(f,48000,4);put(f,48000*count,4);put(f,count,2);put(f,bits,2);f.write("data",4);put(f,data,4);put(f,0, count);unsigned v=bits==16?0xc000:bits==24?0xc00000:0xc0000000;put(f,v,count);}
}
int main(){try {
 Parameters p;std::string error;require(validate(p,48000,error),"defaults valid");p.ratio=std::numeric_limits<float>::quiet_NaN();require(!validate(p,48000,error),"NaN rejected");p={};p.order={0,0,2};require(!validate(p,48000,error),"duplicate stage rejected");p={};p.midHz=20000;require(!validate(p,44100,error),"Nyquist parameter rejected");
 auto a=sine();p={};auto unity=render(a,p,17);require(unity.samples==a.samples,"unity identity");p.compressor=true;p.ratio=1;require(render(a,p,257).samples==a.samples,"ratio one identity");p.ratio=4;p.thresholdDb=-18;p.releaseMs=150;auto compressed=render(a,p,1);require(compressed.samples==render(a,p,257).samples,"block invariance");auto measurement=compare(a,compressed,72000,96000,false);require(measurement.valid,"compressor comparison");double gr=20*std::log10(measurement.dryRms/measurement.wetRms);require(gr>6.6&&gr<6.9,"linked RMS steady compressor oracle");require(compressed.samples[0][90001]==-compressed.samples[1][90001],"stereo link preserves polarity");
 p={};p.equalizer=true;p.midDb=6;auto eq=render(a,p);measurement=compare(a,eq,72000,96000,false);require(near(20*std::log10(measurement.wetRms/measurement.dryRms),6,.04),"bell center gain");
 p={};p.drive=true;auto drive=render(a,p);require(drive.samples==render(a,p,63).samples,"drive block invariance");for(auto& ch:drive.samples)for(float x:ch)require(std::isfinite(x)&&std::abs(x)<2,"drive finite bounded");
 auto louder=a;for(auto& ch:louder.samples)for(float& x:ch)x*=2;auto cmp=compare(a,louder,0,a.frames(),true);require(cmp.valid&&near(cmp.gain,.5,1e-12)&&cmp.residualRms<1e-12,"RMS match gain oracle");for(auto& ch:louder.samples)for(float& x:ch)x*=100;cmp=compare(a,louder,0,a.frames(),true);require(cmp.valid&&cmp.gainCapped&&near(cmp.gain,std::pow(10.,-.6),1e-12),"RMS match cap");auto silence=a;for(auto& ch:silence.samples)for(float& x:ch)x=0;require(!compare(silence,silence,0,silence.frames(),true).valid,"silence match invalid");require(compare(silence,silence,0,silence.frames(),false).valid,"silence raw valid");
 auto tone=sine(2048,48000.*64/2048,.5f);tone.samples.resize(1);auto spectrumBins=spectrum(tone,0);require(near(spectrumBins[64],.5,1e-6),"FFT coherent amplitude");require(spectrumBins[60]<1e-6,"FFT leakage away from Hann lobe");
 auto phaseTone=sine(2048,48000.*64/2048,.5f);auto phaseBins=spectrum(phaseTone,0);require(near(phaseBins[64],.5,1e-6),"anti-phase stereo retains spectral energy");
 Engine realtime;realtime.prepare(48000,1);Parameters bad;bad.ratio=std::numeric_limits<float>::quiet_NaN();allocationCount=0;trackAllocations=true;bool accepted=realtime.setParametersRealtime(bad);trackAllocations=false;require(!accepted && allocationCount==0,"realtime rejection allocates nothing");
 Engine engine;engine.prepare(48000,1);float invalid[]={std::numeric_limits<float>::quiet_NaN(),std::numeric_limits<float>::infinity(),100,-100};float output[4];const float* in[]={invalid};float* out[]={output};engine.process(in,out,4);require(engine.invalidSamples()==4&&output[0]==0&&output[1]==0&&output[2]==16&&output[3]==-16,"ingress sanitation");
  Parameters extreme;extreme.compressor=extreme.equalizer=extreme.drive=true;extreme.inputDb=24;extreme.thresholdDb=-60;extreme.ratio=20;extreme.attackMs=.1f;extreme.releaseMs=2000;extreme.kneeDb=24;extreme.makeupDb=24;extreme.lowDb=extreme.midDb=extreme.highDb=18;extreme.midQ=10;extreme.driveDb=36;extreme.outputDb=24;
 for(double rate:{44100.,48000.,96000.}){Engine stress;stress.prepare(rate,1);stress.setParameters(extreme);stress.reset();float samples[1024],result[1024];for(int i=0;i<1024;++i)samples[i]=(i&1)?16.f:-16.f;const float* src[]={samples};float* dst[]={result};allocationCount=0;trackAllocations=true;for(int pass=0;pass<100;++pass)stress.process(src,dst,1024);trackAllocations=false;require(allocationCount==0,"callback allocation free");for(float x:result)require(std::isfinite(x),"extreme valid control output finite");}
 auto path=std::filesystem::temp_directory_path()/"tonescope-core-test.wav";writeWav(path.string(),a);auto roundtrip=readWav(path.string());require(a.samples==roundtrip.samples,"float WAV exact roundtrip");for(int bits:{16,24,32}){fixture(path,1,bits);auto pcm=readWav(path.string());require(pcm.frames()==2&&pcm.samples[0][0]==0&&pcm.samples[0][1]==-.5f,"PCM signed decode");}std::ofstream(path,std::ios::binary).write("RIFF",4);bool rejected=false;try{readWav(path.string());}catch(const std::exception&){rejected=true;}require(rejected,"truncated WAV rejected");std::filesystem::remove(path);
 std::cout<<"native core tests passed\n";return 0;
 }catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}

