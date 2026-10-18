#pragma once
#include <algorithm>
#include <filesystem>
#include <string>
namespace tonescope::detail {
inline std::filesystem::path nativeAudioPath(const std::string& utf8) {
    std::filesystem::path path(std::u8string(utf8.begin(),utf8.end()));
#if defined(_WIN32)
    // UTF-16 plus an extended absolute path. A short audio filename can still
    // have a sidecar/temporary name beyond MAX_PATH in a nested session cache.
    auto native=std::filesystem::absolute(path).lexically_normal().wstring();
    std::replace(native.begin(),native.end(),L'/',L'\\');
    if(native.rfind(L"\\\\?\\",0)==0)return std::filesystem::path(native);
    if(native.rfind(L"\\\\",0)==0)return std::filesystem::path(L"\\\\?\\UNC\\"+native.substr(2));
    return std::filesystem::path(L"\\\\?\\"+native);
#else
    return path;
#endif
}
}
