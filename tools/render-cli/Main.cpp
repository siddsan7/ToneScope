#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>
#include <tonescope/Engine.h>
#include <tonescope/Session.h>
#include <tonescope/ParameterState.h>
#include <tonescope/Streaming.h>
#include <tonescope/Publication.h>
#include <ToneScopeBuildIdentity.h>
#include <cmath>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>

using namespace juce;
using namespace tonescope;
namespace {
var object(std::initializer_list<std::pair<const char*, var>> fields) {
    auto* obj = new DynamicObject;
    for (auto& [key, value] : fields) obj->setProperty(key, value);
    return var(obj);
}
void print(const var& value) { std::cout << JSON::toString(value, true).toStdString() << '\n'; }
String hashFile(const File& f) {
    auto stream = f.createInputStream();
    if (!stream) throw std::runtime_error("Cannot hash file");
    return SHA256(*stream).toHexString();
}
using tonescope::session::loadParameters;
int integer(const std::map<std::string,std::string>& args, const std::string& key, int fallback) {
    auto it=args.find(key); if(it==args.end()) return fallback;
    size_t used=0; auto value=std::stoll(it->second,&used);
    if(used!=it->second.size() || value<0 || value>2147483647) throw std::runtime_error("Invalid integer option: " + key);
    return int(value);
}
}
#ifdef _WIN32
int wmain(int argc, wchar_t** wideArgs) {
    std::vector<std::string> utf8Args;
    for(int i=0;i<argc;++i) utf8Args.push_back(String(wideArgs[i]).toStdString());
    std::vector<char*> pointers;
    for(auto& arg:utf8Args) pointers.push_back(arg.data());
    char** argv=pointers.data();
#else
int main(int argc, char** argv) {
#endif
    try {
        if (argc < 2) throw std::runtime_error("Usage: tonescope_cli render|inspect|compare --source file.wav --out output.wav");
        std::string command=argv[1];
        if(command=="build-info") {
            if(argc!=2)throw std::runtime_error("build-info accepts no options");
            print(JSON::parse(tonescopeBuildIdentity));return 0;
        }
        std::map<std::string,std::string> args;
        std::set<std::string> allowed;
        if(command=="render") allowed={"--source","--out","--session","--block-size","--overwrite","--start","--end"};
        else if(command=="inspect") allowed={"--source"};
        else if(command=="compare") allowed={"--dry","--wet","--start","--end","--match","--latency-samples"};
        else throw std::runtime_error("Unknown command");
        for(int i=2;i<argc;++i) {
            std::string key=argv[i];
            if(!allowed.contains(key) || args.contains(key)) throw std::runtime_error("Unknown or duplicate option: "+key);
            if(key=="--match" || key=="--overwrite") args[key]="true";
            else { if(++i>=argc) throw std::runtime_error("Missing option value"); args[key]=argv[i]; }
        }
        auto required=[&](const char* key) { if(!args.contains(key)) throw std::runtime_error(std::string("Missing ")+key); return args.at(key); };
        if(command=="compare") {
            auto dry=readWav(required("--dry")), wet=readWav(required("--wet"));
            auto latency=integer(args,"--latency-samples",0);
            auto start=integer(args,"--start",0),end=integer(args,"--end",int(std::min(dry.frames(),wet.frames()-latency)));
            auto c=compareAligned(dry,wet,start,end,args.contains("--match"),latency);
            print(object({{"valid",c.valid},{"dryRms",c.dryRms},{"wetRms",c.wetRms},{"gain",c.gain},{"residualRms",c.residualRms},{"peak",c.peak},{"gainCapped",c.gainCapped},{"selection_start",start},{"selection_end",end},{"latency_samples",latency}}));
        } else {
            File source=File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(required("--source").c_str()));
            const auto sourceHash=hashFile(source);
            WavStreamReader reader(source.getFullPathName().toStdString());
            const auto info=reader.info();
            if(command=="inspect") {
                double energy=0,peak=0; std::uint64_t count=0;
                std::array<std::array<float,1024>,2> scratch{};float* channels[]{scratch[0].data(),scratch[1].data()};
                while(auto frames=reader.read(channels,1024)) for(int c=0;c<info.channels;++c) for(int n=0;n<frames;++n) {auto sample=scratch[c][n];energy+=double(sample)*sample;peak=std::max(peak,std::abs(double(sample)));++count;}
                if(hashFile(source)!=sourceHash)throw std::runtime_error("Source changed during inspection");
                print(object({{"frames",int64(info.frames)},{"channels",info.channels},{"sample_rate_hz",info.sampleRate},{"rms",count?std::sqrt(energy/count):0},{"peak",peak}}));
            } else {
                auto p=args.contains("--session")?loadParameters(File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(args.at("--session").c_str()))):Parameters{};
                if(args.contains("--session")) {
                    auto saved=JSON::parse(File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(args.at("--session").c_str())));
                    if(auto digest=saved["source_sha256"]; !digest.isVoid() && digest.toString()!=sourceHash) throw std::runtime_error("Session source digest differs from supplied source");
                }
                std::string error;
                if(!validate(p,info.sampleRate,error)) throw std::runtime_error(error);
                int block=integer(args,"--block-size",257);
                if(block<1 || block>65536) throw std::runtime_error("Block size must be 1..65536");
                File out=File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(required("--out").c_str()));
                const auto sidecar=out.getSiblingFile(out.getFileName()+".json");
                if(out==source || sidecar==source) throw std::runtime_error("Output must differ from source");
                session::PublicationReservation publication(out,sidecar);
                if((out.exists() || sidecar.exists()) && !args.contains("--overwrite")) throw std::runtime_error("Output or manifest exists; select another path or --overwrite");
                const auto first=integer(args,"--start",0),last=integer(args,"--end",static_cast<int>(info.frames));
                if(first>=last||last>info.frames)throw std::runtime_error("Selection must be a nonempty source-sample interval");
                Engine engine;engine.prepare(info.sampleRate,info.channels,p);
                const int latency=engine.latencySamples();
                const int alignment=(args.contains("--start")||args.contains("--end"))?latency:0;
                const auto processingEnd=std::int64_t(last)+alignment;
                std::array<std::vector<float>,2> input,output;
                const float* in[2]{};float* read[2]{},*dest[2]{};
                for(int c=0;c<info.channels;++c){input[c].resize(block);output[c].resize(block);in[c]=input[c].data();read[c]=input[c].data();dest[c]=output[c].data();}
                // Publish only a complete asset; a failed write leaves the destination intact.
                TemporaryFile temporary(out);
                WavStreamWriter writer(temporary.getFile().getFullPathName().toStdString(),info.sampleRate,info.channels);
                for(std::int64_t at=0;at<processingEnd;at+=block) {
                    int frames=static_cast<int>(std::min<std::int64_t>(block,processingEnd-at));
                    reader.read(read,frames);engine.process(in,dest,frames);
                    auto begin=std::max<std::int64_t>(first+alignment,at),end=std::min<std::int64_t>(last+alignment,at+frames);
                    if(end>begin){const float* selected[2]{};for(int c=0;c<info.channels;++c)selected[c]=dest[c]+(begin-at);writer.write(selected,static_cast<int>(end-begin));}
                }
                writer.finish();
                if(hashFile(source)!=sourceHash) throw std::runtime_error("Source changed during render; retry from a stable file");
                if(!session::publishCompleteFile(temporary.getFile(),out,args.contains("--overwrite"))) throw std::runtime_error("Output publication failed or destination appeared during render");
                auto manifest=object({{"schema_version",1},{"frames",last-first},{"channels",info.channels},{"sample_rate_hz",info.sampleRate},{"source_sha256",sourceHash},{"artifact_sha256",hashFile(out)},{"graph_sha256",session::hashParameters(p)},{"latency_samples",latency},{"alignment_samples",alignment},{"selection_samples",var(Array<var>{first,last})},{"processed_frames",int64(processingEnd)},{"oversampling",p.oversampling},{"multiband",p.multiband},{"export_timeline",alignment?"source-aligned":"engine-output"},{"output",out.getFullPathName()}});
                TemporaryFile manifestTemp(sidecar);
                if(!manifestTemp.getFile().replaceWithText(JSON::toString(manifest)) || !session::publishCompleteFile(manifestTemp.getFile(),sidecar,args.contains("--overwrite"))) throw std::runtime_error("Audio complete but manifest publication failed or destination appeared");
                print(manifest);
            }
        }
        return 0;
    } catch(const std::exception& e) {
        print(object({{"status","error"},{"error",String::fromUTF8(e.what())},{"message",String::fromUTF8(e.what())}}));
        return 2;
    }
}
