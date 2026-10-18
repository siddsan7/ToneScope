#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace tonescope {
struct Parameters {
    float inputDb = 0, thresholdDb = -18, ratio = 4, attackMs = 10, releaseMs = 150, kneeDb = 6, makeupDb = 0;
    float lowDb = 0, midDb = 0, highDb = 0, midHz = 1000, midQ = 0.707f;
    float driveDb = 6, toneHz = 5000, outputDb = 0;
    bool compressor = false, equalizer = false, drive = false;
    std::array<int, 3> order {0, 1, 2};
};
bool validate(const Parameters&, double sampleRate, std::string& error);
class Engine {
public:
    Engine();
    ~Engine();
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;
    void prepare(double sampleRate, int channels);
    void reset();
    void setParameters(const Parameters&); // validated; audio-thread single writer
    bool setParametersRealtime(const Parameters&) noexcept; // no allocation/exception, retains last valid state on rejection
    void process(const float* const* input, float* const* output, int frames) noexcept;
    int latencySamples() const noexcept;
    float gainReductionDb() const noexcept;
    std::uint64_t invalidSamples() const noexcept;
private:
    struct Impl;
    Impl* impl;
};
struct AudioData {
    double sampleRate = 48000;
    std::vector<std::vector<float>> samples;
    std::int64_t frames() const { return samples.empty() ? 0 : static_cast<std::int64_t>(samples[0].size()); }
};
AudioData readWav(const std::string& path);
void writeWav(const std::string& path, const AudioData& audio);
AudioData render(const AudioData&, const Parameters&, int blockSize = 257);
struct Comparison {
    bool valid = false;
    double dryRms = 0, wetRms = 0, gain = 1, residualRms = 0, peak = 0;
    bool gainCapped = false;
};
Comparison compare(const AudioData& dry, const AudioData& wet, std::int64_t start, std::int64_t end, bool match);
std::vector<double> spectrum(const AudioData&, std::int64_t start, int fftSize = 2048);
}
