#pragma once
#include <juce_core/juce_core.h>
#include <tonescope/Session.h>
#include <tonescope/Streaming.h>
#include <array>
#include <cstring>
namespace tonescope::desktop {
// Save only complete, validated JSON snapshots. A failed replacement leaves the
// previous recovery snapshot intact. No calls from an audio callback.
inline bool saveSessionAtomically(const juce::File& destination,const juce::String& text) {
    juce::TemporaryFile temporary(destination);
    if(!temporary.getFile().replaceWithText(text))return false;
    try{session::loadParameters(temporary.getFile());}catch(...){return false;}
    return temporary.overwriteTargetFileWithTemporary();
}
inline juce::File recoveryDirectory(){return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("ToneScope/recovery");}
// Only the exact 44-byte float32 stereo writer format produced by CaptureWorker
// is recoverable. Copy first: never rewrite the original interrupted take.
inline juce::File recoverInterruptedCapture(const juce::File& partial) {
    auto stream=partial.createInputStream();if(!stream||partial.getSize()<52||partial.getSize()>2ll*1024*1024*1024)throw std::runtime_error("Interrupted capture has invalid bounds");
    std::array<unsigned char,44> header{};if(stream->read(header.data(),44)!=44)throw std::runtime_error("Interrupted capture header missing");
    auto get16=[&](int n){return unsigned(header[n])|(unsigned(header[n+1])<<8);};
    auto get32=[&](int n){return unsigned(header[n])|(unsigned(header[n+1])<<8)|(unsigned(header[n+2])<<16)|(unsigned(header[n+3])<<24);};
    if(std::memcmp(header.data(),"RIFF",4)||std::memcmp(header.data()+8,"WAVEfmt ",8)||get32(16)!=16||get16(20)!=3||get16(22)!=2||get16(32)!=8||get16(34)!=32||std::memcmp(header.data()+36,"data",4))throw std::runtime_error("Interrupted capture is not the known writer format");
    const auto rate=get32(24);const auto bytes=(partial.getSize()-44)/8*8;
    if(rate<8000||rate>192000||get32(28)!=rate*8||bytes<8||bytes/8>static_cast<juce::int64>(rate)*7200)throw std::runtime_error("Interrupted capture duration/format invalid");
    auto result=partial.getSiblingFile(partial.getFileNameWithoutExtension()+".recovered-incomplete.wav").getNonexistentSibling();
    juce::TemporaryFile temporary(result);auto output=temporary.getFile().createOutputStream();if(!output)throw std::runtime_error("Cannot create recovered take");
    auto put32=[&](int n,unsigned value){for(int k=0;k<4;++k)header[n+k]=static_cast<unsigned char>(value>>(k*8));};
    put32(4,static_cast<unsigned>(bytes+36));put32(40,static_cast<unsigned>(bytes));
    if(!output->write(header.data(),44)||output->writeFromInputStream(*stream,bytes)!=bytes)throw std::runtime_error("Recovered take copy failed");
    output->flush();if(output->getStatus().failed())throw std::runtime_error("Recovered take flush failed");output.reset();
    {WavStreamReader verify(temporary.getFile().getFullPathName().toStdString());if(verify.info().frames!=bytes/8)throw std::runtime_error("Recovered take validation failed");}
    if(!temporary.overwriteTargetFileWithTemporary())throw std::runtime_error("Recovered take commit failed");
    return result;
}
}
