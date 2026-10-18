#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>
#include <tonescope/Engine.h>
#include <tonescope/Session.h>
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
        std::map<std::string,std::string> args;
        std::set<std::string> allowed;
        if(command=="render") allowed={"--source","--out","--session","--block-size","--overwrite"};
        else if(command=="inspect") allowed={"--source"};
        else if(command=="compare") allowed={"--dry","--wet","--start","--end","--match"};
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
            auto c=compare(dry,wet,integer(args,"--start",0),integer(args,"--end",int(dry.frames())),args.contains("--match"));
            print(object({{"valid",c.valid},{"dryRms",c.dryRms},{"wetRms",c.wetRms},{"gain",c.gain},{"residualRms",c.residualRms},{"peak",c.peak},{"gainCapped",c.gainCapped}}));
        } else {
            File source=File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(required("--source").c_str()));
            const auto sourceHash=hashFile(source);
            auto audio=readWav(source.getFullPathName().toStdString());
            if(command=="inspect") {
                double energy=0,peak=0; size_t count=0;
                for(const auto& channel:audio.samples) for(float sample:channel) { energy+=double(sample)*sample; peak=std::max(peak,std::abs(double(sample))); ++count; }
                print(object({{"frames",int64(audio.frames())},{"channels",int(audio.samples.size())},{"sample_rate_hz",audio.sampleRate},{"rms",count?std::sqrt(energy/count):0},{"peak",peak}}));
            } else {
                auto p=args.contains("--session")?loadParameters(File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(args.at("--session").c_str()))):Parameters{};
                if(args.contains("--session")) {
                    auto saved=JSON::parse(File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(args.at("--session").c_str())));
                    if(auto digest=saved["source_sha256"]; !digest.isVoid() && digest.toString()!=sourceHash) throw std::runtime_error("Session source digest differs from supplied source");
                }
                std::string error;
                if(!validate(p,audio.sampleRate,error)) throw std::runtime_error(error);
                int block=integer(args,"--block-size",257);
                if(block<1 || block>65536) throw std::runtime_error("Block size must be 1..65536");
                File out=File::getCurrentWorkingDirectory().getChildFile(String::fromUTF8(required("--out").c_str()));
                const auto sidecar=out.getSiblingFile(out.getFileName()+".json");
                if(out==source || sidecar==source) throw std::runtime_error("Output must differ from source");
                if((out.exists() || sidecar.exists()) && !args.contains("--overwrite")) throw std::runtime_error("Output or manifest exists; select another path or --overwrite");
                auto rendered=render(audio,p,block);
                // Publish only a complete asset; a failed write leaves the destination intact.
                TemporaryFile temporary(out);
                writeWav(temporary.getFile().getFullPathName().toStdString(),rendered);
                if(hashFile(source)!=sourceHash) throw std::runtime_error("Source changed during render; retry from a stable file");
                if(!temporary.overwriteTargetFileWithTemporary()) throw std::runtime_error("Atomic output publication failed");
                auto graph=object({{"inputDb",p.inputDb},{"thresholdDb",p.thresholdDb},{"ratio",p.ratio},{"attackMs",p.attackMs},{"releaseMs",p.releaseMs},{"kneeDb",p.kneeDb},{"makeupDb",p.makeupDb},{"lowDb",p.lowDb},{"midDb",p.midDb},{"highDb",p.highDb},{"midHz",p.midHz},{"midQ",p.midQ},{"driveDb",p.driveDb},{"toneHz",p.toneHz},{"outputDb",p.outputDb},{"compressor",p.compressor},{"equalizer",p.equalizer},{"drive",p.drive},{"order",var(Array<var>{p.order[0],p.order[1],p.order[2]})}});
                auto graphText=JSON::toString(graph,true);
                auto graphHash=SHA256(graphText.toRawUTF8(),graphText.getNumBytesAsUTF8()).toHexString();
                auto manifest=object({{"schema_version",1},{"frames",int64(rendered.frames())},{"channels",int(rendered.samples.size())},{"sample_rate_hz",rendered.sampleRate},{"source_sha256",sourceHash},{"artifact_sha256",hashFile(out)},{"graph_sha256",graphHash},{"latency_samples",0},{"quality","1x development"},{"output",out.getFullPathName()}});
                TemporaryFile manifestTemp(sidecar);
                if(!manifestTemp.getFile().replaceWithText(JSON::toString(manifest)) || !manifestTemp.overwriteTargetFileWithTemporary()) throw std::runtime_error("Audio complete but manifest write failed");
                print(manifest);
            }
        }
        return 0;
    } catch(const std::exception& e) {
        print(object({{"status","error"},{"error",String::fromUTF8(e.what())},{"message",String::fromUTF8(e.what())}}));
        return 2;
    }
}
