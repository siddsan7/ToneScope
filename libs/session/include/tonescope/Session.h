#pragma once
#include <juce_core/juce_core.h>
#include <tonescope/Engine.h>
#include <map>
#include <cmath>
#include <stdexcept>
namespace tonescope::session {
using namespace juce;
inline Parameters loadParameters(const File& file) {
    if (!file.existsAsFile() || file.getSize() > 5*1024*1024) throw std::runtime_error("Session missing or exceeds 5 MiB");
    var document;
    if (auto result = JSON::parse(file.loadFileAsString(), document); result.failed()) throw std::runtime_error("Invalid session JSON");
    auto* root = document.getDynamicObject();
    if (!root || !document["schema_version"].isInt() || int(document["schema_version"]) != 1) throw std::runtime_error("Unsupported session schema_version");
    for (const auto& p : root->getProperties())
        if (p.name != Identifier("schema_version") && p.name != Identifier("parameters") && p.name != Identifier("source") && p.name != Identifier("ui") && p.name != Identifier("source_sha256")) throw std::runtime_error("Unknown session field");
    if(root->hasProperty("source") && (!document["source"].isString() || document["source"].toString().length()>32768)) throw std::runtime_error("Session source must be a bounded string");
    if(root->hasProperty("source_sha256")) {
        auto digest=document["source_sha256"];
        if(!digest.isString() || digest.toString().length()!=64 || !digest.toString().containsOnly("0123456789abcdef")) throw std::runtime_error("Invalid source SHA256");
    }
    if(root->hasProperty("ui")) {
        auto* ui=document["ui"].getDynamicObject();
        if(!ui) throw std::runtime_error("Session ui must be an object");
        double first=0,last=1;
        for(const auto& field:ui->getProperties()) {
            auto key=field.name.toString();
            if(key=="selection_start" || key=="selection_end") {
                if(!(field.value.isDouble() || field.value.isInt() || field.value.isInt64()) || !std::isfinite(double(field.value)) || double(field.value)<0 || double(field.value)>1) throw std::runtime_error("Invalid selection fraction");
                if(key=="selection_start") first=double(field.value); else last=double(field.value);
            } else if(key=="audition") {
                if(!field.value.isString() || (field.value.toString()!="dry" && field.value.toString()!="wet" && field.value.toString()!="residual")) throw std::runtime_error("Invalid audition mode");
            } else if(key=="rms_match") { if(!field.value.isBool()) throw std::runtime_error("Invalid RMS match flag"); }
            else throw std::runtime_error("Unknown ui field");
        }
        if(first>=last) throw std::runtime_error("Selection start must precede end");
    }
    Parameters result;
    auto* values = document["parameters"].getDynamicObject();
    if (!values) throw std::runtime_error("Session parameters must be an object");
    const std::map<std::string, float Parameters::*> numeric {
        {"inputDb", &Parameters::inputDb}, {"thresholdDb", &Parameters::thresholdDb}, {"ratio", &Parameters::ratio},
        {"attackMs", &Parameters::attackMs}, {"releaseMs", &Parameters::releaseMs}, {"kneeDb", &Parameters::kneeDb},
        {"makeupDb", &Parameters::makeupDb}, {"lowDb", &Parameters::lowDb}, {"midDb", &Parameters::midDb},
        {"highDb", &Parameters::highDb}, {"midHz", &Parameters::midHz}, {"midQ", &Parameters::midQ},
        {"driveDb", &Parameters::driveDb}, {"toneHz", &Parameters::toneHz}, {"outputDb", &Parameters::outputDb}
    };
    const std::map<std::string, bool Parameters::*> boolean {
        {"compressor", &Parameters::compressor}, {"equalizer", &Parameters::equalizer}, {"drive", &Parameters::drive}
    };
    for (const auto& prop : values->getProperties()) {
        auto key = prop.name.toString().toStdString();
        if (auto it = numeric.find(key); it != numeric.end()) {
            if (!(prop.value.isDouble() || prop.value.isInt() || prop.value.isInt64()) || !std::isfinite(double(prop.value))) throw std::runtime_error("Parameter must be finite numeric");
            result.*(it->second) = float(double(prop.value));
        } else if (auto bit = boolean.find(key); bit != boolean.end()) {
            if (!prop.value.isBool()) throw std::runtime_error("Bypass parameter must be boolean");
            result.*(bit->second) = bool(prop.value);
        } else if (key == "order") {
            auto* a = prop.value.getArray();
            if (!a || a->size() != 3) throw std::runtime_error("Order must contain three stage IDs");
            for (int i=0; i<3; ++i) {
                if (!a->getReference(i).isInt()) throw std::runtime_error("Stage IDs must be integers");
                result.order[static_cast<size_t>(i)] = int(a->getReference(i));
            }
        } else throw std::runtime_error("Unknown parameter: " + key);
    }
    return result;
}
}
