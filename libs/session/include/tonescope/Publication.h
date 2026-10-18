#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <filesystem>
#include <stdexcept>
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#endif

namespace tonescope::session {
#if defined(_WIN32)
inline juce::String publicationPath(const juce::String& absolute) {
    if(absolute.startsWith("\\\\?\\"))return absolute;
    if(absolute.startsWith("\\\\"))return "\\\\?\\UNC\\"+absolute.substring(2);
    return "\\\\?\\"+absolute;
}
#endif
inline juce::File fileForIo(const juce::File& file) {
    if(file==juce::File{})return file;
#if defined(_WIN32)
    return juce::File(publicationPath(file.getFullPathName()));
#else
    return file;
#endif
}
// File-worker only. Cooperating writers reserve BOTH publication paths; Windows
// delete-on-close releases reservations even on process failure. No waiting loop.
class PublicationReservation {
public:
    PublicationReservation(const juce::File& audio,const juce::File& manifest) {
        std::array<juce::String,2> names{audio.getFullPathName(),manifest.getFullPathName()};
        std::sort(names.begin(),names.end());
        try {
            for(size_t i=0;i<names.size();++i) {
                auto lock=names[i]+".tonescope-lock";
#if defined(_WIN32)
                auto nativeLock=publicationPath(lock);
                handles[i]=CreateFileW(nativeLock.toWideCharPointer(),GENERIC_READ|GENERIC_WRITE,0,nullptr,CREATE_NEW,
                    FILE_ATTRIBUTE_TEMPORARY|FILE_FLAG_DELETE_ON_CLOSE,nullptr);
                if(handles[i]==INVALID_HANDLE_VALUE)throw std::runtime_error("Another writer reserves this output or manifest");
#else
                handles[i]=::open(lock.toRawUTF8(),O_CREAT|O_RDWR,0600);
                if(handles[i]<0||::flock(handles[i],LOCK_EX|LOCK_NB)!=0)throw std::runtime_error("Another writer reserves this output or manifest");
#endif
            }
        } catch(...) { release();throw; }
    }
    ~PublicationReservation(){release();}
    PublicationReservation(const PublicationReservation&)=delete;
private:
#if defined(_WIN32)
    std::array<HANDLE,2> handles{INVALID_HANDLE_VALUE,INVALID_HANDLE_VALUE};
    void release() noexcept {for(auto& h:handles)if(h!=INVALID_HANDLE_VALUE){CloseHandle(h);h=INVALID_HANDLE_VALUE;}}
#else
    std::array<int,2> handles{-1,-1};
    void release() noexcept {for(auto& h:handles)if(h>=0){::flock(h,LOCK_UN);::close(h);h=-1;}}
#endif
};
inline bool publishCompleteFile(const juce::File& temporary,const juce::File& destination,bool overwrite) {
#if defined(_WIN32)
    auto from=publicationPath(temporary.getFullPathName()),to=publicationPath(destination.getFullPathName());
    return MoveFileExW(from.toWideCharPointer(),to.toWideCharPointer(),
        MOVEFILE_WRITE_THROUGH|(overwrite?MOVEFILE_REPLACE_EXISTING:0))!=0;
#else
    auto convert=[](const juce::File& f){auto s=f.getFullPathName().toStdString();return std::filesystem::path(std::u8string(s.begin(),s.end()));};
    std::error_code error;
    if(overwrite)std::filesystem::rename(convert(temporary),convert(destination),error);
    else {
        std::filesystem::create_hard_link(convert(temporary),convert(destination),error);
        if(!error)temporary.deleteFile();
    }
    return !error;
#endif
}
}
