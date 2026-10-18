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
    int oversampling = 1; // 1, 2 or 4; change only while stopped, then reset
    bool multiband = false; // compressor uses three linked RMS detectors
    float crossoverLowHz = 200, crossoverHighHz = 2000;
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
    void prepare(double sampleRate, int channels, const Parameters& initial);
    void reset();
    void setParameters(const Parameters&); // validated; audio-thread single writer
    bool setParametersRealtime(const Parameters&) noexcept; // no allocation/exception, retains last valid state on rejection
    void process(const float* const* input, float* const* output, int frames) noexcept;
    int latencySamples() const noexcept;
    float gainReductionDb() const noexcept;
    std::array<float, 3> bandGainReductionDb() const noexcept;
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
// Offline helpers. Positive wetLatency compares wet[n + latency] to dry[n].
// Selection indices are in dry/source time; invalid intervals are rejected.
Comparison compareAligned(const AudioData& dry, const AudioData& wet, std::int64_t start,
                          std::int64_t end, bool match, int wetLatency);
AudioData alignedResidual(const AudioData& dry, const AudioData& wet, int wetLatency, double wetGain = 1);
enum class AuditionBand { full, low, mid, high };
struct AuditionPair { AudioData dry, wet; };
AuditionPair auditionPair(const AudioData& dry, const AudioData& wet, AuditionBand,
                         double lowHz = 200, double highHz = 2000);
// Unity-gain LR4 crossover sum, with the same ingress clamp/trim as Engine.
AudioData crossoverReference(const AudioData&, const Parameters&);
struct DynamicsFrame {
    std::int64_t sample = 0; // source position at end of frame
    double rms = 0, samplePeak = 0, envelopeRms = 0;
};
// Linked stereo energy, 10 ms one-pole RMS detector; finite data required.
// initialEnergy is linked mean-squared detector state before audio sample zero;
// cached windows must supply the exact preceding state. Finite and >=0 required.
std::vector<DynamicsFrame> dynamics(const AudioData&, int hop = 512, double initialEnergy = 0);
struct ProcessingDynamicsFrame {
    DynamicsFrame dry, wet; // source-end sample; wet measured at sample + latency
    bool wetAvailable = false; // final hop can lack delayed output
    float gainReductionDb = 0; // actual compressor state at this sample
    std::array<float, 3> bandGainReductionDb{}; // zero outside multiband mode
};
struct DynamicsRender {
    AudioData dry, wet; // dry = finite ingress clamp + input trim; wet = render()
    int wetLatencySamples = 0;
    std::vector<ProcessingDynamicsFrame> frames;
};
// Offline complete-history render. End-of-hop snapshots are actual DSP state;
// no limiter or RMS matching is applied. Throws on invalid input/parameters.
DynamicsRender renderWithDynamics(const AudioData&, const Parameters&, int hop = 512, int blockSize = 257);
struct SampleInterval { std::int64_t start = 0, end = 0; }; // [start,end), source time
struct PassageSignalMetrics {
    double rms = 0, samplePeak = 0, crestDb = 0, envelopePeak = 0;
    bool crestAvailable = false, riseAvailable = false, decayAvailable = false;
    double riseMs = 0, decayMs = 0; // full-history 10 ms RMS envelope crossings
};
struct PassageMetrics {
    PassageSignalMetrics dry, wet;
    bool rmsChangeAvailable = false;
    double rmsChangeDb = 0; // 20 log10(wet RMS / dry RMS), no level matching
};
struct PassageComparison {
    bool valid = false;
    PassageMetrics soft, hard; // explicit manual labels, never inferred notes
    bool contrastAvailable = false;
    double dryContrastDb = 0, wetContrastDb = 0, contrastChangeDb = 0;
};
// Both manual selections must have >=2 available aligned samples. Nonfinite
// data, shape/rate mismatch or invalid selections return valid=false.
// Level ratios and crest are unavailable below 1e-9 RMS; absent 10/90 percent
// crossings are unavailable. Initial energies precede dry/wet sample zero,
// before alignment; each must be finite and >=0. No loudness/onset claims.
PassageComparison comparePassages(const AudioData& dry, const AudioData& wet,
    SampleInterval soft, SampleInterval hard, int wetLatencySamples = 0,
    double dryInitialEnergy = 0, double wetInitialEnergy = 0);

}
