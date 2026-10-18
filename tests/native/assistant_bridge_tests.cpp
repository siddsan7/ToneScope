#include "../../apps/desktop/AssistantBridge.h"
#include <future>
#include <iostream>
#include <thread>
using namespace tonescope::desktop::assistant;
static void rejected(std::function<void()> operation,const char* label){bool failed=false;try{operation();}catch(...){failed=true;}require(failed,label);}
static juce::var copy(const juce::var& input){return juce::JSON::parse(juce::JSON::toString(input));}
int main(){
 auto folder=juce::File::getCurrentWorkingDirectory().getChildFile("assistant-helper-"+juce::Uuid().toDashedString());
 const auto dataDirectory=folder.getChildFile("private-state");
 std::shared_ptr<Bridge> bridge;
 try{
  require(folder.createDirectory(),"Cannot create native test directory.");
  require(capability()!=capability(),"OS capabilities repeated.");
  require(!uuid("../preview.wav")&&!uuid("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")&&uuid(juce::Uuid().toDashedString()),"Invalid UUID path validation.");
  tonescope::AudioData input;input.sampleRate=48000;input.samples.assign(1,std::vector<float>(48000));
  for(size_t i=0;i<input.samples[0].size();++i)input.samples[0][i]=(float)(.04*std::sin(2*juce::MathConstants<double>::pi*440*i/48000.));
  auto file=folder.getChildFile("source.wav");tonescope::writeWav(file.getFullPathName().toStdString(),input);
  #if JUCE_WINDOWS
  SetEnvironmentVariableW(L"TONESCOPE_ASSISTANT_DATA_DIR",dataDirectory.getFullPathName().toWideCharPointer());
#endif
  bridge=std::make_shared<Bridge>();require(bridge->prepare().isEmpty(),"Native helper could not discover configured service/runtime/CLI.");
  Context context;context.sessionId=bridge->sessionId();context.requestId=juce::Uuid().toDashedString();context.sourceHash=fileHash(file);context.parameters={};context.parameters.drive=true;context.parameters.oversampling=2;context.graphHash=tonescope::session::hashParameters(context.parameters);context.sourceFile=file;context.revision=7;context.first=12000;context.last=36000;context.sampleRate=48000;context.alignment=32;context.rawWet=std::make_shared<tonescope::AudioData>(tonescope::render(input,context.parameters));context.descriptors=tonescope::session::parameterDescriptors(context.parameters,context.sampleRate);
  std::promise<juce::var> promise;auto future=promise.get_future();
  bridge->request(context,"make louder",[&promise](juce::var response,juce::String error){if(error.isNotEmpty())promise.set_exception(std::make_exception_ptr(std::runtime_error(error.toStdString())));else promise.set_value(response);});
  require(future.wait_for(std::chrono::seconds(30))==std::future_status::ready,"Native broker request timed out.");
  auto response=future.get();if(response["status"].toString()!="ready")std::cerr<<"status="<<response["status"].toString()<<" reason="<<response["reason"].toString()<<" usage="<<juce::JSON::toString(response["usage"],true)<<"\n";  auto ready=validateReady(context,response,bridge->previewDirectory());
  require(std::abs(ready.parameters.outputDb-6)<1e-6&&context.parameters.outputDb==0,"Proposal changed parameters before explicit native acceptance.");
  require(juce::int64(response["usage"]["candidate_frames"])==context.last+context.alignment,"Prehistory and alignment processing were not charged.");
  require(ready.audio->frames()==context.last-context.first,"Candidate crop layout differs.");
  const auto base=measuredDb(*context.rawWet,context.first+context.alignment,context.last+context.alignment),candidate=measuredDb(*ready.audio,0,ready.audio->frames());
  require(std::abs(candidate.first-base.first-6)<1e-4,"Actual candidate gain differs from its numerical patch.");
  auto changed=copy(response);changed["proposal"].getDynamicObject()->setProperty("session_revision",8);rejected([&]{validateReady(context,changed,bridge->previewDirectory());},"Stale proposal accepted.");
  changed=copy(response);changed["proposal"].getDynamicObject()->setProperty("requires_user_acceptance",false);rejected([&]{validateReady(context,changed,bridge->previewDirectory());},"Automatic acceptance was accepted.");
  changed=copy(response);changed["proposal"]["evidence_refs"].getArray()->getReference(0).getDynamicObject()->setProperty("value",-3.);changed.getDynamicObject()->setProperty("evidence_refs",changed["proposal"]["evidence_refs"]);rejected([&]{validateReady(context,changed,bridge->previewDirectory());},"Forged numerical evidence accepted.");
  changed=copy(response);changed["proposal"]["parameter_patch"].getArray()->getReference(0).getDynamicObject()->setProperty("parameter_id","oversampling");rejected([&]{validateReady(context,changed,bridge->previewDirectory());},"Topology change was accepted.");
  changed=copy(response);changed["preview"].getDynamicObject()->setProperty("preview_id","../source");rejected([&]{validateReady(context,changed,bridge->previewDirectory());},"Preview path traversal accepted.");
  auto other=context;other.requestId=juce::Uuid().toDashedString();rejected([&]{validateReady(other,response,bridge->previewDirectory());},"Cross-request proposal accepted.");
  changed=copy(response);changed["preview"]["measurements"].getArray()->getReference(0).getDynamicObject()->setProperty("value",-3.);rejected([&]{validateReady(context,changed,bridge->previewDirectory());},"Forged preview measurement accepted.");
  auto metricContext=context;metricContext.requestId=juce::Uuid().toDashedString();metricContext.metricsOnly=true;metricContext.baselineRms=std::pow(10.,base.first/20);metricContext.baselinePeak=std::pow(10.,base.second/20);metricContext.rawWet.reset();
  std::promise<juce::var> metricPromise;auto metricFuture=metricPromise.get_future();bridge->request(metricContext,"make louder",[&metricPromise](juce::var result,juce::String error){if(error.isNotEmpty())metricPromise.set_exception(std::make_exception_ptr(std::runtime_error(error.toStdString())));else metricPromise.set_value(result);});require(metricFuture.wait_for(std::chrono::seconds(30))==std::future_status::ready,"Native metrics fallback timed out.");auto metricReady=validateReady(metricContext,metricFuture.get(),bridge->previewDirectory());require(std::abs(measuredDb(*metricReady.audio,0,metricReady.audio->frames()).first-candidate.first)<1e-5,"Native measured fallback differs from actual cached baseline.");
  require(ready.audioFile.appendData("x",1),"Cannot prepare tamper fixture.");rejected([&]{validateReady(context,response,bridge->previewDirectory());},"Modified candidate audio was accepted.");
  tonescope::session::ParameterHistory history;history.reset(context.parameters);require(history.commit(ready.parameters),"Accepted patch did not create one transaction.");tonescope::Parameters undo;require(history.undo(undo)&&tonescope::session::hashParameters(undo)==context.graphHash&&!history.undo(undo),"Undo did not reverse exactly one complete patch.");
  auto canceledContext=context;canceledContext.requestId=juce::Uuid().toDashedString();std::promise<bool> canceled;auto cancellation=canceled.get_future();bridge->cancel(canceledContext.requestId);bridge->request(canceledContext,"make louder",[&canceled](juce::var result,juce::String error){canceled.set_value(error.isNotEmpty()||result["status"].toString()!="ready");});require(cancellation.wait_for(std::chrono::seconds(5))==std::future_status::ready&&cancellation.get(),"Canceled request returned a ready proposal.");
  std::promise<void> deleted;auto deletion=deleted.get_future();bridge->deleteHistory([&deleted](juce::var,juce::String error){if(error.isNotEmpty())deleted.set_exception(std::make_exception_ptr(std::runtime_error(error.toStdString())));else deleted.set_value();});require(deletion.wait_for(std::chrono::seconds(10))==std::future_status::ready,"History deletion timed out.");deletion.get();
  require(!ready.audioFile.existsAsFile(),"History deletion retained a native preview.");
  bridge->shutdown();bridge.reset();dataDirectory.deleteRecursively();folder.deleteRecursively();
  std::cout<<"assistant native protocol: real cropped render/hash/measurement; forged/stale/automatic/cross-request/topology/path/tamper rejection; history deletion passed\n";return 0;
 }catch(const std::exception& error){if(bridge){bridge->shutdown();bridge.reset();}dataDirectory.deleteRecursively();folder.deleteRecursively();std::cerr<<error.what()<<'\n';return 1;}
}
