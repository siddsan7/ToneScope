#pragma once
#include <tonescope/Engine.h>
#include <tonescope/Streaming.h>
#include "../../libs/audio-engine/src/Dsp.h"
#if __has_include("../../libs/audio-engine/src/NativePath.h")
#include "../../libs/audio-engine/src/NativePath.h"
#endif
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <functional>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <thread>
#include <vector>

namespace tonescope::desktop {
inline Parameters dryReferenceParameters(const Parameters& p,double rate) {
    Parameters dry;dry.inputDb=p.inputDb;dry.toneHz=static_cast<float>(std::min(5000.,.45*rate));
    dry.compressor=dry.multiband=p.compressor&&p.multiband;dry.ratio=1;dry.kneeDb=0;dry.thresholdDb=0;
    dry.crossoverLowHz=p.crossoverLowHz;dry.crossoverHighHz=p.crossoverHighHz;return dry;
}
struct CancelledFileOperation:std::runtime_error {CancelledFileOperation():std::runtime_error("File operation cancelled") {}};
using FileCancel=std::shared_ptr<std::atomic<bool>>;
// All processing and allocation below runs on file workers. Always reconstruct
// state from source frame zero; no approximate pre-roll is used for seeking.
template<class Sink>
inline WavInfo processFileRange(const std::string& path,const Parameters& p,std::int64_t from,std::int64_t until,
                               const FileCancel& cancel,std::atomic<double>* progress,Sink&& sink,AuditionBand band=AuditionBand::full,std::function<void(std::int64_t,float,std::array<float,3>)> dynamicsTap={}) {
    WavStreamReader reader(path);const auto info=reader.info();
    if(static_cast<int>(band)<0||static_cast<int>(band)>3)throw std::runtime_error("Invalid streamed audition band");
    if(from<0||until<=from||until>info.frames)throw std::runtime_error("Invalid streamed source interval");
#if __has_include("../../libs/audio-engine/src/NativePath.h")
    const auto diskPath=detail::nativeAudioPath(path);
#else
    const auto diskPath=std::filesystem::path(std::u8string(path.begin(),path.end()));
#endif
    const auto stamp=std::filesystem::last_write_time(diskPath);const auto length=std::filesystem::file_size(diskPath);std::int64_t nextCheck=0;
    Engine wet,dry;wet.prepare(info.sampleRate,info.channels,p);dry.prepare(info.sampleRate,info.channels,dryReferenceParameters(p,info.sampleRate));
    std::array<std::array<float,512>,2> input{},dryOutput{},wetOutput{},filteredDry{},filteredWet{};
    detail::ThreeBand dryFilters[2],wetFilters[2];for(int c=0;c<info.channels;++c){dryFilters[c].prepare(p.crossoverLowHz,p.crossoverHighHz,info.sampleRate);wetFilters[c].prepare(p.crossoverLowHz,p.crossoverHighHz,info.sampleRate);}
    float* incoming[]{input[0].data(),input[1].data()};const float* in[]{input[0].data(),input[1].data()};
    float* dout[]{dryOutput[0].data(),dryOutput[1].data()};float* wout[]{wetOutput[0].data(),wetOutput[1].data()};
    for(std::int64_t at=0;at<until;){
        if(cancel&&cancel->load(std::memory_order_acquire))throw CancelledFileOperation();
        if(at>=nextCheck){if(std::filesystem::last_write_time(diskPath)!=stamp||std::filesystem::file_size(diskPath)!=length)throw std::runtime_error("Source changed during streamed processing");nextCheck=at+static_cast<std::int64_t>(info.sampleRate);}
        const int count=static_cast<int>(std::min<std::int64_t>(512,until-at));
        if(reader.read(incoming,count)!=count)throw std::runtime_error("Stream ended before the requested source interval");
        wet.process(in,wout,count);dry.process(in,dout,count);if(dynamicsTap)dynamicsTap(at+count-1,wet.gainReductionDb(),wet.bandGainReductionDb());
        for(int c=0;c<info.channels;++c)for(int i=0;i<count;++i){const auto channel=static_cast<size_t>(c),index=static_cast<size_t>(i);if(band==AuditionBand::full){filteredDry[channel][index]=dryOutput[channel][index];filteredWet[channel][index]=wetOutput[channel][index];}else{filteredDry[channel][index]=static_cast<float>(dryFilters[c].tick(dryOutput[channel][index])[static_cast<size_t>(band)-1]);filteredWet[channel][index]=static_cast<float>(wetFilters[c].tick(wetOutput[channel][index])[static_cast<size_t>(band)-1]);}}
        if(at+count>from){const auto skip=static_cast<int>(std::max<std::int64_t>(0,from-at));sink(at+skip,count-skip,input,dryOutput,wetOutput,filteredDry,filteredWet,skip);}
        at+=count;if(progress)progress->store(static_cast<double>(at)/until,std::memory_order_release);
    }
    return info;
}
struct FileInspection {WavInfo info;std::int64_t offset=0,windowEnd=0,measuredEnd=0;AudioData raw,dry,wet,auditionDry,auditionWet;int latency=0;Comparison comparison;std::vector<float> gainReductionHistory;std::array<std::vector<float>,3> bandGainReductionHistory;std::vector<std::int64_t> gainReductionSamples;};
inline FileInspection inspectFile(const std::string& path,const Parameters& p,std::int64_t first,std::int64_t last,
                                  const FileCancel& cancel={},std::atomic<double>* progress=nullptr,AuditionBand band=AuditionBand::full,bool match=false) {
    WavStreamReader metadata(path);FileInspection result;result.info=metadata.info();result.offset=first;
    result.latency=p.drive&&p.oversampling>1?32:0;
    const auto cap=std::min<std::int64_t>(1048576,static_cast<std::int64_t>(result.info.sampleRate*10));
    result.measuredEnd=std::min(last,result.info.frames-result.latency);result.windowEnd=std::min(result.measuredEnd,first+cap);
    if(first<0||result.windowEnd<=first)throw std::runtime_error("Selection is inside the unavailable latency tail");
    const auto cacheUntil=result.windowEnd+result.latency;const auto count=static_cast<size_t>(cacheUntil-first);
    for(auto* data:{&result.raw,&result.dry,&result.wet,&result.auditionDry,&result.auditionWet}){data->sampleRate=result.info.sampleRate;data->samples.assign(static_cast<size_t>(result.info.channels),std::vector<float>(count));}
    std::array<std::array<float,33>,2> dryHistory{};long double dd=0,ww=0,dw=0;double peak=0;
    processFileRange(path,p,std::max<std::int64_t>(0,first-result.latency),result.measuredEnd+result.latency,cancel,progress,[&](std::int64_t at,int n,const auto& in,const auto& dry,const auto& wet,const auto& filteredDry,const auto& filteredWet,int skip){
        if(at<cacheUntil){const auto copyCount=static_cast<int>(std::min<std::int64_t>(n,cacheUntil-at));const int begin=static_cast<int>(std::max<std::int64_t>(0,first-at));
            if(copyCount>begin)for(int c=0;c<result.info.channels;++c){const auto channel=static_cast<size_t>(c),offset=static_cast<size_t>(at+begin-first);const auto inputOffset=skip+begin;const auto amount=copyCount-begin;
                std::copy_n(in[channel].data()+inputOffset,amount,result.raw.samples[channel].data()+offset);std::copy_n(dry[channel].data()+inputOffset,amount,result.dry.samples[channel].data()+offset);std::copy_n(wet[channel].data()+inputOffset,amount,result.wet.samples[channel].data()+offset);std::copy_n(filteredDry[channel].data()+inputOffset,amount,result.auditionDry.samples[channel].data()+offset);std::copy_n(filteredWet[channel].data()+inputOffset,amount,result.auditionWet.samples[channel].data()+offset);}
        }
        for(int i=0;i<n;++i){const auto current=at+i;for(int c=0;c<result.info.channels;++c)dryHistory[static_cast<size_t>(c)][static_cast<size_t>(current%33)]=filteredDry[static_cast<size_t>(c)][static_cast<size_t>(i+skip)];const auto source=current-result.latency;if(source<first||source>=result.measuredEnd)continue;
            for(int c=0;c<result.info.channels;++c){const auto channel=static_cast<size_t>(c);const long double d=dryHistory[channel][static_cast<size_t>(source%33)],w=filteredWet[channel][static_cast<size_t>(i+skip)];dd+=d*d;ww+=w*w;dw+=d*w;peak=std::max(peak,std::abs(static_cast<double>(w)));}
        }
    },band,[&](std::int64_t sample,float gain,std::array<float,3> bands){if(sample>=first&&sample<cacheUntil){result.gainReductionSamples.push_back(sample);result.gainReductionHistory.push_back(gain);for(size_t b=0;b<3;++b)result.bandGainReductionHistory[b].push_back(bands[b]);}});
    auto& comparison=result.comparison;const double samples=static_cast<double>(result.measuredEnd-first)*result.info.channels;comparison.dryRms=std::sqrt(static_cast<double>(dd/samples));comparison.wetRms=std::sqrt(static_cast<double>(ww/samples));
    if(result.measuredEnd-first>=2&&(!match||(comparison.dryRms>=1e-9&&comparison.wetRms>=1e-9))){if(match){const auto desired=comparison.dryRms/comparison.wetRms,limit=std::pow(10.,.6);comparison.gain=std::clamp(desired,1/limit,limit);comparison.gainCapped=comparison.gain!=desired;}const long double gain=comparison.gain;comparison.residualRms=std::sqrt(static_cast<double>(std::max(0.L,dd+gain*gain*ww-2*gain*dw)/samples));comparison.peak=peak*comparison.gain;comparison.valid=true;}
    return result;
}inline void exportFileRange(const std::string& input,const std::string& output,const Parameters& p,
                            std::int64_t first,std::int64_t last,const FileCancel& cancel={},std::atomic<double>* progress=nullptr) {
    WavStreamReader metadata(input);WavStreamWriter writer(output,metadata.info().sampleRate,metadata.info().channels);
    processFileRange(input,p,first,last,cancel,progress,[&](std::int64_t,int n,const auto&,const auto&,const auto& wet,const auto&,const auto&,int skip){const float* samples[]{wet[0].data()+skip,wet[1].data()+skip};writer.write(samples,n);});writer.finish();
}

class FilePlayback {
public:
    static constexpr unsigned blockFrames=512,slots=256;
    static_assert(std::atomic<std::uint64_t>::is_always_lock_free&&std::atomic<bool>::is_always_lock_free&&std::atomic<double>::is_always_lock_free);
    FilePlayback(std::string path,Parameters p,std::int64_t first,std::int64_t last,double outputRate,std::function<bool(const FileCancel&)> verify={},AuditionBand band=AuditionBand::full,double sourceTimelineOffset=0)
      : stopFlag(std::make_shared<std::atomic<bool>>(false)),queue(slots),timelineOffset(sourceTimelineOffset),worker([this,path=std::move(path),p,first,last,outputRate,band,verify=std::move(verify)]{try{if(verify&&!verify(stopFlag)){failure=true;done=true;return;}run(path,p,first,last,outputRate,band);}catch(const CancelledFileOperation&){done=true;}catch(...){failure=true;done=true;}}) {}
    ~FilePlayback(){cancel();}
    FilePlayback(const FilePlayback&)=delete;
    void cancel() noexcept {stopFlag->store(true,std::memory_order_release);if(worker.joinable())worker.join();}
    void requestCancel()noexcept{stopFlag->store(true,std::memory_order_release);}
    bool ready()const noexcept {return written.load(std::memory_order_acquire)-read.load(std::memory_order_acquire)>=8||(done.load(std::memory_order_acquire)&&written.load(std::memory_order_acquire)>read.load(std::memory_order_acquire));}
    bool exhausted()const noexcept{return done.load(std::memory_order_acquire)&&read.load(std::memory_order_acquire)==written.load(std::memory_order_acquire);}
    bool failed()const noexcept{return failure.load(std::memory_order_acquire);}
    bool finished()const noexcept{return done.load(std::memory_order_acquire);}
    double progress()const noexcept{return preparation.load(std::memory_order_acquire);}
    // One audio-thread consumer; initialized destinations even on starvation.
    int pull(float* const* dry,float* const* wet,int frames,double& nextSourceFrame)noexcept {
        for(int c=0;c<2;++c){std::fill_n(dry[c],frames,0.f);std::fill_n(wet[c],frames,0.f);}int copied=0;
        while(copied<frames){const auto r=read.load(std::memory_order_relaxed);if(r==written.load(std::memory_order_acquire))break;const auto& packet=queue[r%slots];const int n=std::min(frames-copied,packet.count-readOffset);
            for(int c=0;c<2;++c){std::copy_n(packet.dry[static_cast<size_t>(c)].data()+readOffset,n,dry[c]+copied);std::copy_n(packet.wet[static_cast<size_t>(c)].data()+readOffset,n,wet[c]+copied);}copied+=n;readOffset+=n;nextSourceFrame=packet.first+readOffset*packet.step+timelineOffset;
            if(readOffset==packet.count){readOffset=0;read.store(r+1,std::memory_order_release);}
        }return copied;
    }
private:
    struct Packet {std::array<std::array<float,blockFrames>,2> dry{},wet{};int count=0;double first=0,step=1;};
    FileCancel stopFlag;std::vector<Packet> queue;std::atomic<std::uint64_t> written{0},read{0};
    std::atomic<bool> done{false},failure{false};std::atomic<double> preparation{0};int readOffset=0;const double timelineOffset;std::thread worker;
    void run(const std::string& path,const Parameters& p,std::int64_t first,std::int64_t last,double outputRate,AuditionBand band)noexcept {
        try {
            WavStreamReader metadata(path);const auto info=metadata.info();const int latency=p.drive&&p.oversampling>1?32:0;
            if(!std::isfinite(outputRate)||outputRate<8000||outputRate>192000||first<0||last<=first||last>info.frames-latency)throw std::runtime_error("Invalid streaming playback interval/rate");
            std::array<std::array<float,33>,2> dryHistory{};std::array<float,2> previousDry{},previousWet{};bool havePrevious=false;
            Packet packet;packet.step=info.sampleRate/outputRate;double next=static_cast<double>(first);
            auto publish=[&]{if(packet.count==0)return;for(;;){if(stopFlag->load(std::memory_order_acquire))throw CancelledFileOperation();const auto w=written.load(std::memory_order_relaxed);if(w-read.load(std::memory_order_acquire)<slots){queue[w%slots]=packet;written.store(w+1,std::memory_order_release);packet.count=0;return;}std::this_thread::sleep_for(std::chrono::milliseconds(2));}};
            auto emit=[&](const std::array<float,2>& dry,const std::array<float,2>& wet,double at){if(packet.count==0)packet.first=at;for(int c=0;c<2;++c){packet.dry[static_cast<size_t>(c)][static_cast<size_t>(packet.count)]=dry[static_cast<size_t>(c)];packet.wet[static_cast<size_t>(c)][static_cast<size_t>(packet.count)]=wet[static_cast<size_t>(c)];}if(++packet.count==static_cast<int>(blockFrames))publish();};
            // Include latency history in the sink so dry[n] pairs with wet[n+L].
            processFileRange(path,p,std::max<std::int64_t>(0,first-latency),last+latency,stopFlag,&preparation,[&](std::int64_t at,int n,const auto&,const auto&,const auto&,const auto& dry,const auto& wet,int skip){
                for(int i=0;i<n;++i){const auto current=at+i;for(int c=0;c<info.channels;++c)dryHistory[static_cast<size_t>(c)][static_cast<size_t>(current%33)]=dry[static_cast<size_t>(c)][static_cast<size_t>(i+skip)];const auto source=current-latency;if(source<first||source>=last)continue;
                    std::array<float,2> d{},w{};for(int c=0;c<2;++c){const auto channel=static_cast<size_t>(std::min(c,info.channels-1));d[static_cast<size_t>(c)]=dryHistory[channel][static_cast<size_t>(source%33)];w[static_cast<size_t>(c)]=wet[channel][static_cast<size_t>(i+skip)];}
                    if(!havePrevious){previousDry=d;previousWet=w;havePrevious=true;continue;}
                    while(next<=static_cast<double>(source)&&next<last){const auto fraction=static_cast<float>(next-(source-1));std::array<float,2> interpolatedDry{},interpolatedWet{};for(int c=0;c<2;++c){interpolatedDry[static_cast<size_t>(c)]=fraction<=0?previousDry[static_cast<size_t>(c)]:fraction>=1?d[static_cast<size_t>(c)]:previousDry[static_cast<size_t>(c)]+fraction*(d[static_cast<size_t>(c)]-previousDry[static_cast<size_t>(c)]);interpolatedWet[static_cast<size_t>(c)]=fraction<=0?previousWet[static_cast<size_t>(c)]:fraction>=1?w[static_cast<size_t>(c)]:previousWet[static_cast<size_t>(c)]+fraction*(w[static_cast<size_t>(c)]-previousWet[static_cast<size_t>(c)]);}emit(interpolatedDry,interpolatedWet,next);next+=packet.step;}previousDry=d;previousWet=w;
                }
            },band);
            while(havePrevious&&next<last){emit(previousDry,previousWet,next);next+=packet.step;}publish();
        }catch(const CancelledFileOperation&){}catch(...){failure.store(true,std::memory_order_release);}done.store(true,std::memory_order_release);
    }
};
}
