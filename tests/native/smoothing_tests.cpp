#include "tonescope/Engine.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
constexpr double smoothingSeconds = .015;
constexpr double toleranceDb = .004; // Includes float state quantization at 192 kHz.

std::vector<float> exercise(double rate, int blockSize, bool realtime) {
    tonescope::Parameters p;
    p.toneHz = static_cast<float>(std::min(5000., .45 * rate));
    p.outputDb = -6;
    tonescope::Engine engine;
    engine.prepare(rate, 2, p);
    const int segment = static_cast<int>(rate * .2);
    std::vector<float> result;
    std::vector<float> left(blockSize, .125f), right(blockSize, -.25f);
    std::vector<float> outLeft(blockSize), outRight(blockSize);
    double initialDb = -6;
    for (const float target : {6.f, -12.f}) {
        p.outputDb = target;
        if (realtime) {
            if (!engine.setParametersRealtime(p)) throw std::runtime_error("valid realtime gain rejected");
        } else engine.setParameters(p);
        for (int first = 0; first < segment; first += blockSize) {
            const int count = std::min(blockSize, segment - first);
            const float* input[]{left.data(), right.data()};
            float* output[]{outLeft.data(), outRight.data()};
            engine.process(input, output, count);
            for (int i = 0; i < count; ++i) {
                const int elapsed = first + i + 1; // Setter target applies before first processed sample.
                const double expectedDb = target + (initialDb - target)
                    * std::exp(-elapsed / (smoothingSeconds * rate));
                for (const double actual : {outLeft[i] / .125, outRight[i] / -.25}) {
                    const double observedDb = 20 * std::log10(actual);
                    if (!std::isfinite(observedDb) || std::abs(observedDb - expectedDb) > toleranceDb) {
                        std::cerr << "rate=" << rate << " block=" << blockSize
                                  << " realtime=" << realtime << " sample=" << elapsed
                                  << " target=" << target << " expected_db=" << expectedDb
                                  << " observed_db=" << observedDb << '\n';
                        throw std::runtime_error("15 ms per-sample dB smoothing response mismatch");
                    }
                }
                result.push_back(outLeft[i]);
            }
        }
        // Infer the actual endpoint, preserving float-state history for the next step.
        initialDb = 20 * std::log10(result.back() / .125);
    }
    if (engine.latencySamples() != 0 || engine.invalidSamples() != 0)
        throw std::runtime_error("unexpected bypass-path latency or faults");
    return result;
}
}

int main() {
    try {
        for (const double rate : {8000., 48000., 192000.}) {
            const auto reference = exercise(rate, 1, true);
            for (const int block : {17, 257, 2048})
                if (exercise(rate, block, true) != reference)
                    throw std::runtime_error("smoothing depends on process block boundaries");
            if (exercise(rate, 257, false) != reference)
                throw std::runtime_error("offline and realtime gain setter responses differ");
        }
        std::cout << "PASS: analytic 15 ms dB smoothing at 8/48/192 kHz; first, middle and settled samples; rising/falling steps; stereo; blocks 1/17/257/2048; both setters.\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "FAIL: " << e.what() << '\n';
        return 1;
    }
}
