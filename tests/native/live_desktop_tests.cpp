#include "../../apps/desktop/AssistantBridge.h"
#include <iostream>
using namespace tonescope::desktop::assistant;
static juce::var clone(const juce::var& v){return juce::JSON::parse(juce::JSON::toString(v));}
static void rejected(const std::function<void()>& fn){bool failed=false;try{fn();}catch(...){failed=true;}require(failed,"Expected rejection.");}
int main(int argc,char** argv){try{
 if(argc==3&&juce::String(argv[1])=="--config-list"){auto paths=juce::JSON::parse(juce::File(juce::String(argv[2])));require(paths.isArray()&&paths.getArray()->size()<=1024,"Invalid config index.");for(const auto& path:*paths.getArray()){Evaluation config;config.load(juce::File(path.toString()),true);std::cout<<config.document["consent_sha256"].toString()<<"\n";}return 0;}
 if(argc==2){Evaluation config;config.load(juce::File(juce::String(argv[1])),true);std::cout<<"Loaded consent "<<config.document["consent_sha256"].toString()<<"\n";return 0;}
 Context c;c.sessionId="session";c.requestId="r_lifecycle_level_apply_undo";
 const auto usage=object({{"tool_calls",0},{"candidate_frames",0},{"input_tokens",0},{"output_tokens",0},{"latency_ms",0},{"cost_usd",0.}});
 auto response=object({{"schema_version",1},{"request_id",c.requestId},{"status","noop"},{"proposal",juce::var()},{"preview",juce::var()},{"reason","No change"},{"usage",usage},{"trace_id",juce::Uuid().toDashedString()},{"evidence_refs",juce::Array<juce::var>{}}});
 validateEnvelope(c,response);auto positive=clone(response);positive["usage"].getDynamicObject()->setProperty("cost_usd",.001);rejected([&]{validateEnvelope(c,positive);});
 auto p=object({{"experiment_id","experiment"},{"budget_id","budget"},{"protocol_sha256",juce::String::repeatedString("a",64)},{"task_sha256",juce::String::repeatedString("b",64)},{"schedule_sha256",juce::String::repeatedString("c",64)},{"budget_usd",.1},{"input_usd_per_million",1},{"output_usd_per_million",1}});
 c.evaluation.document=object({{"mode","fault-injected"},{"policy",p},{"consent_sha256",jsonDigest(p)}});
 auto a=object({{"schema_version",1},{"experiment_id",p["experiment_id"]},{"budget_id",p["budget_id"]},{"protocol_sha256",p["protocol_sha256"]},{"task_sha256",p["task_sha256"]},{"schedule_sha256",p["schedule_sha256"]},{"consent_sha256",jsonDigest(p)},{"provenance","fault-injected"},{"accounting_known",true},{"reserved_usd",.016}});
 auto trace=object({{"schema_version",1},{"trace_id",response["trace_id"]},{"attempt_id",c.requestId},{"request_id",c.requestId},{"session_id",c.sessionId},{"experiment_id",p["experiment_id"]},{"consent_sha256",jsonDigest(p)},{"provenance","fault-injected"},{"events",juce::Array<juce::var>{object({{"sequence",1},{"category","terminal"}})}}});
 positive.getDynamicObject()->setProperty("authorization",a);positive.getDynamicObject()->setProperty("trace",trace);positive.getDynamicObject()->setProperty("snapshots",juce::Array<juce::var>{});validateEnvelope(c,positive);
 c.parameters.outputDb=1.2f;c.descriptors=evaluationDescriptors(tonescope::session::parameterDescriptors(c.parameters,48000),c.evaluation);
 auto numeric=clone(positive);numeric.getDynamicObject()->setProperty("snapshots",juce::Array<juce::var>{clone(c.snapshot())});validateEnvelope(c,numeric);
 auto numericForged=clone(numeric);(*(*numericForged["snapshots"].getArray())[0]["parameters"].getArray())[0].getDynamicObject()->setProperty("value",1.3);rejected([&]{validateEnvelope(c,numericForged);});
 c.parameters.outputDb=0;c.descriptors=juce::var();
 auto inflated=clone(positive);inflated["authorization"].getDynamicObject()->setProperty("reserved_usd",.08);inflated["usage"].getDynamicObject()->setProperty("cost_usd",.02);rejected([&]{validateEnvelope(c,inflated);});
 for(auto* key:{"experiment_id","budget_id","consent_sha256","protocol_sha256","task_sha256","schedule_sha256","provenance"}){auto forged=clone(positive);forged["authorization"].getDynamicObject()->setProperty(key,"spoofed");rejected([&]{validateEnvelope(c,forged);});}
 for(auto cost:{-.1,.017,std::numeric_limits<double>::infinity()}){auto forged=clone(positive);forged["usage"].getDynamicObject()->setProperty("cost_usd",cost);rejected([&]{validateEnvelope(c,forged);});}
 for(auto* key:{"session_id","attempt_id","request_id","trace_id","provenance"}){auto forged=clone(positive);forged["trace"].getDynamicObject()->setProperty(key,"spoofed");rejected([&]{validateEnvelope(c,forged);});}
 auto forged=clone(positive);forged.getDynamicObject()->setProperty("snapshots",juce::Array<juce::var>{object({{"session_id","spoofed"}})});rejected([&]{validateEnvelope(c,forged);});
 c.evaluation.document.getDynamicObject()->setProperty("lifecycle_request_id","r_lifecycle_compression_apply_undo");
 c.descriptors=evaluationDescriptors(tonescope::session::parameterDescriptors(c.parameters,48000),c.evaluation);
 require(c.descriptors.getArray()->size()==8,"Compression fixed metadata missing.");
 for(auto* key:{"inputDb","outputDb","ratio"}){auto patch=juce::var(juce::Array<juce::var>{object({{"stage_id",juce::String(key)=="ratio"?"compressor":juce::String(key)=="inputDb"?"input":"output"},{"parameter_id",key},{"unit",juce::String(key)=="ratio"?"ratio":"dB"},{"value",juce::String(key)=="ratio"?4:0}})});rejected([&]{patchParameters(c,patch);});}
 auto privateField=clone(positive);(*privateField["trace"]["events"].getArray())[0].getDynamicObject()->setProperty("path","private");rejected([&]{validateEnvelope(c,privateField);});
 const auto directory=juce::File::getSpecialLocation(juce::File::tempDirectory).getNonexistentChildFile("tonescope-lifecycle","",false);require(directory.createDirectory(),"Cannot make trace test directory.");
 c.evaluation.document.getDynamicObject()->setProperty("state_directory",directory.getFullPathName());
 {LifecycleTrace evidence(c);evidence.ingest(positive);auto changed=c.parameters;changed.outputDb=-3;
 require(evidence.append("explicit_acceptance",c.parameters,1,true),"Cannot record acceptance.");require(evidence.append("native_apply",changed,2),"Cannot record apply.");require(evidence.append("native_undo",c.parameters,3),"Cannot record undo.");
 const auto record=juce::JSON::parse(evidence.file());const auto* events=record["events"].getArray();require(events&&events->size()==4,"Missing linked native events.");
 require(bool((*events)[1]["simulated"])&&equivalentJson((*events)[2]["parameters"],clone(tonescope::session::parametersToVar(changed)))&&equivalentJson((*events)[3]["parameters"],record["parameters_before"]),"Full parameter snapshots differ.");
 for(int i=0;i<events->size();++i)require(int((*events)[i]["sequence"])==i+1,"Linked sequence differs.");
 require(!juce::JSON::toString(record).contains("No change"),"Model prose leaked to desktop trace.");}
 require(directory.deleteRecursively(),"Cannot clear trace test directory.");
 require(canonicalJson(object({{"z",1},{"a",true}}))=="{\"a\":true,\"z\":1}","Canonical keys differ.");
 std::cout<<"Native offline cost and live authorization, finite bounded cost, trace, snapshot and provenance rejection passed.\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
