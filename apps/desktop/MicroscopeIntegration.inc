// Included inside Main. Measurements run on the file pool, never the callback
// or the 100 ms web snapshot path. Labels are supplied by the listener.
struct PassageMark { tonescope::SampleInterval interval; juce::String source; };
std::optional<PassageMark> softPassage, hardPassage;
juce::var passageMeasurements;
juce::String passageMessage="Mark two passages to compare their measured dynamics.";
std::uint64_t passageRevision=0, passageRequest=0;
juce::String passageSourceKey() const {
    if(sourceFile!=juce::File{})return sourceFile.getFullPathName()+"|"+sourceDigest;
    return "memory:"+juce::String::toHexString((juce::int64)(std::intptr_t)source.get());
}
juce::var microscopeSnapshot() const {
    auto* o=new juce::DynamicObject();
    auto mark=[&](const std::optional<PassageMark>& value)->juce::var{
        if(!value||value->source!=passageSourceKey())return {};
        return juce::Array<juce::var>{(juce::int64)value->interval.start,(juce::int64)value->interval.end};
    };
    o->setProperty("soft",mark(softPassage));o->setProperty("hard",mark(hardPassage));
    const bool current=renderedRevision==revision&&passageRevision==revision&&!busy;
    o->setProperty("current",current);o->setProperty("message",passageMessage);
    if(current)o->setProperty("measurements",passageMeasurements);
    return juce::var(o);
}
void microscopeCommand(const juce::String& action,const juce::var&) {
    if(action=="microscope.clear"){
        ++passageRequest;softPassage.reset();hardPassage.reset();passageMeasurements={};passageRevision=0;
        passageMessage="Passage marks cleared.";return;
    }
    if(action!="microscope.soft"&&action!="microscope.hard"){setStatus("Unknown microscope command.");return;}
    if(!source||!rendered||busy||renderedRevision!=revision||monitoring){setStatus("Wait for a current file render before marking a passage.");return;}
    PassageMark mark{{selectionStart.load(),selectionEnd.load()},passageSourceKey()};
    if(mark.interval.end-mark.interval.start<2){setStatus("Select at least two source samples.");return;}
    (action=="microscope.soft"?softPassage:hardPassage)=mark;updateMicroscope();
}
void updateMicroscope() {
    const auto key=passageSourceKey();passageRevision=0;
    if(!softPassage||!hardPassage||softPassage->source!=key||hardPassage->source!=key){
        passageMessage="Mark a soft passage and a hard passage. Labels are manual; metrics are measured.";return;
    }
    if(!rendered||busy||renderedRevision!=revision)return;
    auto soft=softPassage->interval,hard=hardPassage->interval;
    const auto offset=inspectionOffset;
    const auto end=offset+rendered->dry->frames()-rendered->latency;
    if(soft.start<offset||hard.start<offset||soft.end>end||hard.end>end){
        passageMessage="Both marked passages must fit inside the current measured window. Select a window covering both.";return;
    }
    soft.start-=offset;soft.end-=offset;hard.start-=offset;hard.end-=offset;
    const auto token=revision,request=++passageRequest;auto audio=rendered;
    passageMessage="Measuring both passages with source history and declared delay…";
    auto safe=juce::Component::SafePointer<Main>(this);
    pool.addJob(new Job([safe,audio,soft,hard,token,request]{
        auto result=tonescope::comparePassages(*audio->dry,*audio->wet,soft,hard,audio->latency);
        auto signal=[](const tonescope::PassageSignalMetrics& m){
            auto* v=new juce::DynamicObject();v->setProperty("rmsDbfs",20*std::log10(std::max(1e-12,m.rms)));
            v->setProperty("peakDbfs",20*std::log10(std::max(1e-12,m.samplePeak)));
            if(m.crestAvailable)v->setProperty("crestDb",m.crestDb);
            if(m.riseAvailable)v->setProperty("riseMs",m.riseMs);
            if(m.decayAvailable)v->setProperty("decayMs",m.decayMs);
            return juce::var(v);
        };
        auto passage=[&](const tonescope::PassageMetrics& m){auto* v=new juce::DynamicObject();
            v->setProperty("dry",signal(m.dry));v->setProperty("wet",signal(m.wet));
            if(m.rmsChangeAvailable)v->setProperty("changeDb",m.rmsChangeDb);return juce::var(v);};
        auto* value=new juce::DynamicObject();value->setProperty("valid",result.valid);
        value->setProperty("soft",passage(result.soft));value->setProperty("hard",passage(result.hard));
        if(result.contrastAvailable){value->setProperty("dryContrastDb",result.dryContrastDb);value->setProperty("wetContrastDb",result.wetContrastDb);value->setProperty("contrastChangeDb",result.contrastChangeDb);}
        juce::var measurements(value);
        juce::MessageManager::callAsync([safe,token,request,measurements]{
            if(!safe||safe->revision!=token||safe->passageRequest!=request)return;
            safe->passageRevision=token;safe->passageMeasurements=measurements;
            safe->passageMessage="Raw branch levels; RMS is not perceptual loudness. Envelope crossings describe these passages, not note onsets.";
        });
    }),true);
}
