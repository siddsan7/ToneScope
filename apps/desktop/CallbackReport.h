#pragma once
#include <juce_core/juce_core.h>

namespace tonescope::desktop {
// Message/file-worker only. Separate from the deliberately strict session schema.
inline bool saveCallbackObservationsAtomically(const juce::File& file,const juce::String& text) {
    const auto document=juce::JSON::parse(text);
    if(!document.isObject()||!document["schema_version"].isInt()||(int)document["schema_version"]!=1||document["kind"].toString()!="tonescope.callback.observations")return false;
    juce::TemporaryFile temporary(file);
    if(!temporary.getFile().replaceWithText(text))return false;
    const auto readback=juce::JSON::parse(temporary.getFile());
    if(!readback.isObject()||juce::JSON::toString(document)!=juce::JSON::toString(readback))return false;
    return temporary.overwriteTargetFileWithTemporary();
}
}
