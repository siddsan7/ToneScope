#pragma once
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace tonescope::desktop {
// One audio-thread writer. Controls/reset run only while its callback is detached.
// Fixed storage, lock-free atomics; no allocation, logging, locks or I/O.
class CallbackProbe {
public:
    using Clock=std::chrono::steady_clock;
    static constexpr std::size_t binCount=24;
    static_assert(std::atomic<bool>::is_always_lock_free&&std::atomic<std::uint64_t>::is_always_lock_free);
    static constexpr std::uint64_t binUpperNs(std::size_t index) noexcept {return index+1==binCount?std::numeric_limits<std::uint64_t>::max():(250ull<<index);}
    struct Snapshot {
        bool enabled=false,consistent=true,aggregateOverflow=false;
        std::uint64_t count=0,totalNs=0,maximumNs=0,deadlineMisses=0,unknownPeriods=0,lastPeriodNs=0,minimumPeriodNs=0,maximumPeriodNs=0;
        std::array<std::uint64_t,binCount> bins{};
        // Upper bin bound, not an exact percentile; UINT64_MAX means open-ended.
        std::uint64_t percentileUpperNs(unsigned basisPoints)const noexcept {
            if(count==0)return 0;if(basisPoints>10000)basisPoints=10000;
            auto rank=(count/10000)*basisPoints+((count%10000)*basisPoints+9999)/10000;if(rank==0)rank=1;
            std::uint64_t cumulative=0;for(std::size_t i=0;i<binCount;++i){if(bins[i]>=rank-cumulative)return binUpperNs(i);cumulative+=bins[i];}
            return std::numeric_limits<std::uint64_t>::max();
        }
    };
    struct Calibration {std::uint64_t iterations=0,minimumPositiveClockDeltaNs=0;double enabledScopeAverageNs=0,disabledScopeAverageNs=0;};
    class Scope {
    public:
        Scope(CallbackProbe& owner,int frames,const std::atomic<double>& rate)noexcept:probe(owner) {
            // Disabled path: exactly one lock-free flag load; no clock/rate read.
            active=probe.enabled.load(std::memory_order_relaxed);if(!active)return;
            start=Clock::now();const auto sampleRate=rate.load(std::memory_order_relaxed);
            if(frames>0&&std::isfinite(sampleRate)&&sampleRate>0){const auto value=static_cast<double>(frames)*1.e9/sampleRate;if(std::isfinite(value)&&value>=1&&value<18446744073709551616.)periodNs=static_cast<std::uint64_t>(value);}
        }
        ~Scope()noexcept {if(active){const auto elapsed=std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now()-start).count();probe.recordActive(elapsed>0?static_cast<std::uint64_t>(elapsed):0,periodNs);}}
        Scope(const Scope&)=delete;Scope& operator=(const Scope&)=delete;
    private:
        CallbackProbe& probe;Clock::time_point start{};std::uint64_t periodNs=0;bool active=false;
    };
    void setEnabled(bool value)noexcept{if(value){(void)Clock::now();}enabled.store(value,std::memory_order_relaxed);}
    bool isEnabled()const noexcept{return enabled.load(std::memory_order_relaxed);}
    void reset()noexcept {
        count=0;totalNs=0;maximumNs=0;deadlineMisses=0;unknownPeriods=0;lastPeriodNs=0;minimumPeriodNs=0;maximumPeriodNs=0;aggregateOverflow=false;for(auto& bin:bins)bin=0;epoch=0;
    }
    // Deterministic injected timing API; same recorder as Scope. Single writer.
    void recordElapsed(std::uint64_t elapsedNs,std::uint64_t nominalPeriodNs)noexcept{if(enabled.load(std::memory_order_relaxed))recordActive(elapsedNs,nominalPeriodNs);}
    Snapshot snapshot()const noexcept {
        Snapshot result;result.enabled=isEnabled();
        auto copy=[&]{result.count=count.load(std::memory_order_relaxed);result.totalNs=totalNs.load(std::memory_order_relaxed);result.maximumNs=maximumNs.load(std::memory_order_relaxed);result.deadlineMisses=deadlineMisses.load(std::memory_order_relaxed);result.unknownPeriods=unknownPeriods.load(std::memory_order_relaxed);result.lastPeriodNs=lastPeriodNs.load(std::memory_order_relaxed);result.minimumPeriodNs=minimumPeriodNs.load(std::memory_order_relaxed);result.maximumPeriodNs=maximumPeriodNs.load(std::memory_order_relaxed);result.aggregateOverflow=aggregateOverflow.load(std::memory_order_relaxed);for(std::size_t i=0;i<binCount;++i)result.bins[i]=bins[i].load(std::memory_order_relaxed);};
        copy();
        for(int attempt=0;attempt<16;++attempt){const auto before=epoch.load(std::memory_order_acquire);if(before&1)continue;copy();
            std::atomic_thread_fence(std::memory_order_acquire);if(before==epoch.load(std::memory_order_relaxed)){result.consistent=true;return result;}
        }result.consistent=false;return result;
    }
    static Calibration calibrate(unsigned iterations=10000)noexcept {
        Calibration result;if(iterations==0)return result;result.iterations=iterations;std::atomic<double> rate{48000};CallbackProbe probe;probe.setEnabled(true);
        for(int i=0;i<64;++i){Scope warmup(probe,512,rate);}
        auto started=Clock::now();for(unsigned i=0;i<iterations;++i){Scope scope(probe,512,rate);}auto ended=Clock::now();result.enabledScopeAverageNs=static_cast<double>(std::chrono::duration_cast<std::chrono::nanoseconds>(ended-started).count())/iterations;
        probe.setEnabled(false);started=Clock::now();for(unsigned i=0;i<iterations;++i){Scope scope(probe,512,rate);}ended=Clock::now();result.disabledScopeAverageNs=static_cast<double>(std::chrono::duration_cast<std::chrono::nanoseconds>(ended-started).count())/iterations;
        auto previous=Clock::now();for(unsigned i=0;i<iterations;++i){auto next=Clock::now();const auto delta=std::chrono::duration_cast<std::chrono::nanoseconds>(next-previous).count();if(delta>0&&(result.minimumPositiveClockDeltaNs==0||static_cast<std::uint64_t>(delta)<result.minimumPositiveClockDeltaNs))result.minimumPositiveClockDeltaNs=static_cast<std::uint64_t>(delta);previous=next;}return result;
    }
private:
    std::atomic<bool> enabled{false},aggregateOverflow{false};std::atomic<std::uint64_t> epoch{0},count{0},totalNs{0},maximumNs{0},deadlineMisses{0},unknownPeriods{0},lastPeriodNs{0},minimumPeriodNs{0},maximumPeriodNs{0};std::array<std::atomic<std::uint64_t>,binCount> bins{};
    void increment(std::atomic<std::uint64_t>& value)noexcept {const auto old=value.load(std::memory_order_relaxed);if(old==std::numeric_limits<std::uint64_t>::max())aggregateOverflow.store(true,std::memory_order_relaxed);else value.store(old+1,std::memory_order_relaxed);}
    void recordActive(std::uint64_t elapsed,std::uint64_t period)noexcept {
        epoch.fetch_add(1,std::memory_order_acq_rel);increment(count);const auto total=totalNs.load(std::memory_order_relaxed);if(elapsed>std::numeric_limits<std::uint64_t>::max()-total){totalNs.store(std::numeric_limits<std::uint64_t>::max(),std::memory_order_relaxed);aggregateOverflow.store(true,std::memory_order_relaxed);}else totalNs.store(total+elapsed,std::memory_order_relaxed);
        if(elapsed>maximumNs.load(std::memory_order_relaxed))maximumNs.store(elapsed,std::memory_order_relaxed);
        lastPeriodNs.store(period,std::memory_order_relaxed);if(period==0)increment(unknownPeriods);else{const auto minimum=minimumPeriodNs.load(std::memory_order_relaxed);if(minimum==0||period<minimum)minimumPeriodNs.store(period,std::memory_order_relaxed);if(period>maximumPeriodNs.load(std::memory_order_relaxed))maximumPeriodNs.store(period,std::memory_order_relaxed);if(elapsed>period)increment(deadlineMisses);}
        std::size_t index=0;while(index+1<binCount&&elapsed>binUpperNs(index))++index;increment(bins[index]);epoch.fetch_add(1,std::memory_order_release);
    }
};
static_assert(sizeof(CallbackProbe)<=512,"Callback probe storage must stay bounded");
}
