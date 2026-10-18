#include <tonescope/Session.h>
#include <iostream>
#include <string>

int main() {
    struct Case { const char* name; const char* json; bool accepted; };
    const Case cases[] {
        {"schema-1", R"({"schema_version":1,"parameters":{}})", true},
        {"schema-99", R"({"schema_version":99,"parameters":{}})", false},
        {"schema-0", R"({"schema_version":0,"parameters":{}})", false},
        {"schema-float", R"({"schema_version":1.0,"parameters":{}})", false},
        {"schema-missing", R"({"parameters":{}})", false},
    };
    int failures = 0;
    for (const auto& item : cases) {
        bool accepted = false;
        std::string reason;
        try {
            juce::var document;
            if (juce::JSON::parse(item.json, document).failed())
                throw std::runtime_error("test JSON did not parse");
            const auto parameters = tonescope::session::loadParametersDocument(document);
            // Exercise the real core parameter contract as well as the loader.
            if (!tonescope::validate(parameters, 48000, reason))
                throw std::runtime_error("loaded parameters invalid: " + reason);
            accepted = true;
        } catch (const std::exception& error) { reason = error.what(); }
        const bool passed = accepted == item.accepted;
        std::cout << item.name << " expected=" << (item.accepted ? "accept" : "reject")
                  << " actual=" << (accepted ? "accept" : "reject")
                  << " result=" << (passed ? "pass" : "FAIL") << " reason=" << reason << '\n';
        failures += passed ? 0 : 1;
    }
    std::cout << "schema_cases=5 failures=" << failures << '\n';
    return failures == 0 ? 0 : 1;
}
