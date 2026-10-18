#pragma once
#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>
#include <tonescope/Engine.h>
#include <tonescope/Session.h>
#include <tonescope/ParameterState.h>
#include <tonescope/Publication.h>
#include <algorithm>
#include <limits>
#include <array>
#include <atomic>
#include <functional>
#include <mutex>
#include <set>
#include <stdexcept>
#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <sddl.h>
#endif

namespace tonescope::desktop::assistant {
inline juce::var object(std::initializer_list<std::pair<const char*,juce::var>> fields){
 auto* result=new juce::DynamicObject;
 for(const auto& field:fields)result->setProperty(field.first,field.second);
 return juce::var(result);
}
inline void require(bool condition,const char* reason){if(!condition)throw std::runtime_error(reason);}
inline bool finiteNumber(const juce::var& v){return (v.isInt()||v.isInt64()||v.isDouble())&&std::isfinite(double(v));}
inline bool integer(const juce::var& v){return finiteNumber(v)&&double(v)>=0&&double(v)==std::floor(double(v))&&double(v)<=9007199254740991.;}
inline bool closed(const juce::var& v,std::initializer_list<const char*> keys){
 auto* value=v.getDynamicObject();if(!value||value->getProperties().size()!=(int)keys.size())return false;
 for(const auto& entry:value->getProperties()){bool found=false;for(auto* key:keys)if(entry.name==juce::Identifier(key))found=true;if(!found)return false;}
 return true;
}
inline bool digestText(const juce::String& text){return text.length()==64&&text.containsOnly("0123456789abcdef");}
inline bool opaqueId(const juce::String& text){return text.isNotEmpty()&&text.length()<=80&&text.containsOnly("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-");}
inline bool uuid(const juce::String& text){
 if(text.length()!=36||!text.containsOnly("0123456789abcdef-"))return false;
 for(int i=0;i<36;++i)if((i==8||i==13||i==18||i==23)!=(text[i]=='-'))return false;
 return true;
}
inline juce::String fileHash(const juce::File& file){auto stream=tonescope::session::fileForIo(file).createInputStream();require(bool(stream),"Cannot read an authorized assistant asset.");return juce::SHA256(*stream).toHexString();}
inline juce::String capability(){
 std::array<unsigned char,32> bytes{};
#if JUCE_WINDOWS
 auto library=LoadLibraryW(L"bcrypt.dll");require(library!=nullptr,"OS cryptographic entropy is unavailable.");
 using Generate=LONG(WINAPI*)(void*,unsigned char*,unsigned long,unsigned long);
 auto generate=reinterpret_cast<Generate>(GetProcAddress(library,"BCryptGenRandom"));
 auto status=generate?generate(nullptr,bytes.data(),(unsigned long)bytes.size(),2):-1;
 FreeLibrary(library);require(status>=0,"OS cryptographic entropy failed.");
#else
 auto stream=juce::File("/dev/urandom").createInputStream();require(stream&&stream->read(bytes.data(),(int)bytes.size())==(int)bytes.size(),"OS cryptographic entropy failed.");
#endif
 static constexpr char hex[]="0123456789abcdef";juce::String result;
 for(auto value:bytes){result+=juce::String::charToString(hex[value>>4]);result+=juce::String::charToString(hex[value&15]);}
 return result;
}
inline void protectPrivate(const juce::File& file){
#if JUCE_WINDOWS
 PSECURITY_DESCRIPTOR descriptor=nullptr;
 const auto converted=ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)",SDDL_REVISION_1,&descriptor,nullptr);
 require(converted!=FALSE,"Cannot create private assistant permissions.");
 const auto applied=SetFileSecurityW(file.getFullPathName().toWideCharPointer(),DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,descriptor);
 LocalFree(descriptor);require(applied!=FALSE,"Cannot protect private assistant storage.");
#else
 require(file.setReadOnly(false),"Cannot prepare private assistant storage.");
#endif
}
inline void atomicJson(const juce::File& destination,const juce::var& data){
 juce::TemporaryFile temp(tonescope::session::fileForIo(destination));
 require(temp.getFile().replaceWithText(juce::JSON::toString(data)),"Cannot write private assistant state.");
 protectPrivate(temp.getFile());require(temp.overwriteTargetFileWithTemporary(),"Cannot publish private assistant state.");
}
struct Context {
 juce::String sessionId,requestId,sourceHash,graphHash;
 juce::File sourceFile;
 uint64_t revision=0;
 int64_t first=0,last=0,cacheOffset=0;
 bool metricsOnly=false;double baselineRms=0,baselinePeak=0;
 double sampleRate=48000;
 int alignment=0;
 tonescope::Parameters parameters;
 std::shared_ptr<const tonescope::AudioData> rawWet;
 juce::var descriptors;
 juce::var selection() const {return juce::var(juce::Array<juce::var>{(juce::int64)first,(juce::int64)last});}
 juce::var binding() const {return object({{"session_id",sessionId},{"session_revision",(juce::int64)revision},{"source_sha256",sourceHash},{"base_graph_sha256",graphHash},{"selection_samples",selection()},{"sample_rate",(int)sampleRate}});}
 juce::var snapshot() const {
  return object({{"session_id",sessionId},{"session_revision",(juce::int64)revision},{"source_sha256",sourceHash},{"base_graph_sha256",graphHash},{"source_handle","native_asset"},{"selection_samples",selection()},{"sample_rate",(int)sampleRate},{"parameters",descriptors}});
 }
};
inline void validateMeasurements(const juce::var& value){
 auto* array=value.getArray();require(array&&array->size()>=1&&array->size()<=32,"Assistant measurements are missing or excessive.");
 std::set<juce::String> seen;
 for(const auto& m:*array){require(closed(m,{"measurement_id","value","unit"})&&opaqueId(m["measurement_id"].toString())&&finiteNumber(m["value"]),"Invalid assistant measurement.");require(seen.insert(m["measurement_id"].toString()).second,"Duplicate assistant measurement.");auto unit=m["unit"].toString();require(unit=="dBFS"||unit=="dB"||unit=="Hz"||unit=="ratio"||unit=="samples","Unsupported assistant measurement unit.");}
}
inline tonescope::Parameters patchParameters(const Context& context,const juce::var& patch){
 auto* patches=patch.getArray();require(patches&&patches->size()>=1&&patches->size()<=8,"Invalid assistant patch size.");
 auto parameters=tonescope::session::parametersToVar(context.parameters);std::set<juce::String> seen;
 for(const auto& item:*patches){
  require(closed(item,{"stage_id","parameter_id","unit","value"})&&finiteNumber(item["value"]),"Invalid assistant parameter patch.");
  const auto key=item["parameter_id"].toString();require(seen.insert(key).second,"Duplicate assistant parameter patch.");
  bool permitted=false;
  if(auto* descriptors=context.descriptors.getArray())for(const auto& descriptor:*descriptors){
   if(descriptor["stage_id"]==item["stage_id"]&&descriptor["parameter_id"]==item["parameter_id"]&&descriptor["unit"]==item["unit"]&&double(item["value"])>=double(descriptor["min"])&&double(item["value"])<=double(descriptor["max"]))permitted=true;
  }
  require(permitted,"Assistant parameter is not authorized by the native registry.");
  parameters.getDynamicObject()->setProperty(key,item["value"]);
 }
 auto document=object({{"schema_version",1},{"parameters",parameters}});
 return tonescope::session::loadParametersDocument(document);
}
inline std::pair<double,double> measuredDb(const tonescope::AudioData& audio,int64_t first,int64_t last){
 require(first>=0&&last>first&&last<=audio.frames()&&!audio.samples.empty(),"Invalid native measurement span.");
 double energy=0,peak=0;uint64_t count=0;
 for(const auto& channel:audio.samples)for(auto i=first;i<last;++i){const auto value=double(channel[(size_t)i]);require(std::isfinite(value),"Nonfinite native measurement.");energy+=value*value;peak=std::max(peak,std::abs(value));++count;}
 const auto db=[](double value){return 20*std::log10(std::max(1e-12,value));};return {db(std::sqrt(energy/double(count))),db(peak)};
}
struct FrozenMatch {double gain=1,db=0;bool capped=false,valid=false;};
inline FrozenMatch frozenMatch(double baselineRms,double candidateRms){
 if(!std::isfinite(baselineRms)||!std::isfinite(candidateRms)||baselineRms<=1e-9||candidateRms<=1e-9)return {};
 const double requestedDb=20*(std::log10(baselineRms)-std::log10(candidateRms));const double db=std::clamp(requestedDb,-12.,12.);
 return {std::pow(10.,db/20),db,std::abs(requestedDb-db)>1e-9,true};
}
struct Ready {
 juce::var envelope,proposal,preview;
 juce::File audioFile;
 tonescope::Parameters parameters;
 std::shared_ptr<const tonescope::AudioData> audio;
};
inline Ready validateReady(const Context& context,const juce::var& envelope,const juce::File& workDirectory){
 require(closed(envelope,{"schema_version","request_id","status","proposal","preview","reason","usage","trace_id","evidence_refs"}),"Invalid assistant response fields.");
 require(envelope["schema_version"].isInt()&&int(envelope["schema_version"])==1&&envelope["request_id"].toString()==context.requestId,"Assistant response identity differs.");
 auto usage=envelope["usage"];
 require(closed(usage,{"tool_calls","candidate_frames","input_tokens","output_tokens","cost_usd","latency_ms"}),"Invalid assistant usage report.");
 for(auto* key:{"tool_calls","candidate_frames","input_tokens","output_tokens","latency_ms"})require(integer(usage[key]),"Invalid assistant usage counter.");
 require(double(usage["tool_calls"])<=8&&double(usage["candidate_frames"])<=context.sampleRate*30&&double(usage["input_tokens"])<=12000&&double(usage["output_tokens"])<=4000&&double(usage["latency_ms"])<=60000&&finiteNumber(usage["cost_usd"])&&double(usage["cost_usd"])==0,"Assistant exceeded the offline native budget.");
 require(uuid(envelope["trace_id"].toString()),"Invalid assistant trace identity.");
 require(envelope["status"].toString()=="ready"&&envelope["reason"].isVoid(),"Assistant did not return a ready proposal.");
 const auto p=envelope["proposal"],preview=envelope["preview"];
 require(closed(p,{"schema_version","request_id","session_revision","source_sha256","base_graph_sha256","selection_samples","hypotheses","evidence_refs","parameter_patch","expected_tradeoffs","limitations","requires_user_acceptance"}),"Invalid assistant proposal fields.");
 require(p["schema_version"].isInt()&&int(p["schema_version"])==1&&p["request_id"].toString()==context.requestId&&integer(p["session_revision"])&&uint64_t(juce::int64(p["session_revision"]))==context.revision&&p["source_sha256"].toString()==context.sourceHash&&p["base_graph_sha256"].toString()==context.graphHash&&juce::JSON::toString(p["selection_samples"],true)==juce::JSON::toString(context.selection(),true)&&p["requires_user_acceptance"].isBool()&&bool(p["requires_user_acceptance"]),"Stale, forged or cross-session assistant proposal.");
 for(auto* key:{"hypotheses","expected_tradeoffs","limitations"}){auto* entries=p[key].getArray();require(entries&&entries->size()>=1&&entries->size()<=8,"Missing assistant explanation.");for(const auto& entry:*entries)require(entry.isString()&&entry.toString().isNotEmpty()&&entry.toString().length()<=500&&!entry.toString().containsAnyOf("0123456789"),"Unverified numerical assistant claim.");}
 validateMeasurements(p["evidence_refs"]);validateMeasurements(envelope["evidence_refs"]);
 require(context.metricsOnly||bool(context.rawWet),"Missing native baseline evidence.");const auto baselineDb=context.metricsOnly?std::pair<double,double>{20*std::log10(std::max(1e-12,context.baselineRms)),20*std::log10(std::max(1e-12,context.baselinePeak))}:measuredDb(*context.rawWet,context.first-context.cacheOffset+context.alignment,context.last-context.cacheOffset+context.alignment);
 for(const auto& evidence:*p["evidence_refs"].getArray()){const auto key=evidence["measurement_id"].toString();require(evidence["unit"].toString()=="dBFS"&&(key=="rms_dbfs"||key=="peak_dbfs")&&std::abs(double(evidence["value"])-(key=="rms_dbfs"?baselineDb.first:baselineDb.second))<=1e-5,"Assistant evidence differs from independently measured native baseline.");}
 require(juce::JSON::toString(p["evidence_refs"],true)==juce::JSON::toString(envelope["evidence_refs"],true),"Assistant evidence binding differs.");
 require(closed(preview,{"preview_id","audio_sha256","session_revision","measurements"})&&uuid(preview["preview_id"].toString())&&digestText(preview["audio_sha256"].toString())&&integer(preview["session_revision"])&&juce::int64(preview["session_revision"])==(juce::int64)context.revision,"Invalid assistant preview binding.");
 validateMeasurements(preview["measurements"]);
 const auto folder=workDirectory.getChildFile(preview["preview_id"].toString());
 const auto audio=folder.getChildFile("preview.wav");require(audio.isAChildOf(workDirectory)&&audio.existsAsFile()&&!audio.isSymbolicLink()&&!folder.isSymbolicLink(),"Assistant preview is outside its private directory.");
 require(fileHash(audio)==preview["audio_sha256"].toString(),"Assistant preview digest differs.");
 const auto manifest=juce::JSON::parse(tonescope::session::fileForIo(audio.getSiblingFile(audio.getFileName()+".json")));
 require(manifest["source_sha256"].toString()==context.sourceHash&&manifest["artifact_sha256"].toString()==preview["audio_sha256"].toString()&&integer(manifest["frames"])&&juce::int64(manifest["frames"])==context.last-context.first&&double(manifest["sample_rate_hz"])==context.sampleRate,"Assistant preview manifest differs.");
 auto parameters=patchParameters(context,p["parameter_patch"]);
 require(manifest["graph_sha256"].toString()==tonescope::session::hashParameters(parameters),"Assistant candidate graph differs from its parameter patch.");
 require(juce::JSON::toString(manifest["selection_samples"],true)==juce::JSON::toString(context.selection(),true)&&integer(manifest["processed_frames"])&&juce::int64(manifest["processed_frames"])==context.last+context.alignment&&integer(manifest["alignment_samples"])&&int(manifest["alignment_samples"])==context.alignment,"Assistant candidate processing span differs.");
 require(double(usage["candidate_frames"])>=context.last+context.alignment&&double(usage["tool_calls"])>=5,"Assistant omitted required preview work.");
 auto data=std::make_shared<tonescope::AudioData>(tonescope::readWav(audio.getFullPathName().toStdString()));require(data->frames()==context.last-context.first&&data->sampleRate==context.sampleRate,"Assistant audio layout differs.");
 const auto candidateDb=measuredDb(*data,0,data->frames());
 for(const auto& evidence:*preview["measurements"].getArray()){const auto key=evidence["measurement_id"].toString();require(evidence["unit"].toString()=="dBFS"&&(key=="preview_rms_dbfs"||key=="preview_peak_dbfs")&&std::abs(double(evidence["value"])-(key=="preview_rms_dbfs"?candidateDb.first:candidateDb.second))<=1e-5,"Assistant preview measurements differ from native audio readback.");}
 return {envelope,p,preview,audio,parameters,data};
}

class Bridge final : public std::enable_shared_from_this<Bridge> {
 struct Job final:juce::ThreadPoolJob {std::function<void()> fn;explicit Job(std::function<void()> f):juce::ThreadPoolJob("Assistant local broker"),fn(std::move(f)){}JobStatus runJob()override{fn();return jobHasFinished;}};
 juce::ThreadPool work{1},control{1};
 juce::ChildProcess child;
 std::mutex childMutex,cancelMutex,serverMutex;
 std::set<juce::String> canceledRequests;
 bool canceled(const juce::String& id){std::scoped_lock lock(cancelMutex);return canceledRequests.contains(id);}
 std::atomic<bool> stopping{false};
 std::atomic<int> port{0};
 juce::String token;
 juce::File node,service,entry,cli,privateDirectory,environmentFile,manifestFile,historyDirectory,readyFile;
 juce::String session=capability().substring(0,32);
 static juce::File findService(){
  auto configured=juce::SystemStats::getEnvironmentVariable("TONESCOPE_ASSISTANT_DIR",{});if(configured.isNotEmpty())return juce::File(configured);
  auto folder=juce::File::getSpecialLocation(juce::File::currentExecutableFile).getParentDirectory();
  for(int i=0;i<9;++i){auto candidate=folder.getChildFile("services/audio-assistant");if(candidate.getChildFile("agent/lib/host.ts").existsAsFile())return candidate;folder=folder.getParentDirectory();}
  return {};
 }
 static juce::File findNode(){
  auto configured=juce::SystemStats::getEnvironmentVariable("TONESCOPE_NODE_PATH",{});if(configured.isNotEmpty())return juce::File(configured);
  auto bundled=juce::File::getSpecialLocation(juce::File::currentExecutableFile).getSiblingFile("node.exe");if(bundled.existsAsFile())return bundled;
  auto candidate=juce::File(juce::SystemStats::getEnvironmentVariable("ProgramFiles","C:/Program Files")).getChildFile("nodejs/node.exe");if(candidate.existsAsFile())return candidate;return {};
 }
 static juce::File findCli(){
  auto configured=juce::SystemStats::getEnvironmentVariable("TONESCOPE_CLI_PATH",{});if(configured.isNotEmpty())return juce::File(configured);
  auto folder=juce::File::getSpecialLocation(juce::File::currentExecutableFile).getParentDirectory();
  for(int i=0;i<7;++i){for(auto path:{"tonescope_cli.exe","tonescope_cli_artefacts/Release/tonescope_cli.exe"}){auto candidate=folder.getChildFile(path);if(candidate.existsAsFile())return candidate;}folder=folder.getParentDirectory();}return {};
 }
 void startServer(){
  if(port.load()!=0)return;
  require(!stopping,"Assistant is stopping.");
  readyFile.deleteFile();readyFile.getSiblingFile(readyFile.getFileName()+".tmp").deleteFile();
  juce::StringArray arguments{node.getFullPathName(),"--env-file="+environmentFile.getFullPathName(),"--experimental-strip-types",entry.getFullPathName(),"--native-env-file",environmentFile.getFullPathName(),"--native-ready-file",readyFile.getFullPathName()};
  {std::scoped_lock lock(childMutex);require(child.start(arguments,0),"Cannot start the optional local assistant.");}
  const auto deadline=juce::Time::getMillisecondCounterHiRes()+8000;
  while(!stopping&&juce::Time::getMillisecondCounterHiRes()<deadline){
   if(readyFile.existsAsFile()){
    require(readyFile.getSize()<=4096,"Invalid local assistant handshake.");auto ready=juce::JSON::parse(readyFile);auto address=ready["address"];
    require(ready["schema_version"].isInt()&&int(ready["schema_version"])==1&&ready["provider"].toString()=="rules"&&ready["live_enabled"].isBool()&&!bool(ready["live_enabled"])&&address["address"].toString()=="127.0.0.1"&&integer(address["port"])&&int(address["port"])>=1&&int(address["port"])<=65535,"Local assistant handshake was rejected.");port=int(address["port"]);return;
   }
   {std::scoped_lock lock(childMutex);if(!child.isRunning())break;}
   juce::Thread::sleep(10);
  }
  throw std::runtime_error("Local assistant did not complete its authenticated handshake.");
 }
public:
 using Completion=std::function<void(juce::var,juce::String)>;
 const juce::File& directory()const{return privateDirectory;}
 juce::File previewDirectory()const{return privateDirectory.getChildFile("previews");}
 juce::String sessionId()const{return session;}
 void post(std::function<void()> fn){work.addJob(new Job(std::move(fn)),true);}
 juce::String prepare(){
  node=findNode();service=findService();cli=findCli();
  auto packaged=juce::File::getSpecialLocation(juce::File::currentExecutableFile).getSiblingFile("assistant/host.mjs");
  if(packaged.existsAsFile())entry=packaged;else if(service.getChildFile("host.mjs").existsAsFile())entry=service.getChildFile("host.mjs");else if(service.getChildFile("node_modules/eve/package.json").existsAsFile())entry=service.getChildFile("agent/lib/host.ts");
  if(!node.existsAsFile()||!cli.existsAsFile()||!entry.existsAsFile())return "Optional assistant unavailable. Install its pinned Node service and select a native CLI; audio remains available.";
  token=capability();auto configuredData=juce::SystemStats::getEnvironmentVariable("TONESCOPE_ASSISTANT_DATA_DIR",{});require(configuredData.isEmpty()||juce::File::isAbsolutePath(configuredData),"Native assistant data directory must be absolute.");auto base=configuredData.isNotEmpty()?juce::File(configuredData):juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("ToneScope/assistant");require(base.createDirectory(),"Cannot create private assistant directory.");protectPrivate(base);
  historyDirectory=base.getChildFile("history");require(historyDirectory.createDirectory(),"Cannot create private assistant history.");protectPrivate(historyDirectory);
  privateDirectory=base.getChildFile(juce::Uuid().toDashedString());require(privateDirectory.createDirectory(),"Cannot create assistant work directory.");protectPrivate(privateDirectory);
  readyFile=privateDirectory.getChildFile("ready.json");environmentFile=privateDirectory.getChildFile("native.env");manifestFile=privateDirectory.getChildFile("manifest.json");
  auto manifestPath=manifestFile.getFullPathName().replaceCharacter('\\','/');
  require(!manifestPath.containsAnyOf("\r\n\""),"Invalid private assistant directory.");
  require(environmentFile.replaceWithText("TONESCOPE_HOST_MANIFEST=\""+manifestPath+"\"\nTONESCOPE_BROKER_TOKEN="+token+"\nTONESCOPE_ENABLE_LIVE=0\n"),"Cannot create private assistant capability.");protectPrivate(environmentFile);
  return {};
 }
 juce::var http(const juce::String& method,const juce::String& route,const juce::var& body,int timeout=65000){
  require(port.load()>0&&!stopping,"Optional assistant is not connected.");
  auto url=juce::URL("http://127.0.0.1:"+juce::String(port.load())+route);
  if(method=="POST")url=url.withPOSTData(juce::JSON::toString(body,true));
  int status=0;auto options=juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress).withHttpRequestCmd(method).withExtraHeaders("Authorization: Bearer "+token+"\r\nContent-Type: application/json\r\n").withConnectionTimeoutMs(timeout).withNumRedirectsToFollow(0).withStatusCode(&status);
  auto stream=url.createInputStream(options);require(bool(stream)&&status==200,"Local assistant request failed.");
  juce::MemoryBlock bytes;std::array<char,4096> buffer{};
  while(!stream->isExhausted()){require(!stopping,"Assistant is stopping.");auto count=stream->read(buffer.data(),(int)buffer.size());if(count<=0)break;bytes.append(buffer.data(),(size_t)count);require(bytes.getSize()<=65536,"Local assistant response is excessive.");}
  auto response=juce::JSON::parse(juce::String::fromUTF8((const char*)bytes.getData(),(int)bytes.getSize()));require(response.isObject(),"Invalid local assistant JSON.");return response;
 }
 void request(Context context,juce::String prompt,Completion complete){
  auto self=shared_from_this();post([self,context=std::move(context),prompt=std::move(prompt),complete=std::move(complete)]()mutable{
   try{
    require(!self->stopping&&!self->canceled(context.requestId)&&prompt.getNumBytesAsUTF8()<=7000,"Assistant request is canceled or excessive.");
    require(context.first>=0&&context.last>context.first&&context.last+context.alignment<=int64_t(context.sampleRate*30)&&context.alignment==((context.parameters.drive&&context.parameters.oversampling>1)?32:0),"Assistant selection exceeds its processing budget or alignment differs.");
    require(fileHash(context.sourceFile)==context.sourceHash,"Source changed before the assistant request.");
    auto asset=object({{"snapshot",context.snapshot()},{"source_path",context.sourceFile.getFullPathName()},{"parameters",tonescope::session::parametersToVar(context.parameters)}});
    if(context.metricsOnly){
     require(std::isfinite(context.baselineRms)&&context.baselineRms>=0&&std::isfinite(context.baselinePeak)&&context.baselinePeak>=0,"Invalid native full-band baseline measurements.");
     asset.getDynamicObject()->setProperty("baseline_metrics",object({{"rms",context.baselineRms},{"peak",context.baselinePeak},{"alignment_samples",context.alignment},{"binding",context.binding()}}));
    }else{
     require(context.rawWet&&context.first>=context.cacheOffset&&context.last-context.cacheOffset+context.alignment<=context.rawWet->frames(),"Assistant baseline is outside its exact native cache.");
     tonescope::AudioData baseline;baseline.sampleRate=context.sampleRate;baseline.samples.resize(context.rawWet->samples.size());
     for(size_t c=0;c<baseline.samples.size();++c){require(!self->stopping,"Assistant is stopping.");const auto& input=context.rawWet->samples[c];baseline.samples[c].assign(input.begin()+context.first-context.cacheOffset+context.alignment,input.begin()+context.last-context.cacheOffset+context.alignment);}
     auto baselineFile=self->privateDirectory.getChildFile("baseline-"+context.requestId+".wav");tonescope::writeWav(baselineFile.getFullPathName().toStdString(),baseline);protectPrivate(baselineFile);
     auto manifest=object({{"schema_version",1},{"frames",(juce::int64)baseline.frames()},{"channels",(int)baseline.samples.size()},{"sample_rate_hz",baseline.sampleRate},{"source_sha256",context.sourceHash},{"artifact_sha256",fileHash(baselineFile)},{"graph_sha256",context.graphHash},{"selection_samples",context.selection()},{"processed_frames",(juce::int64)(context.last+context.alignment)},{"alignment_samples",context.alignment}});
     atomicJson(baselineFile.getSiblingFile(baselineFile.getFileName()+".json"),manifest);asset.getDynamicObject()->setProperty("baseline_path",baselineFile.getFullPathName());
    }
    auto registry=object({{"executable",self->cli.getFullPathName()},{"work_directory",self->previewDirectory().getFullPathName()},{"state_directory",self->historyDirectory.getFullPathName()},{"port",0},{"assets",juce::var(juce::Array<juce::var>{asset})}});
    std::unique_lock serverLock(self->serverMutex);require(!self->canceled(context.requestId),"Assistant request was canceled.");atomicJson(self->manifestFile,registry);self->startServer();require(!self->canceled(context.requestId),"Assistant request was canceled.");
    auto request=object({{"schema_version",1},{"request_id",context.requestId},{"session_id",context.sessionId},{"prompt",prompt}});
    require(juce::JSON::toString(request,true).getNumBytesAsUTF8()<=8192,"Assistant request exceeds eight KiB.");
    auto response=self->http("POST","/v1/request",request);complete(response,{});
   }catch(const std::exception& error){{if(!self->canceled(context.requestId)||self->port.load()==0){std::scoped_lock lock(self->childMutex);self->child.kill();self->port=0;}}complete({},juce::String(error.what()));}
  });
 }
 void cancel(const juce::String& requestId){{std::scoped_lock lock(cancelMutex);canceledRequests.insert(requestId);}auto self=shared_from_this();control.addJob(new Job([self,requestId]{try{if(self->port.load()>0)self->http("POST","/v1/requests/"+requestId+"/cancel?session_id="+self->session,object({}),3000);}catch(...){}}),true);}
 void deleteHistory(Completion complete){auto self=shared_from_this();control.addJob(new Job([self,complete]{try{if(self->port.load()>0)self->http("DELETE","/v1/session?session_id="+self->session,{});std::unique_lock serverLock(self->serverMutex);{std::scoped_lock lock(self->childMutex);self->child.kill();self->port=0;}require(self->previewDirectory().isAChildOf(self->privateDirectory)&&self->previewDirectory().deleteRecursively(),"Cannot delete private assistant previews.");for(const auto& file:self->historyDirectory.findChildFiles(juce::File::findFiles,false,"*.json*")){auto name=file.getFileName();if(name.length()>=69&&digestText(name.substring(0,64))&&name.substring(64).startsWith(".json"))require(file.deleteFile(),"Cannot delete assistant history.");}for(const auto& file:self->privateDirectory.findChildFiles(juce::File::findFiles,false,"baseline-*.wav*"))require(file.deleteFile(),"Cannot delete assistant baseline cache.");self->session=capability().substring(0,32);complete({},{});}catch(const std::exception& error){complete({},juce::String(error.what()));}}),true);}
 void shutdown(){stopping=true;{std::scoped_lock lock(childMutex);child.kill();port=0;}control.removeAllJobs(true,-1);work.removeAllJobs(true,-1);}
 ~Bridge(){shutdown();if(privateDirectory!=juce::File{}&&uuid(privateDirectory.getFileName()))privateDirectory.deleteRecursively();}
};
}
