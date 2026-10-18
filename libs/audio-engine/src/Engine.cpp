#include "tonescope/Engine.h"
#include "FaustDrive.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <limits>

namespace tonescope {
namespace {
constexpr double pi=3.14159265358979323846;
double gain(double db) { return std::pow(10.,db/20.); }
bool range(float x,double lo,double hi) {return std::isfinite(x)&&x>=lo&&x<=hi;}
std::array<float,17> values(const Parameters& p) {return {p.inputDb,p.thresholdDb,p.ratio,p.attackMs,p.releaseMs,p.kneeDb,p.makeupDb,p.lowDb,p.midDb,p.highDb,p.midHz,p.midQ,p.driveDb,p.toneHz,p.outputDb,0,0};}
struct Biquad {
 double b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
 void design(int type,double hz,double q,double db,double sr) {
  double A=std::pow(10.,db/40.),w=2*pi*hz/sr,c=std::cos(w),s=std::sin(w),alpha=s/(2*q),a0;
  if(type==1) {a0=1+alpha/A;b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a1=-2*c;a2=1-alpha/A;}
  else { double t=2*std::sqrt(A)*s/std::sqrt(2.); if(type==0) {a0=(A+1)+(A-1)*c+t;b0=A*((A+1)-(A-1)*c+t);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-t);a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-t;} else {a0=(A+1)-(A-1)*c+t;b0=A*((A+1)+(A-1)*c+t);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-t);a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-t;}}
  b0/=a0;b1/=a0;b2/=a0;a1/=a0;a2/=a0;
 }
 double tick(double x) {double y=b0*x+z1;z1=b1*x-a1*y+z2;z2=b2*x-a2*y;return y;}
};
}
bool validate(const Parameters& p,double sr,std::string& error) {
 if(!std::isfinite(sr)||sr<8000||sr>192000) {error="sample rate outside 8000..192000";return false;}
 auto v=values(p); const double lo[]={-24,-60,1,.1,10,0,-24,-18,-18,-18,20,.2,0,20,-24,0,0}; const double hi[]={24,0,20,100,2000,24,24,18,18,18,std::min(20000.,.45*sr),10,36,std::min(20000.,.45*sr),24,0,0};
 for(int i=0;i<17;++i) if(!range(v[i],lo[i],hi[i])) {error="parameter outside finite range at index "+std::to_string(i);return false;}
 auto order=p.order;std::sort(order.begin(),order.end());if(order!=std::array<int,3>{0,1,2}) {error="stage order must be permutation of 0,1,2";return false;}error.clear();return true;
}
struct Engine::Impl {
 double sr=48000,smooth=0,rms=0,gr=0;int channels=0;Parameters p;std::array<float,17> current=values(p),target=current;
 tonescope_faust::ToneScopeDrive shaper; Biquad eq[2][3];std::array<float,5> eqParameters{};double prev[2]{},lp[2]{},dcx[2]{},dcy[2]{};std::uint64_t faults=0;
};
Engine::Engine():impl(new Impl) {} Engine::~Engine(){delete impl;}
void Engine::prepare(double sr,int channels) {std::string error;if(channels<1||channels>2||!validate(impl->p,sr,error)) throw std::invalid_argument("invalid preparation: "+error);impl->sr=sr;impl->channels=channels;impl->smooth=std::exp(-1/(.015*sr));impl->shaper.init(static_cast<int>(sr));reset();}
void Engine::reset() {impl->rms=impl->gr=0;impl->current=impl->target;impl->faults=0;impl->eqParameters.fill(std::numeric_limits<float>::quiet_NaN());for(int c=0;c<2;++c){impl->prev[c]=impl->lp[c]=impl->dcx[c]=impl->dcy[c]=0;for(auto& f:impl->eq[c]) f=Biquad{};}}
void Engine::setParameters(const Parameters& p) {std::string error;if(!validate(p,impl->sr,error)) throw std::invalid_argument(error);impl->p=p;impl->target=values(p);}
bool Engine::setParametersRealtime(const Parameters& p) noexcept {
 auto v=values(p); const double lo[]={-24,-60,1,.1,10,0,-24,-18,-18,-18,20,.2,0,20,-24,0,0};
 const double hi[]={24,0,20,100,2000,24,24,18,18,18,std::min(20000.,.45*impl->sr),10,36,std::min(20000.,.45*impl->sr),24,0,0};
 for(int i=0;i<17;++i) if(!range(v[i],lo[i],hi[i])) return false;
 unsigned mask=0; for(int stage:p.order) {if(stage<0 || stage>2 || (mask&(1u<<stage))) return false; mask|=1u<<stage;}
 impl->p=p;impl->target=v;return true;
}
void Engine::process(const float* const* input,float* const* output,int frames) noexcept {
 auto& d=*impl;if(frames<=0||!output||d.channels==0) return;
 for(int n=0;n<frames;++n) {
  for(size_t k=0;k<d.current.size();++k) d.current[k]=static_cast<float>(d.target[k]+d.smooth*(d.current[k]-d.target[k]));auto& v=d.current;
  double x[2]{};for(int c=0;c<d.channels;++c){double a=input&&input[c]?input[c][n]:0;if(!std::isfinite(a)){a=0;++d.faults;}else if(std::abs(a)>16){a=std::clamp(a,-16.,16.);++d.faults;}x[c]=a*gain(v[0]);}
  for(int stage:d.p.order) {
   if(stage==0&&d.p.compressor) {double energy=0;for(int c=0;c<d.channels;++c)energy+=x[c]*x[c];energy/=d.channels;double coeff=std::exp(-1/(.010*d.sr));d.rms=coeff*d.rms+(1-coeff)*energy;double level=10*std::log10(std::max(d.rms,1e-30)),over=level-v[1],knee=v[5],reduction=0,slope=1-1/v[2];if(knee>0&&over>-knee/2&&over<knee/2) reduction=slope*(over+knee/2)*(over+knee/2)/(2*knee);else if(over>=knee/2)reduction=slope*over;double timing=reduction>d.gr?v[3]:v[4];double a=std::exp(-1/(timing*.001*d.sr));d.gr=a*d.gr+(1-a)*reduction;double g=gain(v[6]-d.gr);for(int c=0;c<d.channels;++c)x[c]*=g;}
   if(stage==1&&d.p.equalizer) {
    std::array<float,5> key{v[7],v[8],v[9],v[10],v[11]};
    if(key!=d.eqParameters) {
     d.eq[0][0].design(0,120,.70710678,v[7],d.sr);
     d.eq[0][1].design(1,v[10],v[11],v[8],d.sr);
     d.eq[0][2].design(2,std::min(6000.,.4*d.sr),.70710678,v[9],d.sr);
     for(int i=0;i<3;++i){auto& from=d.eq[0][i];auto& to=d.eq[1][i];to.b0=from.b0;to.b1=from.b1;to.b2=from.b2;to.a1=from.a1;to.a2=from.a2;}
     d.eqParameters=key;
    }
    for(int c=0;c<d.channels;++c)for(auto& f:d.eq[c])x[c]=f.tick(x[c]);
   }
   if(stage==2&&d.p.drive) for(int c=0;c<d.channels;++c) {double pre=x[c]+.25*(x[c]-d.prev[c]);d.prev[c]=x[c];float driveInput=static_cast<float>(pre*gain(v[12])),driveOutput=0;float* inputs[]={&driveInput};float* outputs[]={&driveOutput};d.shaper.compute(1,inputs,outputs);double shaped=driveOutput;double a=std::exp(-2*pi*v[13]/d.sr);d.lp[c]=(1-a)*shaped+a*d.lp[c];double y=d.lp[c]-d.dcx[c]+std::exp(-2*pi*20/d.sr)*d.dcy[c];d.dcx[c]=d.lp[c];d.dcy[c]=y;x[c]=y;}
  }
  for(int c=0;c<d.channels;++c) {double y=x[c]*gain(v[14]);if(!std::isfinite(y)||std::abs(y)>1e12){y=0;++d.faults;}if(output[c])output[c][n]=static_cast<float>(y);}
 }
}
int Engine::latencySamples() const noexcept{return 0;}float Engine::gainReductionDb()const noexcept{return impl->p.compressor?static_cast<float>(impl->gr):0;}std::uint64_t Engine::invalidSamples()const noexcept{return impl->faults;}
}


