#pragma once
#include <span>
#include <string>
#include <string_view>

namespace tonescope::desktop {
inline bool validUIProbeIdentifier(std::string_view identifier) {
    return identifier.size() == 32 &&
        identifier.find_first_not_of("0123456789abcdef") == std::string_view::npos;
}
// Hardware-free probes have their own singleton namespace. Normal launches
// always retain the product identity, even if a test token is supplied.
inline std::string applicationInstanceName(std::span<const std::string_view> arguments) {
    bool probe = false;
    int identifiers = 0;
    std::string_view identifier;
    for (size_t i = 0; i < arguments.size(); ++i) {
        probe |= arguments[i] == "--screenshot" || arguments[i] == "--web-ui-test";
        if (arguments[i] == "--ui-test-instance") {
            ++identifiers;
            if (i + 1 < arguments.size()) identifier = arguments[i + 1];
        }
    }
    if (probe && identifiers == 1 && validUIProbeIdentifier(identifier))
        return "ToneScope-ui-test-" + std::string(identifier);
    return "ToneScope";
}
inline std::string applicationRecoveryNamespace(std::string_view instanceName) {
    constexpr std::string_view prefix = "ToneScope-ui-test-";
    if (instanceName.starts_with(prefix) && validUIProbeIdentifier(instanceName.substr(prefix.size())))
        return "ToneScope/ui-tests/" + std::string(instanceName.substr(prefix.size())) + "/recovery";
    return "ToneScope/recovery";
}
}
