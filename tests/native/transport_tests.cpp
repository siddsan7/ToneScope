#include "CaptureWorker.h"
#include "FilePlayback.h"
#include "SessionRecovery.h"
#include <tonescope/ParameterState.h>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace tonescope;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
template<class F>void rejects(F&& f){bool rejected=false;try{f();}catch(const std::exception&){rejected=true;}require(rejected,"Invalid state operation accepted");}
int main(){
 auto folder=juce::File::getCurrentWorkingDirectory().getChildFile("transport-check-"+juce::Uuid().toString());
 if(folder.createDirectory().failed())return 2;
 try{{
  Parameters a,b;b.inputDb=4;b.drive=true;b.oversampling=4;b.order={2,1,0};b.crossoverLowHz=250;
  session::ParameterHistory history;history.reset(a);require(history.commit(b),"Commit patch");require(!history.commit(b),"Identical patch must not create undo step");
  Parameters actual;require(history.undo(actual)&&session::hashParameters(actual)==session::hashParameters(a),"Whole patch undo");require(history.redo(actual)&&session::hashParameters(actual)==session::hashParameters(b),"Whole patch redo");
  require(history.undo(actual),"Undo before new branch");Parameters c;c.inputDb=-3;history.commit(c);require(!history.canRedo(),"New patch invalidates redo");
  for(int i=0;i<200;++i){c.inputDb=float(i)/10;history.commit(c);}int count=0;while(history.undo(actual))++count;require(count==128,"History bound");
  auto* object=new juce::DynamicObject();object->setProperty("schema_version",1);object->setProperty("parameters",session::parametersToVar(b));juce::var state(object);
  auto serialized=juce::JSON::toString(state);require(juce::JSON::toString(session::migrateDocument(state))==serialized,"Schema1 identity migration");
  auto sessionFile=folder.getChildFile("session.json");require(desktop::saveSessionAtomically(sessionFile,serialized),"Atomic valid session save");require(session::hashParameters(session::loadParameters(sessionFile))==session::hashParameters(b),"Session readback exact parameters");
  require(!desktop::saveSessionAtomically(sessionFile,"{\"schema_version\":99}"),"Unknown migration must reject");require(sessionFile.loadFileAsString()==serialized,"Failed replacement preserves prior complete state");
  for(auto bad:{"{\"schema_version\":0,\"parameters\":{}}","{\"schema_version\":2,\"parameters\":{}}","{\"schema_version\":1.0,\"parameters\":{}}","{}"})rejects([&]{session::loadParametersDocument(juce::JSON::parse(bad));});
  std::array<float,512> left{},right{};for(int i=0;i<512;++i){left[i]=float(.4*std::sin(i*.2));right[i]=-left[i];}const float* input[]{left.data(),right.data()};
  auto take=folder.getChildFile("take.wav");{
   desktop::CaptureWorker capture(take.getFullPathName().toStdString(),48000);for(int i=0;i<8;++i)require(capture.push(input,512),"Capture enqueue");capture.stop();require(capture.complete()&&capture.frames()==4096,"Complete capture drains queue before commit");
  }
  WavStreamReader reader(take.getFullPathName().toStdString());std::array<float,512>x{},y{};float* output[]{x.data(),y.data()};for(int block=0;block<8;++block){require(reader.read(output,512)==512,"Captured readback count");require(x==left&&y==right,"Captured exact dry samples");}
  {
   desktop::CaptureWorker capture(folder.getChildFile("limited.wav").getFullPathName().toStdString(),48000,256,1024);require(capture.push(input,512)&&capture.push(input,512),"Bounded recording prefix");require(!capture.push(input,512),"Duration bound stops recording");capture.stop();require(capture.fault()==desktop::CaptureWorker::Fault::duration&&!capture.complete()&&capture.frames()==1024,"Duration fault preserves incomplete prefix");
  }
  {
   desktop::CaptureWorker capture(folder.getChildFile("overflow.wav").getFullPathName().toStdString(),48000,2);for(int i=0;i<1000000&&!capture.stopped();++i)capture.push(input,512);capture.stop();require(capture.fault()==desktop::CaptureWorker::Fault::overflow&&!capture.complete(),"Record overflow must mark incomplete and stop");
  }
  {
   desktop::CaptureWorker capture(folder.getChildFile("missing/disk-fault.wav").getFullPathName().toStdString(),48000);capture.push(input,512);capture.stop();require(capture.fault()==desktop::CaptureWorker::Fault::io&&!capture.complete(),"Disk failure cannot award complete capture");
  }
  auto partial=folder.getChildFile("crash.partial.wav");{WavStreamWriter unfinished(partial.getFullPathName().toStdString(),48000,2);unfinished.write(input,512);}
  auto originalSize=partial.getSize();auto recovered=desktop::recoverInterruptedCapture(partial);require(partial.existsAsFile()&&partial.getSize()==originalSize,"Recovery preserves interrupted original");WavStreamReader recoveredReader(recovered.getFullPathName().toStdString());require(recoveredReader.info().frames==512,"Recover aligned complete frames");recoveredReader.read(output,512);require(x==left&&y==right,"Crash recovery exact samples");
  // Regression: the audition filter must never replace the full-band export payload.
  AudioData source;source.sampleRate=48000;source.samples.assign(2,std::vector<float>(4800));for(size_t n=0;n<source.samples[0].size();++n)source.samples[0][n]=source.samples[1][n]=float(.2*std::sin(n*.9));
  Parameters p;p.drive=true;const auto exportWet=render(source,p);auto audition=auditionPair(source,exportWet,AuditionBand::low);auto exported=folder.getChildFile("full-band.wav");writeWav(exported.getFullPathName().toStdString(),exportWet);auto readback=readWav(exported.getFullPathName().toStdString());require(readback.samples==exportWet.samples,"Raw export sample equality");require(readback.samples!=audition.wet.samples,"Export excludes audition filtering");
  // Native UI protocol guard for the original regression and the cache-hit path.
  auto implementation=juce::File::getCurrentWorkingDirectory().getChildFile(juce::String::fromUTF8(__FILE__)).getParentDirectory().getParentDirectory().getParentDirectory().getChildFile("apps/desktop/Main.cpp").loadFileAsString();
  require(implementation.contains("*audio->exportWet")&&implementation.contains("result->exportWet=previous->exportWet"),"Desktop exports unfiltered payload and preserves it on cache hits");
  // Live calibration uses the same bypass Engine ingress/smoothing implementation.
  Engine wet,dry;Parameters bypass;bypass.inputDb=7;wet.prepare(48000,2,bypass);dry.prepare(48000,2,bypass);std::array<float,512> wetL{},wetR{},dryL{},dryR{};float* wetOut[]{wetL.data(),wetR.data()};float* dryOut[]{dryL.data(),dryR.data()};left[0]=32;right[1]=-32;bypass.inputDb=-4;require(wet.setParametersRealtime(bypass)&&dry.setParametersRealtime(bypass),"Live trim target");wet.process(input,wetOut,512);dry.process(input,dryOut,512);require(wetL==dryL&&wetR==dryR,"Dry clamp and smoothed trim calibration");
  // A >120-second asset is generated with fixed scratch storage, not a giant sample allocation.
  auto longFile=folder.getChildFile("long.wav");constexpr std::int64_t longFrames=121*8000;
  auto valueAt=[](std::int64_t n){return static_cast<float>(.3*std::sin(static_cast<double>(n)*.037));};long double energy=0;
  {WavStreamWriter writer(longFile.getFullPathName().toStdString(),8000,1);for(std::int64_t at=0;at<longFrames;at+=512){const auto n=static_cast<int>(std::min<std::int64_t>(512,longFrames-at));for(int i=0;i<n;++i){left[static_cast<size_t>(i)]=valueAt(at+i);energy+=static_cast<long double>(left[static_cast<size_t>(i)])*left[static_cast<size_t>(i)];}const float* samples[]{left.data()};writer.write(samples,n);}writer.finish();}
  Parameters longParameters;longParameters.toneHz=2000;
  auto whole=desktop::inspectFile(longFile.getFullPathName().toStdString(),longParameters,0,longFrames);require(whole.info.frames==longFrames&&whole.measuredEnd==longFrames,"Long inspection retains full selected timeline");require(whole.raw.frames()==80000&&whole.windowEnd==80000,"Long inspection cache stays bounded at ten seconds");require(std::abs(whole.comparison.dryRms-std::sqrt(static_cast<double>(energy/longFrames)))<1e-9,"RMS measured over entire 121-second interval");require(whole.comparison.residualRms<1e-8,"Long bypass aligned residual");
  const std::int64_t seekFirst=119*8000,seekEnd=121*8000;
  auto tail=desktop::inspectFile(longFile.getFullPathName().toStdString(),longParameters,seekFirst,seekEnd);require(tail.offset==seekFirst&&tail.raw.frames()==16000,"Long tail inspection absolute offset");for(std::int64_t n=0;n<tail.raw.frames();++n)require(tail.raw.samples[0][static_cast<size_t>(n)]==valueAt(seekFirst+n),"No truncation at old 120-second cap");
  {
   desktop::FilePlayback player(longFile.getFullPathName().toStdString(),longParameters,seekFirst,seekEnd,8000);const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(30);while(!player.ready()&&!player.failed()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));require(player.ready()&&!player.failed(),"Prepare long source seek");
   std::array<float,257> dl{},dr{},wl{},wr{};float* dryOut[]{dl.data(),dr.data()};float* wetOut[]{wl.data(),wr.data()};std::int64_t received=0;double next=seekFirst;
   while(!player.exhausted()&&std::chrono::steady_clock::now()<deadline){auto n=player.pull(dryOut,wetOut,257,next);if(n==0){std::this_thread::sleep_for(std::chrono::milliseconds(1));continue;}for(int k=0;k<n;++k){require(dl[static_cast<size_t>(k)]==valueAt(seekFirst+received+k)&&wl[static_cast<size_t>(k)]==dl[static_cast<size_t>(k)]&&dr[static_cast<size_t>(k)]==dl[static_cast<size_t>(k)],"Stream exact absolute timeline and mono mapping");}received+=n;}
   require(received==seekEnd-seekFirst&&next==seekEnd&&!player.failed(),"Streamed playback reaches real EOF after 120 seconds");player.cancel();
  }
  auto cancelled=std::make_shared<std::atomic<bool>>(true);rejects([&]{desktop::inspectFile(longFile.getFullPathName().toStdString(),longParameters,seekFirst,seekEnd,cancelled);});
  {desktop::FilePlayback abandoned(longFile.getFullPathName().toStdString(),longParameters,seekFirst,seekEnd,8000);abandoned.requestCancel();abandoned.cancel();require(!abandoned.failed(),"Cancelled preparation is not a read failure");}
  auto longExport=folder.getChildFile("long-tail-export.wav");desktop::exportFileRange(longFile.getFullPathName().toStdString(),longExport.getFullPathName().toStdString(),longParameters,seekFirst,seekEnd);WavStreamReader exportedTail(longExport.getFullPathName().toStdString());require(exportedTail.info().frames==16000,"Streamed selected export frame count");
  {
   desktop::FilePlayback candidate(longExport.getFullPathName().toStdString(),longParameters,0,16000,16000,{},AuditionBand::full,seekFirst);const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(5);while(!candidate.ready()&&!candidate.failed()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));require(candidate.ready(),"Candidate ring prepares verified cropped timeline");
   std::array<float,257> dl{},dr{},wl{},wr{};float* dryOut[]{dl.data(),dr.data()};float* wetOut[]{wl.data(),wr.data()};double next=0;int received=0;
   while(!candidate.exhausted()&&std::chrono::steady_clock::now()<deadline){int n=candidate.pull(dryOut,wetOut,257,next);if(n==0){std::this_thread::sleep_for(std::chrono::milliseconds(1));continue;}for(int k=0;k<n;++k){const double relative=(received+k)*.5;const auto at=static_cast<std::int64_t>(relative);const auto a=valueAt(seekFirst+at),b=valueAt(seekFirst+std::min<std::int64_t>(at+1,15999));const auto fraction=static_cast<float>(relative-at);const auto expected=fraction==0?a:a+fraction*(b-a);require(std::abs(wl[static_cast<size_t>(k)]-expected)<1e-7,"Worker resamples candidate without changing its absolute source mapping");}received+=n;}
   require(received==32000&&next==seekEnd&&!candidate.failed(),"Candidate EOF retains absolute source cursor at changed output rate");
  }
  {desktop::FilePlayback rejected(longExport.getFullPathName().toStdString(),longParameters,0,16000,8000,[](const desktop::FileCancel&){return false;});const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!rejected.failed()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));require(rejected.failed()&&!rejected.ready(),"Failed source verification cannot publish playable audio");}  AudioData historySource;historySource.sampleRate=8000;historySource.samples.assign(2,std::vector<float>(16000));for(size_t n=0;n<16000;++n){historySource.samples[0][n]=static_cast<float>(.5*std::sin(n*.15)+.15*std::sin(n*2.0));historySource.samples[1][n]=static_cast<float>(.2*std::cos(n*.07)+.1*std::cos(n*2.4));}auto historyFile=folder.getChildFile("history.wav");writeWav(historyFile.getFullPathName().toStdString(),historySource);
  Parameters historyParameters;historyParameters.toneHz=2000;historyParameters.compressor=true;historyParameters.multiband=true;historyParameters.drive=true;historyParameters.oversampling=2;historyParameters.thresholdDb=-30;historyParameters.releaseMs=2000;
  auto authoritative=render(historySource,historyParameters,512);auto reference=crossoverReference(historySource,historyParameters);auto filtered=auditionPair(reference,authoritative,AuditionBand::high,historyParameters.crossoverLowHz,historyParameters.crossoverHighHz);
  auto inspected=desktop::inspectFile(historyFile.getFullPathName().toStdString(),historyParameters,12000,15000,{},nullptr,AuditionBand::high,true);require(inspected.latency==32&&!inspected.gainReductionHistory.empty(),"Inspection carries actual engine latency and gain reduction samples");for(size_t n=0;n<inspected.wet.samples[0].size();++n){require(std::abs(inspected.wet.samples[0][n]-authoritative.samples[0][n+12000])<1e-7,"Seek reconstructs complete nonlinear history");require(std::abs(inspected.auditionWet.samples[0][n]-filtered.wet.samples[0][n+12000])<1e-7,"Audition filters reconstruct complete history");}
  auto exactComparison=compareAligned(filtered.dry,filtered.wet,12000,15000,true,32);require(std::abs(inspected.comparison.gain-exactComparison.gain)<1e-6&&std::abs(inspected.comparison.residualRms-exactComparison.residualRms)<1e-6,"Whole interval RMS and residual match authoritative aligned render");  auto independentEnergy=[&](const AudioData& audio,std::int64_t until,double initial=0.){const auto coefficient=std::exp(-1/(.010*audio.sampleRate));double state=initial;for(std::int64_t n=0;n<until;++n){double linked=0;for(const auto& channel:audio.samples){const double sample=channel[static_cast<size_t>(n)];linked+=sample*sample/audio.samples.size();}state=coefficient*state+(1-coefficient)*linked;}return state;};
  const auto expectedDryInitial=independentEnergy(filtered.dry,12000),expectedWetInitial=independentEnergy(filtered.wet,12000);
  require(std::abs(inspected.dryInitialEnvelopeEnergy-expectedDryInitial)<1e-12&&std::abs(inspected.wetInitialEnvelopeEnergy-expectedWetInitial)<1e-12,"Late filtered stereo cache preserves envelope state before its first sample");
  require(inspected.dryInitialEnvelopeEnergy>1e-10&&inspected.wetInitialEnvelopeEnergy>1e-10,"Envelope checkpoint must retain actual prehistory rather than reset to zero");
  // Continue from the saved states through the known 32-sample wet lookahead.
  require(std::abs(independentEnergy(inspected.auditionWet,32,inspected.wetInitialEnvelopeEnergy)-independentEnergy(filtered.wet,12032))<1e-12,"Wet envelope checkpoint stays on the raw DSP timeline across latency alignment");
  require(std::abs(independentEnergy(inspected.auditionDry,32,inspected.dryInitialEnvelopeEnergy)-independentEnergy(filtered.dry,12032))<1e-12,"Dry checkpoint advances through the cached prefix with complete history");
  for(auto first:{0ll,511ll,512ll,513ll}){auto boundary=desktop::inspectFile(historyFile.getFullPathName().toStdString(),historyParameters,first,first+200,{},nullptr,AuditionBand::high);require(std::abs(boundary.dryInitialEnvelopeEnergy-independentEnergy(filtered.dry,first))<1e-12&&std::abs(boundary.wetInitialEnvelopeEnergy-independentEnergy(filtered.wet,first))<1e-12,"Envelope checkpoint precedes sample zero and either side of a worker block boundary");}  }std::cout<<"transport state, record readback/overflow, recovery, migration, undo and export regression checks passed\n";
  folder.deleteRecursively();return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';folder.deleteRecursively();return 1;}
}
