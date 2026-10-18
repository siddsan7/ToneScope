#pragma once
#include <tonescope/Streaming.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <thread>
#include <vector>

namespace tonescope::desktop {
// A single callback producer and file-thread consumer. No callback allocation,
// locking, waiting, filesystem work, notification primitive, or destruction.
class CaptureWorker {
public:
    enum class Fault { none, overflow, duration, io, interrupted };
    static_assert(std::atomic<std::uint64_t>::is_always_lock_free&&std::atomic<std::int64_t>::is_always_lock_free&&std::atomic<bool>::is_always_lock_free&&std::atomic<Fault>::is_always_lock_free);
    static constexpr unsigned blockFrames=512;
    explicit CaptureWorker(std::string path,double rate,unsigned slots=256,
                           std::int64_t frameLimit=0)
        : queue(std::max(2u,slots)),maximum(frameLimit>0?frameLimit:std::min<std::int64_t>(
            static_cast<std::int64_t>(rate*7200), (2ll*1024*1024*1024-44)/8)),
          worker([this,path=std::move(path),rate]{run(path,rate);}) {}
    ~CaptureWorker(){stop();}
    CaptureWorker(const CaptureWorker&)=delete;
    bool push(const float* const* input,int count) noexcept {
        if(count<1||count>static_cast<int>(blockFrames)||stopping.load(std::memory_order_acquire))return false;
        const auto total=submitted.load(std::memory_order_relaxed);
        if(count>maximum-total){fail(Fault::duration);return false;}
        const auto w=written.load(std::memory_order_relaxed),r=read.load(std::memory_order_acquire);
        if(w-r>=queue.size()){fail(Fault::overflow);return false;}
        auto& slot=queue[w%queue.size()];slot.count=count;
        for(int c=0;c<2;++c)std::copy_n(input[c],count,slot.samples[static_cast<size_t>(c)].data());
        submitted.store(total+count,std::memory_order_relaxed);written.store(w+1,std::memory_order_release);return true;
    }
    // Must follow callback detachment or recording=false + callback detachment.
    void stop() noexcept {stopping.store(true,std::memory_order_release);if(worker.joinable())worker.join();}
    void interrupt() noexcept {fail(Fault::interrupted);}
    bool stopped() const noexcept{return stopping.load(std::memory_order_acquire);}
    bool finished() const noexcept{return done.load(std::memory_order_acquire);}
    bool complete() const noexcept{return finished()&&fault()==Fault::none&&persisted.load()>0;}
    Fault fault() const noexcept{return failure.load(std::memory_order_acquire);}
    std::int64_t frames() const noexcept{return persisted.load(std::memory_order_acquire);}
private:
    struct Block {std::array<std::array<float,blockFrames>,2> samples{};int count=0;};
    std::vector<Block> queue;
    const std::int64_t maximum;
    std::atomic<std::uint64_t> written{0},read{0};
    std::atomic<std::int64_t> submitted{0},persisted{0};
    std::atomic<bool> stopping{false},done{false};std::atomic<Fault> failure{Fault::none};
    // Last: every member the worker uses must be initialized before it starts.
    std::thread worker;
    void fail(Fault reason) noexcept {auto expected=Fault::none;failure.compare_exchange_strong(expected,reason);stopping.store(true,std::memory_order_release);}
    void run(const std::string& path,double rate) noexcept {
        try {
            WavStreamWriter writer(path,rate,2);
            for(;;){
                const auto r=read.load(std::memory_order_relaxed),w=written.load(std::memory_order_acquire);
                if(r==w){if(stopping.load(std::memory_order_acquire)&&r==written.load(std::memory_order_acquire))break;std::this_thread::sleep_for(std::chrono::milliseconds(2));continue;}
                const auto& slot=queue[r%queue.size()];const float* data[]{slot.samples[0].data(),slot.samples[1].data()};
                writer.write(data,slot.count);persisted.store(writer.frames(),std::memory_order_release);read.store(r+1,std::memory_order_release);
            }
            if(writer.frames()>0)writer.finish();
        } catch(...){fail(Fault::io);}
        done.store(true,std::memory_order_release);
    }
};
}
