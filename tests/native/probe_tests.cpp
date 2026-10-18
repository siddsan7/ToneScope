#include "CallbackProbe.h"
#include <atomic>
#include <cstdlib>
#include <iostream>
#include <new>
#include <stdexcept>
#include <thread>

static std::atomic<bool> countAllocations{false};static std::atomic<std::uint64_t> allocations{0};
void* operator new(std::size_t bytes){if(countAllocations.load(std::memory_order_relaxed))allocations.fetch_add(1,std::memory_order_relaxed);if(auto* result=std::malloc(bytes?bytes:1))return result;throw std::bad_alloc();}
void* operator new[](std::size_t bytes){return ::operator new(bytes);}void operator delete(void* pointer)noexcept{std::free(pointer);}void operator delete[](void* pointer)noexcept{std::free(pointer);}void operator delete(void* pointer,std::size_t)noexcept{std::free(pointer);}void operator delete[](void* pointer,std::size_t)noexcept{std::free(pointer);}
void require(bool value,const char* reason){if(!value)throw std::runtime_error(reason);}
int main(){try{
 using Probe=tonescope::desktop::CallbackProbe;Probe probe;std::atomic<double> rate{48000};
 for(int i=0;i<1000;++i){Probe::Scope disabled(probe,512,rate);probe.recordElapsed(100,1000);}auto snapshot=probe.snapshot();require(!snapshot.enabled&&snapshot.count==0&&snapshot.maximumNs==0,"Disabled paths must not record samples");
 probe.setEnabled(true);for(auto elapsed:{100ull,200ull,300ull,400ull})probe.recordElapsed(elapsed,300);snapshot=probe.snapshot();require(snapshot.consistent&&snapshot.count==4&&snapshot.totalNs==1000&&snapshot.maximumNs==400&&snapshot.deadlineMisses==1,"Injected count/max/total and strict deadline classification");require(snapshot.bins[0]==2&&snapshot.bins[1]==2&&snapshot.percentileUpperNs(5000)==250&&snapshot.percentileUpperNs(9500)==500&&snapshot.percentileUpperNs(9900)==500&&snapshot.percentileUpperNs(9990)==500,"Fixed histogram and upper-bound percentile estimates");
 probe.reset();for(int i=0;i<998;++i)probe.recordElapsed(100,1000);probe.recordElapsed(100000,1000);probe.recordElapsed(100000,1000);snapshot=probe.snapshot();require(snapshot.count==1000&&snapshot.percentileUpperNs(9900)==250&&snapshot.percentileUpperNs(9990)==128000&&snapshot.deadlineMisses==2,"99.9th percentile tail remains distinct from p99 at 1000 samples");
 probe.reset();for(auto elapsed:{100ull,200ull,300ull,400ull})probe.recordElapsed(elapsed,300); probe.recordElapsed(250,0);snapshot=probe.snapshot();require(snapshot.unknownPeriods==1&&snapshot.deadlineMisses==1&&snapshot.lastPeriodNs==0&&snapshot.minimumPeriodNs==300&&snapshot.maximumPeriodNs==300,"Unknown period is distinct from a deadline miss");
 probe.reset();probe.recordElapsed(UINT64_MAX,1);probe.recordElapsed(1,1);snapshot=probe.snapshot();require(snapshot.aggregateOverflow&&snapshot.totalNs==UINT64_MAX&&snapshot.maximumNs==UINT64_MAX&&snapshot.count==2&&snapshot.bins.back()==1&&snapshot.percentileUpperNs(9900)==UINT64_MAX,"Saturated aggregate and open-ended overflow bucket do not wrap");
 probe.reset();require(probe.isEnabled()&&probe.snapshot().count==0,"Reset clears storage and preserves explicit opt-in state");
 countAllocations=true;for(int i=0;i<100000;++i)probe.recordElapsed(static_cast<std::uint64_t>(i),10000);for(int i=0;i<1000;++i){Probe::Scope realScope(probe,512,rate);}auto fixedSnapshot=probe.snapshot();countAllocations=false;require(allocations==0&&fixedSnapshot.count==101000&&sizeof(Probe)<=512,"Record/snapshot use fixed storage without allocation");
 probe.reset();std::atomic<bool> done{false};std::jthread writer([&]{for(int i=0;i<100000;++i)probe.recordElapsed(500,1000);done=true;});std::uint64_t previousCount=0;while(!done.load()){auto current=probe.snapshot();require(current.count>=previousCount,"Observed counts must be monotonic");previousCount=current.count;if(current.consistent){std::uint64_t sum=0;for(auto value:current.bins)sum+=value;require(sum==current.count,"Consistent snapshots have a complete histogram");}}writer.join();require(probe.snapshot().count==100000,"Concurrent writer sample count");
 auto prior=Probe::Clock::now();for(int i=0;i<10000;++i){auto next=Probe::Clock::now();require(next>=prior,"Selected clock must be monotonic");prior=next;}
 probe.reset();{Probe::Scope timed(probe,512,rate);}require(probe.snapshot().count==1,"Enabled RAII records one real clock scope");
 const auto calibration=Probe::calibrate(20000);require(calibration.iterations==20000&&calibration.minimumPositiveClockDeltaNs>0,"Current-host software clock calibration");
 std::cout<<"probe deterministic checks passed; HOST SOFTWARE BENCHMARK only: enabled scope average "<<calibration.enabledScopeAverageNs<<" ns, disabled "<<calibration.disabledScopeAverageNs<<" ns, minimum observed clock delta "<<calibration.minimumPositiveClockDeltaNs<<" ns, fixed storage "<<sizeof(Probe)<<" bytes, scope storage "<<sizeof(Probe::Scope)<<" bytes. No device qualification.\n";return 0;
 }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
