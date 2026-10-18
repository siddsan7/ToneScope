// Included inside Main. All methods run on the message thread unless a worker is explicit.
std::shared_ptr<tonescope::desktop::assistant::Bridge> assistantBridge;
std::optional<tonescope::desktop::assistant::Context> assistantContext;
std::shared_ptr<tonescope::desktop::assistant::Ready> assistantReady;
std::shared_ptr<const Rendered> assistantPreviewRender,assistantOriginalRender;
juce::String assistantState="unavailable",assistantMessage="Optional assistant is starting.";
uint64_t assistantGeneration=0,assistantOriginalRevision=0;
int assistantOriginalMode=2;bool assistantOriginalMatch=false,assistantAuditioning=false,assistantOriginalLoop=false,assistantOriginalPlaying=false;double assistantOriginalPosition=0;

bool assistantCurrent(const tonescope::desktop::assistant::Context& context) const {
 return source&&context.revision==revision&&context.sourceHash==sourceDigest&&context.graphHash==tonescope::session::hashParameters(parameters())&&context.sourceFile==sourceFile&&context.first==selectionStart.load()&&context.last==selectionEnd.load()&&!monitoring.load()&&!busy&&auditionBand==0;
}
void restoreAssistantAudition(){
 if(!assistantAuditioning)return;
 playing=false;retireFilePlayback();detach();rendered=assistantOriginalRender;renderedRevision=assistantOriginalRevision;
 if(rendered){scope.data=rendered;sourceStep=rendered->dry->sampleRate/deviceRate.load();}
 mode.setSelectedId(assistantOriginalMode,juce::dontSendNotification);audition=assistantOriginalMode;match.setToggleState(assistantOriginalMatch,juce::dontSendNotification);
 loop.setToggleState(assistantOriginalLoop,juce::dontSendNotification);looping=assistantOriginalLoop;position=assistantOriginalPosition;assistantOriginalRender.reset();assistantAuditioning=false;attach();if(assistantOriginalPlaying){if(streamedSource)startFilePlayback((int64_t)assistantOriginalPosition);else playing=true;}
}
void assistantSessionChanged(){
 restoreAssistantAudition();
 if(assistantContext&&assistantBridge)assistantBridge->cancel(assistantContext->requestId);
 ++assistantGeneration;assistantContext.reset();assistantReady.reset();assistantPreviewRender.reset();
 if(assistantState!="unavailable"){assistantState="idle";assistantMessage="Session changed. Ask again for a current measured proposal.";}
}
void updateAssistant(){
 if(assistantContext&&!assistantCurrent(*assistantContext))assistantSessionChanged();
}
juce::var assistantPublicState(){
 using namespace tonescope::desktop::assistant;
 auto result=object({{"status",assistantState},{"message",assistantMessage}});
 if(assistantContext)result.getDynamicObject()->setProperty("requestId",assistantContext->requestId);
 if(assistantReady&&assistantContext){
  juce::String predicted;for(const auto& item:*assistantReady->proposal["hypotheses"].getArray()){if(predicted.isNotEmpty())predicted+=" ";predicted+=item.toString();}
  juce::String measured;for(const auto& item:*assistantReady->preview["measurements"].getArray()){if(measured.isNotEmpty())measured+=" | ";measured+=item["measurement_id"].toString()+": "+juce::String(double(item["value"]),2)+" "+item["unit"].toString();}
  result.getDynamicObject()->setProperty("proposal",object({{"id",assistantContext->requestId},{"summary","Measured candidate ready for review"},{"predicted",predicted},{"measured",measured},{"sourceRevision",(juce::int64)assistantContext->revision},{"previewReady",true}}));
 }
 return result;
}
void initialiseAssistant(){
#if TONESCOPE_WEB_FRONTEND
 try{assistantBridge=std::make_shared<tonescope::desktop::assistant::Bridge>();}catch(...){assistantState="unavailable";assistantMessage="OS cryptographic capability setup failed. Audio remains available.";return;}
 assistantCommand=[this](juce::String action,juce::var input){return handleAssistantCommand(action,input);};
 auto safe=juce::Component::SafePointer<Main>(this);auto bridge=assistantBridge;
 bridge->post([safe,bridge]{juce::String error;try{error=bridge->prepare();}catch(...){error="Optional assistant setup failed. Audio remains available.";}
  juce::MessageManager::callAsync([safe,error]{if(!safe)return;safe->assistantState=error.isEmpty()?"idle":"unavailable";safe->assistantMessage=error.isEmpty()?"Offline measured level assistant. Audio stays on this computer; every change needs your acceptance.":error;});
 });
#endif
}
void shutdownAssistant(){
#if TONESCOPE_WEB_FRONTEND
 assistantCommand={};
#endif
 restoreAssistantAudition();++assistantGeneration;assistantContext.reset();assistantReady.reset();assistantPreviewRender.reset();
 if(assistantBridge){assistantBridge->shutdown();assistantBridge.reset();}
}
juce::var handleAssistantCommand(const juce::String& action,const juce::var& input){
 using namespace tonescope::desktop::assistant;
 if(action=="assistant.status"){updateAssistant();return assistantPublicState();}
 if(!assistantBridge||assistantState=="unavailable")return assistantPublicState();
 if(action=="assistant.cancel"||action=="assistant.dismiss"){
  if(assistantContext&&input.hasProperty("requestId")&&input["requestId"].toString()!=assistantContext->requestId)return assistantPublicState();
  if(assistantContext&&input.hasProperty("proposalId")&&input["proposalId"].toString()!=assistantContext->requestId)return assistantPublicState();
  assistantSessionChanged();assistantMessage="Assistant request dismissed. No parameter change was applied.";return assistantPublicState();
 }
 if(action=="assistant.history.delete"){
  assistantSessionChanged();assistantState="running";assistantMessage="Deleting local assistant history and previews...";
  auto safe=juce::Component::SafePointer<Main>(this);const auto generation=assistantGeneration;
  assistantBridge->deleteHistory([safe,generation](juce::var,juce::String error){juce::MessageManager::callAsync([safe,generation,error]{if(!safe||safe->assistantGeneration!=generation)return;safe->assistantState=error.isEmpty()?"idle":"error";safe->assistantMessage=error.isEmpty()?"Assistant history and previews deleted.":"Assistant history deletion failed. Retry before closing.";});});
  return assistantPublicState();
 }
 if(action=="assistant.ask"){
  if(assistantState=="running")return assistantPublicState();
  try{
   require(input["prompt"].isString()&&input["prompt"].toString().isNotEmpty()&&input["prompt"].toString().getNumBytesAsUTF8()<=7000,"Enter a request of at most seven KiB.");
   restoreAssistantAudition();
   require(source&&sourceFile!=juce::File{}&&digestText(sourceDigest)&&rendered&&renderedRevision==revision&&!busy&&!monitoring&&auditionBand==0,"Wait for a current file render, stop monitoring, and select All bands before asking the assistant.");
   assistantSessionChanged();
   Context context;context.sessionId=assistantBridge->sessionId();context.requestId=juce::Uuid().toDashedString();context.sourceHash=sourceDigest;context.graphHash=tonescope::session::hashParameters(parameters());context.sourceFile=sourceFile;context.revision=revision;context.first=selectionStart.load();context.last=selectionEnd.load();context.sampleRate=sourceSampleRate();context.cacheOffset=inspectionOffset;context.alignment=rendered->latency;context.parameters=parameters();context.rawWet=rendered->exportWet;context.descriptors=tonescope::session::parameterDescriptors(context.parameters,context.sampleRate);context.metricsOnly=context.first<context.cacheOffset||context.last-context.cacheOffset+context.alignment>context.rawWet->frames();context.baselineRms=rendered->comparison.wetRms;context.baselinePeak=rendered->comparison.peak/std::max(1e-12,rendered->comparison.gain);
   require(context.last>context.first&&context.last+context.alignment<=int64_t(context.sampleRate*30),"Choose a passage whose processing from source start fits the assistant's thirty-second budget.");
   assistantContext=context;assistantState="running";assistantMessage="Reading native measurements and evaluating a local candidate...";
   const auto generation=assistantGeneration;auto safe=juce::Component::SafePointer<Main>(this);auto bridge=assistantBridge;auto base=rendered;
   bridge->request(context,input["prompt"].toString(),[safe,bridge,context,generation,base](juce::var response,juce::String error){
    std::shared_ptr<Ready> ready;std::shared_ptr<Rendered> previewRender;juce::String message;
    try{
     if(error.isNotEmpty())throw std::runtime_error("Local assistant request failed. Check the optional service setup.");
     require(closed(response,{"schema_version","request_id","status","proposal","preview","reason","usage","trace_id","evidence_refs"})&&response["request_id"].toString()==context.requestId&&response["schema_version"].isInt()&&int(response["schema_version"])==1,"Assistant response identity was rejected.");
     const auto status=response["status"].toString();
     if(status=="ready"){
      ready=std::make_shared<Ready>(validateReady(context,response,bridge->previewDirectory()));
      const auto& candidate=*ready->audio;
      require(candidate.frames()==context.last-context.first&&candidate.sampleRate==context.sampleRate&&candidate.samples.size()==base->wet->samples.size(),"Assistant preview audio layout differs.");
      previewRender=std::make_shared<Rendered>(*base);auto wet=std::make_shared<tonescope::AudioData>(*base->wet);
      const auto localFirst=context.first-context.cacheOffset+context.alignment;
      for(size_t c=0;c<wet->samples.size();++c)for(int64_t i=0;i<candidate.frames();++i){const auto index=localFirst+i;if(index>=0&&index<wet->frames())wet->samples[c][(size_t)index]=candidate.samples[c][(size_t)i];}
      previewRender->wet=wet;previewRender->graphKey="assistant-preview:"+context.requestId;
      previewRender->comparison.gain=1;
      previewRender->wetPeaks.assign(2048,0);for(int64_t i=0;i<wet->frames();++i){const auto bin=(size_t)(i*2048/wet->frames());for(const auto& channel:wet->samples)previewRender->wetPeaks[bin]=juce::jmax(previewRender->wetPeaks[bin],std::abs(channel[(size_t)i]));}
      tonescope::AudioData window;window.sampleRate=context.sampleRate;window.samples.assign(wet->samples.size(),std::vector<float>(2048,0));for(size_t c=0;c<window.samples.size();++c)for(int64_t i=0;i<juce::jmin<int64_t>(2048,context.last-context.first);++i)window.samples[c][(size_t)i]=candidate.samples[c][(size_t)i];previewRender->wetSpectrum=tonescope::spectrum(window,0);previewRender->wetDynamics=tonescope::dynamics(*wet);
      message=context.metricsOnly?"Candidate verified against native full-band selected RMS and peak. Residual comparison unavailable without cached baseline audio. Preview, then explicitly accept for one undo transaction.":"Measured local candidate ready. Preview it, then explicitly accept to create one undo transaction.";
     }else{
      require(status=="noop"||status=="abstain"||status=="canceled"||status=="timed_out"||status=="failed","Unknown assistant result.");
      require(response["proposal"].isVoid()&&response["preview"].isVoid(),"Assistant returned a proposal with a terminal failure status.");
      message=response["reason"].isString()?response["reason"].toString().substring(0,500):"Assistant did not propose a change.";if(status=="failed"||status=="timed_out")error=message;
     }
    }catch(const std::exception& failure){error=juce::String(failure.what());ready.reset();previewRender.reset();message=error;}
    juce::MessageManager::callAsync([safe,generation,context,ready,previewRender,message,error]{
     if(!safe||safe->assistantGeneration!=generation||!safe->assistantContext||safe->assistantContext->requestId!=context.requestId||!safe->assistantCurrent(context))return;
     safe->assistantReady=ready;safe->assistantPreviewRender=previewRender;safe->assistantState=ready?"ready":error.isEmpty()?"idle":"error";safe->assistantMessage=message;
    });
   });
  }catch(const std::exception& error){assistantState="error";assistantMessage=error.what();}
  return assistantPublicState();
 }
 if(action=="assistant.preview"||action=="assistant.apply"){
  if(assistantState=="running")return assistantPublicState();
  if(!assistantReady||!assistantContext||input["proposalId"].toString()!=assistantContext->requestId||!assistantCurrent(*assistantContext))return assistantPublicState();
  const bool apply=action=="assistant.apply";
  if(apply&&(!integer(input["revision"])||juce::int64(input["revision"])!=(juce::int64)assistantContext->revision))return assistantPublicState();
  restoreAssistantAudition();
  auto safe=juce::Component::SafePointer<Main>(this);auto bridge=assistantBridge;auto context=*assistantContext;auto ready=assistantReady;const auto generation=assistantGeneration;
  assistantState="running";assistantMessage=apply?"Verifying the selected preview before acceptance...":"Verifying the selected preview before audition...";
  bridge->post([safe,bridge,context,ready,generation,apply]{juce::String error;
   try{require(fileHash(context.sourceFile)==context.sourceHash,"Source changed before assistant acceptance.");require(fileHash(ready->audioFile)==ready->preview["audio_sha256"].toString(),"Assistant preview changed after evaluation.");}
   catch(const std::exception& failure){error=failure.what();}
   juce::MessageManager::callAsync([safe,context,ready,generation,apply,error]{
    if(!safe||safe->assistantGeneration!=generation||!safe->assistantContext||safe->assistantContext->requestId!=context.requestId||!safe->assistantCurrent(context))return;
    if(error.isNotEmpty()){safe->assistantState="error";safe->assistantMessage=error;return;}
    if(apply){auto parameters=ready->parameters;if(safe->applyParameterTransaction(parameters)){safe->assistantReady.reset();safe->assistantPreviewRender.reset();safe->assistantContext.reset();safe->assistantState="idle";safe->assistantMessage="Accepted the verified parameter proposal. Undo reverses the complete transaction.";}else{safe->assistantState="error";safe->assistantMessage="Native parameter validation rejected the proposal. No change was applied.";}}
    else if(safe->assistantPreviewRender){
     const bool wasPlaying=safe->playing.load();safe->playing=false;safe->detach();safe->assistantOriginalRender=safe->rendered;safe->assistantOriginalRevision=safe->renderedRevision;safe->assistantOriginalMode=safe->mode.getSelectedId();safe->assistantOriginalMatch=safe->match.getToggleState();safe->assistantOriginalLoop=safe->loop.getToggleState();safe->assistantOriginalPlaying=wasPlaying;safe->assistantOriginalPosition=safe->position.load();
     safe->rendered=safe->assistantPreviewRender;safe->renderedRevision=std::numeric_limits<uint64_t>::max();safe->scope.data=safe->rendered;safe->mode.setSelectedId(2,juce::dontSendNotification);safe->audition=2;safe->match.setToggleState(false,juce::dontSendNotification);safe->sourceStep=context.sampleRate/safe->deviceRate.load();safe->position=context.first;safe->assistantAuditioning=true;safe->loop.setToggleState(false,juce::dontSendNotification);safe->looping=false;safe->attach();if(!safe->startCandidatePlayback(ready->audioFile,ready->preview["audio_sha256"].toString(),context.first,context.last-context.first)){safe->restoreAssistantAudition();safe->assistantState="error";safe->assistantMessage="Native candidate playback rejected the verified preview.";return;}safe->assistantState="ready";safe->assistantMessage="Auditioning the verified candidate at raw processed gain. Parameters are unchanged; export is disabled during this preview.";
    }
   });
  });
  return assistantPublicState();
 }
 return assistantPublicState();
}
