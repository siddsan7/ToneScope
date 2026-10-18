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
#include <algorithm>
#include <complex>
#include "../../libs/audio-engine/src/Dsp.h"
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
void passageDynamicsTests() {
 auto source=sine(2049,997,.4f);Parameters p;p.compressor=p.equalizer=p.drive=true;p.thresholdDb=-30;p.ratio=4;p.lowDb=3;
 for(int factor:{1,2,4})for(bool bands:{false,true}) {
  p.oversampling=factor;p.multiband=bands;
  const auto measured=renderWithDynamics(source,p,128,17);
  require(measured.wet.samples==render(source,p,257).samples,"timeline audio exactly equals ordinary render");
  require(measured.wetLatencySamples==(factor==1?0:32),"timeline declares engine latency");
  Engine engine;engine.prepare(source.sampleRate,2,p);
  for(std::int64_t n=0;n<source.frames();++n) {
   float l=0,r=0;const float* in[]={&source.samples[0][n],&source.samples[1][n]};float* out[]={&l,&r};engine.process(in,out,1);
   if((n+1)%128==0||n+1==source.frames()) {
    const auto& frame=measured.frames[static_cast<size_t>(n/128)];
    require(frame.dry.sample==n&&frame.wet.sample==n,"timeline sample positions remain in source time");
    require(frame.gainReductionDb==engine.gainReductionDb()&&frame.bandGainReductionDb==engine.bandGainReductionDb(),"timeline gain reduction is actual DSP state");
    require(frame.wetAvailable==(n+measured.wetLatencySamples<source.frames()),"delayed output tail availability explicit");
   }
  }
  if(factor>1) {
   double energy=0,peak=0;for(int n=32;n<160;++n)for(const auto& ch:measured.wet.samples){energy+=double(ch[n])*ch[n]/2;peak=std::max(peak,std::abs(double(ch[n])));}
   require(near(measured.frames[0].wet.rms,std::sqrt(energy/128),1e-14)&&measured.frames[0].wet.samplePeak==peak,"wet frame measures delayed output at aligned source interval");
  }
 }
 p={};p.inputDb=6;p.outputDb=-12;source.samples[0][0]=20;
 const auto trimmed=renderWithDynamics(source,p,17);
 require(trimmed.dry.samples[0][0]==static_cast<float>(16*std::pow(10.,6./20)),"timeline dry uses clamp before trim");
 require(trimmed.frames[0].gainReductionDb==0&&trimmed.wet.samples!=trimmed.dry.samples,"output attenuation never masquerades as gain reduction");
 AudioData levels;levels.samples.assign(2,std::vector<float>(9600,.125f));
 for(auto& ch:levels.samples)std::fill(ch.begin()+4800,ch.end(),.5f);
 auto wet=levels;for(auto& ch:wet.samples)for(int n=4800;n<9600;++n)ch[n]*=.5f;
 const auto contrast=comparePassages(levels,wet,{0,4800},{4800,9600});
 require(contrast.valid&&contrast.contrastAvailable,"manual soft/hard comparison valid");
 require(contrast.soft.dry.rms==.125&&contrast.hard.dry.rms==.5&&contrast.hard.wet.rms==.25,"manual passage RMS exact known levels");
 require(contrast.hard.dry.crestAvailable&&contrast.hard.dry.crestDb==0,"constant signal zero crest factor");
 require(near(contrast.dryContrastDb,20*std::log10(4.),1e-12)&&near(contrast.contrastChangeDb,-20*std::log10(2.),1e-12),"measured hard soft contrast change in dB");
 AudioData step;step.samples.assign(1,std::vector<float>(14400,0));std::fill(step.samples[0].begin()+2400,step.samples[0].begin()+7200,.5f);
 const auto timing=comparePassages(step,step,{0,14400},{3000,7000});
 require(timing.valid&&timing.soft.dry.riseAvailable&&timing.soft.dry.decayAvailable,"bounded step exposes rise and decay");
 require(near(timing.soft.dry.riseMs,10*std::log(.99/.19),.03),"10 to 90 percent RMS step rise matches analytic detector law");
 require(near(timing.soft.dry.decayMs,20*std::log(9.),.03),"90 to 10 percent RMS decay matches analytic detector law");
 require(!timing.hard.dry.riseAvailable&&!timing.hard.dry.decayAvailable,"selection preserves prior envelope history");
 auto ramp=step;for(size_t n=0;n<ramp.samples[0].size();++n)ramp.samples[0][n]=static_cast<float>(n/double(ramp.frames()));
 const auto rampMetrics=comparePassages(ramp,ramp,{0,ramp.frames()},{0,ramp.frames()});
 require(rampMetrics.soft.dry.riseAvailable&&!rampMetrics.soft.dry.decayAvailable&&rampMetrics.soft.dry.riseMs>100,"ramp descriptive rise has no invented decay");
 auto silent=step;std::fill(silent.samples[0].begin(),silent.samples[0].end(),0);
 const auto silence=comparePassages(silent,silent,{0,100},{100,200});
 require(silence.valid&&!silence.contrastAvailable&&!silence.soft.rmsChangeAvailable&&!silence.soft.dry.crestAvailable&&!silence.soft.dry.riseAvailable,"silence has explicit unavailable ratios/timing");
 require(!comparePassages(step,step,{-1,100},{0,100}).valid&&!comparePassages(step,step,{0,1},{0,100}).valid&&!comparePassages(step,step,{0,100},{0,step.frames()},32).valid,"invalid or unavailable aligned selections rejected");
 bool rejected=false;try{renderWithDynamics(step,{},0);}catch(const std::invalid_argument&){rejected=true;}require(rejected,"timeline rejects zero hop");
 step.samples[0][0]=std::numeric_limits<float>::quiet_NaN();
 require(!comparePassages(step,step,{0,100},{100,200}).valid,"nonfinite passage rejected");
 rejected=false;try{renderWithDynamics(step,{});}catch(const std::invalid_argument&){rejected=true;}require(rejected,"timeline finite input matches render policy");
}
void faustStageTests() {
 // Independent scalar compressor definition, including soft-knee boundaries,
 // detector decay, attack/release switching and ratio-one identity.
 for(double sr:{44100.,48000.,96000.})for(double knee:{0.,6.,24.})for(double ratio:{1.,4.,20.}) {
  double detector=0,reduction=0,referenceDetector=0,referenceReduction=0;
  for(int n=0;n<6000;++n) {
   const double level=n<2000?.02:n<4000?.8:0.;
   const double energy=level*level,threshold=-24.,attack=.1,release=100.;
   const double c=std::exp(-1/(.010*sr));
   referenceDetector=c*referenceDetector+(1-c)*energy;
   const double over=10*std::log10(std::max(referenceDetector,1e-30))-threshold,slope=1-1/ratio;
   double target=0;
   if(knee>0&&over>-knee/2&&over<knee/2)target=slope*(over+knee/2)*(over+knee/2)/(2*knee);
   else if(over>=knee/2)target=slope*over;
   const double ms=target>referenceReduction?attack:release,a=std::exp(-1/(ms*.001*sr));
   referenceReduction=a*referenceReduction+(1-a)*target;
   const double actual=detail::compressorStep(energy,detector,reduction,sr,threshold,ratio,attack,release,knee,0);
   require(near(detector,referenceDetector,2e-13),"Faust RMS detector matches independent recurrence");
   require(near(reduction,referenceReduction,2e-10),"Faust soft knee and ballistics match independent recurrence");
   require(near(actual,std::pow(10.,-referenceReduction/20),2e-11),"Faust compressor gain matches independent recurrence");
   if(ratio==1)require(actual==1,"Faust ratio-one exact identity");
  }
 }
 // RBJ design invariants independently constrain gain and stability.
 for(double sr:{44100.,48000.,96000.})for(int kind:{0,1,2})for(double db:{-18.,0.,18.})for(double q:{.2,1.,10.}) {
  double b0,b1,b2,a1,a2;
  const double hz=kind==0?120.:kind==1?1700.:6000.;
  detail::eqCoefficients(kind,hz,q,db,sr,b0,b1,b2,a1,a2);
  require(std::abs(a2)<1&&1+a1+a2>0&&1-a1+a2>0,"Faust EQ coefficient poles stay inside unit circle");
  auto response=[&](double f) {
   const auto z=std::polar(1.,-2*detail::pi*f/sr);
   return std::abs((b0+b1*z+b2*z*z)/(1.+a1*z+a2*z*z));
  };
  const double target=std::pow(10.,db/20);
  require(near(response(kind==0?0.:kind==1?hz:sr/2),target,2e-10),"Faust EQ prescribed shelf/center gain");
  if(kind!=1)require(near(response(kind==0?sr/2:0.),1.,2e-10),"Faust EQ opposite shelf endpoint unity");
 }
 // Verify the generated filter consumes and returns the actual recursive state.
 double z1=0,z2=0,reference1=0,reference2=0;
 for(int n=0;n<10000;++n) {
  const double x=std::sin(n*.73),y=.8*x+reference1;
  reference1=.2*x-(-.3)*y+reference2;reference2=.1*x-.2*y;
  const double actual=detail::biquadStep(x,z1,z2,.8,.2,.1,-.3,.2);
  require(near(actual,y,2e-14)&&near(z1,reference1,2e-14)&&near(z2,reference2,2e-14),"Faust transposed biquad agrees with scalar state oracle");
 }
 auto source=sine(2048,997,.7f);
 Parameters p;p.compressor=p.equalizer=true;p.thresholdDb=-24;p.ratio=4;p.kneeDb=6;p.lowDb=6;p.midDb=-4;p.highDb=3;
 for(double sr:{44100.,48000.,96000.})for(bool multiband:{false,true}) {
  source.sampleRate=sr;p.multiband=multiband;p.order={0,1,2};
  do {
   const auto expected=render(source,p,128);
   for(int block:{1,17,63,257,512,1024})require(expected.samples==render(source,p,block).samples,"Faust EQ/compressor all orders are block invariant");
  }while(std::next_permutation(p.order.begin(),p.order.end()));
  Engine engine;engine.prepare(sr,2,p);
  float left[257]{},right[257]{};const float* in[]={left,right};float* out[]={left,right};
  allocationCount=0;trackAllocations=true;
  engine.process(in,out,257);
  auto changed=p;changed.lowDb=-8;changed.attackMs=40;
  const bool accepted=engine.setParametersRealtime(changed);
  engine.process(in,out,257);
  trackAllocations=false;
  require(accepted&&allocationCount==0,"Faust coefficient refresh and compressor callback allocate nothing");
 }
}
void microscopeTests() {
 Parameters p;p.drive=true;
 auto source=sine(8192,997,.2f);
 for(int factor:{1,2,4}) {
  p.oversampling=factor;
  Engine engine;engine.prepare(48000,2);engine.setParameters(p);engine.reset();
  require(engine.latencySamples()==(factor==1?0:32),"declared integer oversampling latency");
  const auto fixed=render(source,p,128);
  for(int block:{1,17,63,257,512,1024})require(fixed.samples==render(source,p,block).samples,"oversampled sample state independent of blocks");
  float left[17]{},right[17]{};const float* in[]={left,right};float* out[]={left,right};
  allocationCount=0;trackAllocations=true;engine.process(in,out,17);trackAllocations=false;
  require(allocationCount==0,"oversampled callback allocates nothing");
  auto changed=p;changed.oversampling=factor==1?2:1;
  require(!engine.setParametersRealtime(changed),"delay change rejected by realtime setter");
 }
 for(int factor:{2,4}) {
  detail::Fir up,down;up.prepare(factor);down.prepare(factor);
  std::vector<double> impulse(100);
  for(int n=0;n<100;++n)for(int phase=0;phase<factor;++phase) {
   const auto filtered=down.tick(up.tick(n==0&&phase==0?double(factor):0.));
   if(phase==0)impulse[n]=filtered;
  }
  require(std::max_element(impulse.begin(),impulse.end())-impulse.begin()==32,"FIR pair impulse peak matches declared delay");
  for(int n=0;n<32;++n)require(near(impulse[n],impulse[64-n],1e-13),"FIR pair symmetric phase");
 }
 p={};p.compressor=p.multiband=true;p.ratio=1;
 for(double sr:{44100.,48000.,96000.}) {
  auto impulse=source;impulse.sampleRate=sr;
  for(auto& channel:impulse.samples) {std::fill(channel.begin(),channel.end(),0.f);channel[0]=1.f;}
  const auto wet=render(impulse,p,17),reference=crossoverReference(impulse,p);
  require(compare(reference,wet,0,wet.frames(),false).residualRms<1e-9,"neutral compressor nulls against crossover phase reference");
  require(compare(impulse,wet,0,wet.frames(),false).residualRms>1e-3,"raw dry retains crossover coloration");
  // Independent complex response from analog Butterworth via bilinear transform.
  for(double hz:{30.,80.,200.,600.,2000.,6000.,12000.,17600.}) {
   if(hz>.4*sr)continue;
   std::complex<double> measured{};
   for(size_t n=0;n<wet.samples[0].size();++n)measured+=double(wet.samples[0][n])*std::polar(1.,-2*detail::pi*hz*n/sr);
   auto allpass=[&](double cutoff) {
    const std::complex<double> s(0,std::tan(detail::pi*hz/sr)/std::tan(detail::pi*cutoff/sr));
    const auto denominator=s*s+std::sqrt(2.)*s+1.;
    return (std::pow(s,4)+1.)/(denominator*denominator);
   };
   const auto expected=allpass(p.crossoverLowHz)*allpass(p.crossoverHighHz);
   require(std::abs(measured-expected)<1e-6,"crossover complex phase agrees with independent transfer function");
   require(std::abs(20*std::log10(std::abs(measured)))<.001,"neutral crossover magnitude flat");
  }
 }
 p.ratio=4;auto wet=render(source,p,17);
 require(wet.samples==render(source,p,257).samples,"multiband block invariance");
 require(wet.samples[0][7001]==-wet.samples[1][7001],"multiband stereo linked");
 auto delayed=source;for(auto& ch:delayed.samples){ch.insert(ch.begin(),32,0);}
 require(compareAligned(source,delayed,0,source.frames(),false,32).residualRms==0,"aligned identity exact null");
 const auto residual=alignedResidual(source,delayed,32);
 require(residual.frames()==source.frames(),"residual source-time length");
 for(const auto& ch:residual.samples)for(float x:ch)require(x==0,"aligned residual zero");
 for(auto band:{AuditionBand::full,AuditionBand::low,AuditionBand::mid,AuditionBand::high}) {
  const auto pair=auditionPair(source,source,band);
  require(pair.dry.samples==pair.wet.samples,"same-band branch state gives exact identity null");
  if(band==AuditionBand::full)require(pair.dry.samples==source.samples,"full band bypass exact");
 }
 auto constant=source;for(auto& ch:constant.samples)std::fill(ch.begin(),ch.end(),.5f);
 auto envelope=dynamics(constant,512);
 require(near(envelope[0].rms,.5,1e-12)&&envelope[0].samplePeak==.5,"dynamics stereo RMS and sample peak");
 require(near(envelope[0].envelopeRms,.5*std::sqrt(1-std::exp(-512./480.)),1e-12),"10ms envelope exact step convention");
 require(envelope.back().sample==constant.frames()-1,"dynamics timestamps source samples");
 p={};p.oversampling=3;std::string error;require(!validate(p,48000,error),"unsupported oversampling rejected");
 p={};p.crossoverHighHz=300;require(!validate(p,48000,error),"crossover minimum octave spacing");
}
int main(){try {
 {auto tiny=sine(4);require(!compare(tiny,tiny,1,std::numeric_limits<std::int64_t>::min(),false).valid,"reverse extreme interval rejected before subtraction");require(!compareAligned(tiny,tiny,1,std::numeric_limits<std::int64_t>::min(),false,0).valid,"aligned reverse extreme interval rejected before subtraction");}

 AudioData lowRate;lowRate.sampleRate=8000;lowRate.samples={{.125f,.25f,-.5f}};Parameters lowParams;lowParams.toneHz=3200;require(render(lowRate,lowParams).samples==lowRate.samples,"explicit valid low-rate configuration prepares without default-frequency rejection");

 passageDynamicsTests();
 faustStageTests();
 microscopeTests();
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

