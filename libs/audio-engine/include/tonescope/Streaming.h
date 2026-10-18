#pragma once
#include <cstdint>
#include <memory>
#include <string>

namespace tonescope {
struct WavInfo {
    double sampleRate = 0;
    int channels = 0, bits = 0;
    bool floatingPoint = false;
    std::int64_t frames = 0;
};
// File-worker APIs only. No method is suitable for an audio callback.
// Scratch storage is fixed; opening a large file never allocates its sample payload.
class WavStreamReader {
public:
    explicit WavStreamReader(const std::string& utf8Path);
    ~WavStreamReader();
    WavStreamReader(const WavStreamReader&) = delete;
    const WavInfo& info() const noexcept;
    std::int64_t position() const noexcept;
    void seek(std::int64_t frame);
    int read(float* const* destination,int frames);
private:
    struct Impl;std::unique_ptr<Impl> impl;
};
class WavStreamWriter {
public:
    WavStreamWriter(const std::string& utf8Path,double rate,int channels);
    ~WavStreamWriter();
    WavStreamWriter(const WavStreamWriter&) = delete;
    void write(const float* const* samples,int frames);
    void finish(); // Header/read-back validity is awarded only after successful finish.
    std::int64_t frames() const noexcept;
private:
    struct Impl;std::unique_ptr<Impl> impl;
};
}
