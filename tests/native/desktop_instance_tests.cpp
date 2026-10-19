#include "DesktopInstance.h"
#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace tonescope::desktop;
void require(bool ok) {if(!ok) throw std::runtime_error("desktop instance isolation regression");}
std::string name(std::initializer_list<std::string_view> arguments) {
    return applicationInstanceName(std::span<const std::string_view>(arguments.begin(),arguments.size()));
}
int main() {
    try {
        constexpr auto id="0123456789abcdef0123456789abcdef";
        const auto expected=std::string("ToneScope-ui-test-")+id;
        require(name({})=="ToneScope");
        require(name({"--ui-test-instance",id})=="ToneScope");
        require(name({"--demo","--ui-test-instance",id})=="ToneScope");
        for(auto flag:{"--screenshot","--web-ui-test"}) {
            require(name({flag,"--ui-test-instance",id})==expected);
            require(name({flag})=="ToneScope");
            require(name({flag,"--ui-test-instance"})=="ToneScope");
            require(name({flag,"--ui-test-instance",id,"--ui-test-instance",id})=="ToneScope");
            for(auto bad:{"../recovery","", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcdeg", "0123456789abcdef0123456789abcdef0"})
                require(name({flag,"--ui-test-instance",bad})=="ToneScope");
        }
        require(applicationRecoveryNamespace("ToneScope")=="ToneScope/recovery");
        require(applicationRecoveryNamespace(expected)==std::string("ToneScope/ui-tests/")+id+"/recovery");
        require(applicationRecoveryNamespace("ToneScope-ui-test-../unsafe")=="ToneScope/recovery");
        require(applicationRecoveryNamespace(name({"--ui-test-instance",id}))=="ToneScope/recovery");
        require(name({"--web-ui-test","--ui-test-instance","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})!=expected);
        std::cout<<"Desktop instance and recovery isolation passed\n";
        return 0;
    } catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
