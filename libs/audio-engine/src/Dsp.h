#pragma once
#include <array>
#include <cmath>

namespace tonescope::detail {
constexpr double pi = 3.14159265358979323846;
struct Filter {
    double b0=1, b1=0, b2=0, a1=0, a2=0, z1=0, z2=0;
    double tick(double x) noexcept {
        const double y = b0*x + z1;
        z1 = b1*x - a1*y + z2;
        z2 = b2*x - a2*y;
        return y;
    }
    void pass(double hz, double sr, bool high) noexcept {
        const double w=2*pi*hz/sr, c=std::cos(w), alpha=std::sin(w)/std::sqrt(2.);
        const double norm=1/(1+alpha);
        b0=(high ? 1+c : 1-c)*.5*norm;
        b1=(high ? -(1+c) : 1-c)*norm;
        b2=b0; a1=-2*c*norm; a2=(1-alpha)*norm;
    }
};
struct Split {
    Filter low[2], high[2];
    void prepare(double hz, double sr) noexcept {
        for(auto& f:low) f.pass(hz,sr,false);
        for(auto& f:high) f.pass(hz,sr,true);
    }
    std::array<double,2> tick(double x) noexcept {
        return {low[1].tick(low[0].tick(x)), high[1].tick(high[0].tick(x))};
    }
};
struct ThreeBand {
    Split first, upperLow, upperHigh;
    void prepare(double low, double high, double sr) noexcept {
        first.prepare(low,sr); upperLow.prepare(high,sr); upperHigh.prepare(high,sr);
    }
    std::array<double,3> tick(double x) noexcept {
        const auto a=first.tick(x), b=upperLow.tick(a[0]), c=upperHigh.tick(a[1]);
        return {b[0]+b[1],c[0],c[1]};
    }
};
// Fixed storage; coefficients prepared outside process, history updated per sample.
struct Fir {
    std::array<double,129> taps{}, history{};
    int length=1, cursor=0;
    void prepare(int factor) noexcept {
        *this=Fir{};
        length=32*factor+1;
        const int middle=(length-1)/2;
        const double cutoff=.45/factor;
        double sum=0;
        for(int i=0;i<length;++i) {
            const int k=i-middle;
            const double sinc=k==0 ? 2*cutoff : std::sin(2*pi*cutoff*k)/(pi*k);
            const double window=.42-.5*std::cos(2*pi*i/(length-1))+.08*std::cos(4*pi*i/(length-1));
            taps[i]=sinc*window; sum+=taps[i];
        }
        for(int i=0;i<length;++i) taps[i]/=sum;
    }
    double tick(double x) noexcept {
        history[cursor]=x;
        double y=0;
        int read=cursor;
        for(int i=0;i<length;++i) {
            y+=taps[i]*history[read];
            if(--read<0) read=length-1;
        }
        if(++cursor==length) cursor=0;
        return y;
    }
};
}
