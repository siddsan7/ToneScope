#pragma once
#include <tonescope/Engine.h>
#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>

namespace tonescope::session {
// Native canonical serialization: consumers carry the digest as an opaque value.
// Hashing uses the actual float controls, never display rounding or JS object order.
inline juce::var parametersToVar(const Parameters& p) {
    auto* o = new juce::DynamicObject;
    auto put = [o](const char* name, auto value) { o->setProperty(name, value); };
    put("inputDb",p.inputDb);put("thresholdDb",p.thresholdDb);put("ratio",p.ratio);
    put("attackMs",p.attackMs);put("releaseMs",p.releaseMs);put("kneeDb",p.kneeDb);
    put("makeupDb",p.makeupDb);put("lowDb",p.lowDb);put("midDb",p.midDb);put("highDb",p.highDb);
    put("midHz",p.midHz);put("midQ",p.midQ);put("driveDb",p.driveDb);put("toneHz",p.toneHz);put("outputDb",p.outputDb);
    put("compressor",p.compressor);put("equalizer",p.equalizer);put("drive",p.drive);
    put("oversampling",p.oversampling);put("multiband",p.multiband);
    put("crossoverLowHz",p.crossoverLowHz);put("crossoverHighHz",p.crossoverHighHz);
    put("order",juce::var(juce::Array<juce::var>{p.order[0],p.order[1],p.order[2]}));
    return juce::var(o);
}
inline juce::String hashParameters(const Parameters& p) {
    auto text=juce::JSON::toString(parametersToVar(p),true);
    return juce::SHA256(text.toRawUTF8(),text.getNumBytesAsUTF8()).toHexString();
}
inline juce::var parameterDescriptors(const Parameters& p,double rate) {
    juce::Array<juce::var> result;
    auto add=[&](const char* stage,const char* name,const char* unit,double value,double minimum,double maximum) {
        auto* o=new juce::DynamicObject;
        o->setProperty("stage_id",stage);o->setProperty("parameter_id",name);o->setProperty("unit",unit);
        o->setProperty("value",value);o->setProperty("min",minimum);o->setProperty("max",maximum);
        result.add(juce::var(o));
    };
    add("input","inputDb","dB",p.inputDb,-24,24);
    add("compressor","thresholdDb","dBFS",p.thresholdDb,-60,0);
    add("compressor","ratio","ratio",p.ratio,1,20);
    add("compressor","attackMs","ms",p.attackMs,.1,100);
    add("compressor","releaseMs","ms",p.releaseMs,10,2000);
    add("compressor","kneeDb","dB",p.kneeDb,0,24);
    add("compressor","makeupDb","dB",p.makeupDb,-24,24);
    add("equalizer","lowDb","dB",p.lowDb,-18,18);add("equalizer","midDb","dB",p.midDb,-18,18);
    add("equalizer","highDb","dB",p.highDb,-18,18);
    add("equalizer","midHz","Hz",p.midHz,20,std::min(20000.,rate*.45));
    add("equalizer","midQ","ratio",p.midQ,.2,10);
    add("drive","driveDb","dB",p.driveDb,0,36);
    add("drive","toneHz","Hz",p.toneHz,20,std::min(20000.,rate*.45));
    add("output","outputDb","dB",p.outputDb,-24,24);
    // Topology is controlled by the host, not by numerical assistant proposals.
    return juce::var(result);
}
}
