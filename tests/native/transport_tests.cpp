#include "CaptureWorker.h"
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
  }std::cout<<"transport state, record readback/overflow, recovery, migration, undo and export regression checks passed\n";
  folder.deleteRecursively();return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';folder.deleteRecursively();return 1;}
}
