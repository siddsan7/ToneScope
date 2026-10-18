#include "tonescope/Engine.h"
#include "../../audio-engine/src/Dsp.h"
#include <algorithm>
#include <cmath>
#include <complex>
#include <stdexcept>
#include <limits>
namespace tonescope {
namespace {constexpr double pi=3.14159265358979323846;
bool shape(const AudioData& a){if(a.samples.empty()||a.samples.size()>2||a.frames()<=0||!std::isfinite(a.sampleRate)||a.sampleRate<8000||a.sampleRate>192000)return false;for(auto& c:a.samples)if(c.size()!=static_cast<size_t>(a.frames()))return false;return true;}}
namespace {
void requirePair(const AudioData& dry,const AudioData& wet) {
 if(!shape(dry)||!shape(wet)||dry.sampleRate!=wet.sampleRate||dry.samples.size()!=wet.samples.size())
  throw std::invalid_argument("comparison requires matching rates and channels");
 for(const auto* audio:{&dry,&wet})for(const auto& channel:audio->samples)for(float x:channel)
  if(!std::isfinite(x))throw std::invalid_argument("nonfinite comparison sample");
}
}
Comparison compareAligned(const AudioData& dry,const AudioData& wet,std::int64_t start,std::int64_t end,bool match,int latency) {
 Comparison invalid;
 if(!shape(dry)||!shape(wet)||latency<0||start<0||end<start||end>dry.frames()||end-start<2||end>wet.frames()-latency)return invalid;
 if(dry.sampleRate!=wet.sampleRate||dry.samples.size()!=wet.samples.size())return invalid;
 // Copy the selected, aligned interval only. Offline API; never called by Engine.
 AudioData a,b;a.sampleRate=b.sampleRate=dry.sampleRate;
 for(size_t c=0;c<dry.samples.size();++c) {
  a.samples.emplace_back(dry.samples[c].begin()+start,dry.samples[c].begin()+end);
  b.samples.emplace_back(wet.samples[c].begin()+start+latency,wet.samples[c].begin()+end+latency);
 }
 return compare(a,b,0,end-start,match);
}
AudioData alignedResidual(const AudioData& dry,const AudioData& wet,int latency,double wetGain) {
 requirePair(dry,wet);
 if(latency<0||latency>=wet.frames()||!std::isfinite(wetGain)||wetGain<0||wetGain>std::pow(10.,.6))
  throw std::invalid_argument("invalid residual latency or gain (0..+12 dB)");
 const auto frames=std::min(dry.frames(),wet.frames()-latency);
 AudioData out;out.sampleRate=dry.sampleRate;out.samples.assign(dry.samples.size(),std::vector<float>(static_cast<size_t>(frames)));
 for(size_t c=0;c<out.samples.size();++c)for(std::int64_t n=0;n<frames;++n) {
  const double delta=wetGain*wet.samples[c][n+latency]-dry.samples[c][n];
  if(!std::isfinite(delta)||std::abs(delta)>std::numeric_limits<float>::max())throw std::invalid_argument("residual exceeds float domain");
  out.samples[c][n]=static_cast<float>(delta);
 }
 return out;
}
AuditionPair auditionPair(const AudioData& dry,const AudioData& wet,AuditionBand band,double low,double high) {
 requirePair(dry,wet);
 if(dry.frames()!=wet.frames()||!std::isfinite(low)||!std::isfinite(high)||low<20||high<2*low||high>.45*dry.sampleRate)
  throw std::invalid_argument("invalid audition shape or crossover frequencies");
 if(band!=AuditionBand::full&&band!=AuditionBand::low&&band!=AuditionBand::mid&&band!=AuditionBand::high)
  throw std::invalid_argument("unknown audition band");
 AuditionPair pair{dry,wet};
 if(band==AuditionBand::full)return pair;
 // Independent zeroed states with identical coefficients and full source history.
 for(auto* audio:{&pair.dry,&pair.wet})for(auto& channel:audio->samples) {
  detail::ThreeBand filters;filters.prepare(low,high,audio->sampleRate);
  const int index=band==AuditionBand::low?0:band==AuditionBand::mid?1:2;
  for(float& sample:channel)sample=static_cast<float>(filters.tick(sample)[index]);
 }
 return pair;
}
AudioData crossoverReference(const AudioData& source,const Parameters& p) {
 std::string error;
 if(!shape(source)||!validate(p,source.sampleRate,error))throw std::invalid_argument("invalid crossover reference input/parameters");
 AudioData out=source;
 const double trim=std::pow(10.,p.inputDb/20.);
 for(auto& channel:out.samples) {
  detail::ThreeBand filters;filters.prepare(p.crossoverLowHz,p.crossoverHighHz,out.sampleRate);
  for(float& sample:channel) {
   const double input=std::isfinite(sample)?std::clamp(double(sample),-16.,16.):0.;
   const auto bands=filters.tick(input*trim);
   sample=static_cast<float>(bands[0]+bands[1]+bands[2]);
  }
 }
 return out;
}
namespace {
std::vector<DynamicsFrame> dynamicsOffset(const AudioData& source,int hop,int offset,double initialEnergy=0) {
 if(!shape(source)||hop<1||hop>1048576||offset<0||!std::isfinite(initialEnergy)||initialEnergy<0)throw std::invalid_argument("invalid dynamics input/hop");
 std::vector<DynamicsFrame> frames;
 const double a=std::exp(-1/(.010*source.sampleRate));
 double envelope=initialEnergy,energy=0,peak=0;int count=0;
 for(std::int64_t n=0;n<source.frames();++n) {
  double linked=0,instantPeak=0;
  for(const auto& channel:source.samples) {
   const double x=channel[n];if(!std::isfinite(x))throw std::invalid_argument("nonfinite dynamics sample");
   linked+=x*x/source.samples.size();instantPeak=std::max(instantPeak,std::abs(x));
  }
  envelope=a*envelope+(1-a)*linked;
  if(n<offset)continue;
  energy+=linked;peak=std::max(peak,instantPeak);++count;
  if(count==hop||n+1==source.frames()) {
   frames.push_back({n-offset,std::sqrt(energy/count),peak,std::sqrt(envelope)});
   energy=peak=0;count=0;
  }
 }
 return frames;
}
PassageSignalMetrics passageSignal(const AudioData& source,SampleInterval interval,int offset,double initialEnergy) {
 PassageSignalMetrics m;
 const auto start=interval.start+offset,end=interval.end+offset;
 const double a=std::exp(-1/(.010*source.sampleRate));
 double envelope=initialEnergy,energy=0;std::int64_t peakAt=start;
 for(std::int64_t n=0;n<end;++n) {
  double linked=0,peak=0;
  for(const auto& channel:source.samples) {const double x=channel[n];linked+=x*x/source.samples.size();peak=std::max(peak,std::abs(x));}
  envelope=a*envelope+(1-a)*linked;
  if(n<start)continue;
  energy+=linked;m.samplePeak=std::max(m.samplePeak,peak);
  const double rms=std::sqrt(envelope);
  if(rms>m.envelopePeak) {m.envelopePeak=rms;peakAt=n;}
 }
 m.rms=std::sqrt(energy/(end-start));
 m.crestAvailable=m.rms>=1e-9;
 if(m.crestAvailable)m.crestDb=20*std::log10(m.samplePeak/m.rms);
 if(m.envelopePeak<1e-9)return m;
 // Full-history detector, then interpolated threshold crossings wholly inside
 // the manually selected interval. Pre-existing energy is never reset at start.
 envelope=initialEnergy;double prior=std::sqrt(initialEnergy),riseLow=-1,riseHigh=-1,decayHigh=-1,decayLow=-1;
 const double low=.1*m.envelopePeak,high=.9*m.envelopePeak;
 auto crossing=[](std::int64_t n,double before,double after,double threshold) {
  return double(n-1)+(threshold-before)/(after-before);
 };
 for(std::int64_t n=0;n<end;++n) {
  double linked=0;for(const auto& channel:source.samples){const double x=channel[n];linked+=x*x/source.samples.size();}
  envelope=a*envelope+(1-a)*linked;const double current=std::sqrt(envelope);
  if(n>=start) {
   // Include the supplied detector state immediately before window sample zero.
   const bool boundaryAvailable=n>start||start==0;
   if(boundaryAvailable&&n<=peakAt) {
    if(riseLow<0&&prior<low&&current>=low)riseLow=crossing(n,prior,current,low)+1;
    if(riseLow>=0&&riseHigh<0&&prior<high&&current>=high)riseHigh=crossing(n,prior,current,high)+1;
   }
   if(n>peakAt) {
    if(decayHigh<0&&prior>high&&current<=high)decayHigh=crossing(n,prior,current,high)+1;
    if(decayHigh>=0&&decayLow<0&&prior>low&&current<=low)decayLow=crossing(n,prior,current,low)+1;
   }
  }
  prior=current;
 }
 m.riseAvailable=riseLow>=0&&riseHigh>=riseLow;
 m.decayAvailable=decayHigh>=0&&decayLow>=decayHigh;
 if(m.riseAvailable)m.riseMs=(riseHigh-riseLow)*1000/source.sampleRate;
 if(m.decayAvailable)m.decayMs=(decayLow-decayHigh)*1000/source.sampleRate;
 return m;
}
}
std::vector<DynamicsFrame> dynamics(const AudioData& source,int hop,double initialEnergy) {return dynamicsOffset(source,hop,0,initialEnergy);}
DynamicsRender renderWithDynamics(const AudioData& source,const Parameters& p,int hop,int block) {
 std::string error;
 if(!shape(source)||hop<1||hop>1048576||block<1||block>1048576||!validate(p,source.sampleRate,error))
  throw std::invalid_argument("invalid dynamics render input/hop/block/parameters");
 for(const auto& channel:source.samples)for(float x:channel)if(!std::isfinite(x))throw std::invalid_argument("nonfinite render sample");
 DynamicsRender result;result.dry=source;result.wet=source;
 const double trim=std::pow(10.,p.inputDb/20.);
 for(auto& channel:result.dry.samples)for(float& x:channel)x=static_cast<float>(std::clamp(double(x),-16.,16.)*trim);
 Engine engine;engine.prepare(source.sampleRate,static_cast<int>(source.samples.size()),p);engine.reset();
 result.wetLatencySamples=engine.latencySamples();
 for(std::int64_t n=0;n<source.frames();) {
  const auto untilHop=hop-n%hop;
  const int count=static_cast<int>(std::min<std::int64_t>({block,untilHop,source.frames()-n}));
  const float* in[2]{};float* out[2]{};
  for(size_t c=0;c<source.samples.size();++c){in[c]=source.samples[c].data()+n;out[c]=result.wet.samples[c].data()+n;}
  engine.process(in,out,count);n+=count;
  if(n%hop==0||n==source.frames()) {
   ProcessingDynamicsFrame frame;frame.dry.sample=frame.wet.sample=n-1;
   frame.gainReductionDb=engine.gainReductionDb();frame.bandGainReductionDb=engine.bandGainReductionDb();
   result.frames.push_back(frame);
  }
 }
 const auto dry=dynamics(result.dry,hop),wet=dynamicsOffset(result.wet,hop,result.wetLatencySamples);
 for(size_t i=0;i<result.frames.size();++i) {
  result.frames[i].dry=dry[i];
  if(i<wet.size()&&wet[i].sample==dry[i].sample){result.frames[i].wet=wet[i];result.frames[i].wetAvailable=true;}
 }
 return result;
}
PassageComparison comparePassages(const AudioData& dry,const AudioData& wet,SampleInterval soft,SampleInterval hard,int latency,double dryInitialEnergy,double wetInitialEnergy) {
 PassageComparison result;
 if(!shape(dry)||!shape(wet)||dry.sampleRate!=wet.sampleRate||dry.samples.size()!=wet.samples.size()||latency<0||!std::isfinite(dryInitialEnergy)||dryInitialEnergy<0||!std::isfinite(wetInitialEnergy)||wetInitialEnergy<0)return result;
 for(auto interval:{soft,hard})if(interval.start<0||interval.end<interval.start||interval.end-interval.start<2||interval.end>dry.frames()||interval.end>wet.frames()-latency)return result;
 for(const auto* audio:{&dry,&wet})for(const auto& channel:audio->samples)for(float x:channel)if(!std::isfinite(x))return result;
 auto measure=[&](SampleInterval interval) {
  PassageMetrics m;m.dry=passageSignal(dry,interval,0,dryInitialEnergy);m.wet=passageSignal(wet,interval,latency,wetInitialEnergy);
  m.rmsChangeAvailable=m.dry.rms>=1e-9&&m.wet.rms>=1e-9;
  if(m.rmsChangeAvailable)m.rmsChangeDb=20*std::log10(m.wet.rms/m.dry.rms);
  return m;
 };
 result.soft=measure(soft);result.hard=measure(hard);result.valid=true;
 result.contrastAvailable=result.soft.rmsChangeAvailable&&result.hard.rmsChangeAvailable;
 if(result.contrastAvailable) {
  result.dryContrastDb=20*std::log10(result.hard.dry.rms/result.soft.dry.rms);
  result.wetContrastDb=20*std::log10(result.hard.wet.rms/result.soft.wet.rms);
  result.contrastChangeDb=result.wetContrastDb-result.dryContrastDb;
 }
 return result;
}

Comparison compare(const AudioData& dry,const AudioData& wet,std::int64_t start,std::int64_t end,bool match){Comparison r;if(!shape(dry)||!shape(wet)||dry.sampleRate!=wet.sampleRate||dry.samples.size()!=wet.samples.size()||dry.frames()!=wet.frames()||start<0||end<start||end>dry.frames()||end-start<2)return r;double d=0,w=0;for(size_t c=0;c<dry.samples.size();++c)for(auto n=start;n<end;++n){double a=dry.samples[c][n],b=wet.samples[c][n];if(!std::isfinite(a)||!std::isfinite(b))return r;d+=a*a;w+=b*b;}double count=double(end-start)*dry.samples.size();r.dryRms=std::sqrt(d/count);r.wetRms=std::sqrt(w/count);if(match){if(r.dryRms<1e-9||r.wetRms<1e-9)return r;double desired=r.dryRms/r.wetRms;double limit=std::pow(10.,12./20);r.gain=std::clamp(desired,1/limit,limit);r.gainCapped=r.gain!=desired;}double sum=0;for(size_t c=0;c<dry.samples.size();++c)for(auto n=start;n<end;++n){double wetSample=r.gain*wet.samples[c][n],delta=wetSample-dry.samples[c][n];sum+=delta*delta;r.peak=std::max(r.peak,std::abs(wetSample));}r.residualRms=std::sqrt(sum/count);r.valid=true;return r;}
std::vector<double> spectrum(const AudioData& a,std::int64_t start,int size){if(!shape(a)||size<16||size>65536||(size&(size-1))||start<0||start>a.frames()-size)throw std::invalid_argument("invalid FFT interval or power-of-two size");if(a.samples.size()>1){std::vector<double> energy(size/2+1,0);for(const auto& channel:a.samples){AudioData mono;mono.sampleRate=a.sampleRate;mono.samples.emplace_back(channel.begin()+start,channel.begin()+start+size);auto magnitude=spectrum(mono,0,size);for(size_t k=0;k<energy.size();++k)energy[k]+=magnitude[k]*magnitude[k]/a.samples.size();}for(auto& value:energy)value=std::sqrt(value);return energy;}std::vector<std::complex<double>> bins(size);double coherent=0;for(int n=0;n<size;++n){double window=.5-.5*std::cos(2*pi*n/size),x=0;coherent+=window;for(auto& c:a.samples){float v=c[start+n];if(!std::isfinite(v))throw std::invalid_argument("nonfinite spectrum sample");x+=v;}bins[n]=x/a.samples.size()*window;}for(int i=1,j=0;i<size;++i){int bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)std::swap(bins[i],bins[j]);}for(int len=2;len<=size;len<<=1){std::complex<double> step=std::polar(1.,-2*pi/len);for(int i=0;i<size;i+=len){std::complex<double> w=1;for(int j=0;j<len/2;++j){auto u=bins[i+j],v=bins[i+j+len/2]*w;bins[i+j]=u+v;bins[i+j+len/2]=u-v;w*=step;}}}std::vector<double> out(size/2+1);for(int k=0;k<=size/2;++k)out[k]=std::abs(bins[k])/coherent*((k==0||k==size/2)?1:2);return out;}
}
