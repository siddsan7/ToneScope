#include "tonescope/Engine.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
using tonescope::Engine;
using tonescope::Parameters;
constexpr double pi = 3.14159265358979323846;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
void near(double actual, double expected, double tolerance, const char* message) {
    if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
        std::cerr << message << ": actual=" << actual << " expected=" << expected << '\n';
        throw std::runtime_error(message);
    }
}
std::array<float, 2> tick(Engine& engine, float left, float right) {
    std::array<float, 2> output{};
    const float* input[] = {&left, &right};
    float* out[] = {&output[0], &output[1]};
    engine.process(input, out, 1);
    return output;
}

// Independent scalar contract: linked mean-square energy, a 10 ms detector,
// a quadratic knee, and attack/release smoothing of reduction in dB.
// This uses only the public Engine API and no generated or host DSP helpers.
struct Reference {
    double energy = 0, reduction = 0;
    double step(float left, float right, double rate, const Parameters& p) {
        const double detectorPole = std::exp(-1.0 / (0.010 * rate));
        energy = detectorPole * energy + (1.0 - detectorPole) *
            (double(left) * left + double(right) * right) / 2.0;
        const double over = 10.0 * std::log10(std::max(energy, 1e-30)) - p.thresholdDb;
        const double slope = 1.0 - 1.0 / p.ratio;
        double desired = 0;
        if (p.kneeDb > 0 && over > -p.kneeDb / 2 && over < p.kneeDb / 2) {
            const double distance = over + p.kneeDb / 2;
            desired = slope * distance * distance / (2 * p.kneeDb);
        } else if (over >= p.kneeDb / 2) {
            desired = slope * over;
        }
        const double ms = desired > reduction ? p.attackMs : p.releaseMs;
        const double pole = std::exp(-1.0 / (ms * 0.001 * rate));
        reduction = pole * reduction + (1.0 - pole) * desired;
        return std::pow(10.0, (p.makeupDb - reduction) / 20.0);
    }
};

void scalarReferenceTests() {
    for (double rate : {8000., 44100., 48000., 96000., 192000.}) {
        for (float knee : {0.f, 6.f, 24.f}) {
            Parameters p;
            p.compressor = true;
            p.thresholdDb = -24;
            p.ratio = 5;
            p.attackMs = 3;
            p.releaseMs = 80;
            p.kneeDb = knee;
            p.makeupDb = 2;
            p.toneHz = float(std::min(5000., .4 * rate));
            Engine engine;
            engine.prepare(rate, 2, p);
            require(engine.latencySamples() == 0, "full-band compressor adds no delay");
            Reference reference;
            // Unequal levels, one silent channel, opposite polarity, then
            // complete silence exercise linking, attack, and state decay.
            const int section = int(rate / 5);
            for (int n = 0; n < 5 * section; ++n) {
                const float wave = float(.7 * std::sin(2 * pi * 173 * n / rate));
                float left = 0, right = 0;
                if (n < section) { left = wave; right = wave * .125f; }
                else if (n < 2 * section) { left = wave; }
                else if (n < 3 * section) { left = wave; right = -wave; }
                else if (n < 4 * section) { left = .002f; right = -.001f; }
                const double gain = reference.step(left, right, rate, p);
                const auto output = tick(engine, left, right);
                near(output[0], float(left * gain), 2e-7, "left output matches scalar recurrence");
                near(output[1], float(right * gain), 2e-7, "right output matches scalar recurrence");
                near(engine.gainReductionDb(), reference.reduction, 2e-5, "gain reduction matches scalar recurrence");
            }
            require(engine.invalidSamples() == 0, "valid compressor fixtures have no sample faults");
        }
    }
}

void monoAndLifecycleTests() {
    for (bool multiband : {false, true}) {
        Parameters p;
        p.compressor = true;
        p.multiband = multiband;
        p.thresholdDb = -30;
        p.attackMs = 2;
        Engine mono, stereo, fresh;
        mono.prepare(48000, 1, p);
        stereo.prepare(48000, 2, p);
        for (int n = 0; n < 18000; ++n) {
            const float x = float(.6 * std::sin(2 * pi * 137 * n / 48000));
            const auto a = tick(mono, x, x), b = tick(stereo, x, x);
            require(a[0] == b[0] && b[0] == b[1], "mono equals duplicate-input stereo");
            require(mono.gainReductionDb() == stereo.gainReductionDb(), "mono detector equals linked duplicate stereo");
        }
        stereo.reset();
        fresh.prepare(48000, 2, p);
        require(stereo.gainReductionDb() == 0, "reset clears reduction");
        require(stereo.bandGainReductionDb() == std::array<float, 3>{}, "reset clears band reductions");
        for (int n = 0; n < 4096; ++n) {
            require(tick(stereo, .4f, -.2f) == tick(fresh, .4f, -.2f), "reset matches fresh engine audio");
            require(stereo.bandGainReductionDb() == fresh.bandGainReductionDb(), "reset matches fresh band state");
        }
        stereo.prepare(96000, 1, p);
        fresh.prepare(96000, 1, p);
        for (int n = 0; n < 4096; ++n)
            require(tick(stereo, .3f, 0)[0] == tick(fresh, .3f, 0)[0], "reprepare clears history and changes sample rate/channel count");
    }
}

void bypassTests() {
    Parameters p;
    p.compressor = true;
    p.thresholdDb = -30;
    Engine active, frozen;
    active.prepare(48000, 2, p);
    frozen.prepare(48000, 2, p);
    for (int n = 0; n < 12000; ++n)
        require(tick(active, .7f, -.1f) == tick(frozen, .7f, -.1f), "bypass fixture starts in identical state");
    p.compressor = false;
    active.setParameters(p);
    for (int n = 0; n < 24000; ++n) {
        require(tick(active, .03f, -.02f) == std::array<float, 2>{.03f, -.02f}, "bypass passes audio unchanged");
        require(active.gainReductionDb() == 0, "bypass hides inactive reduction");
    }
    p.compressor = true;
    active.setParameters(p);
    for (int n = 0; n < 12000; ++n) {
        require(tick(active, .15f, -.05f) == tick(frozen, .15f, -.05f), "full-band bypass freezes detector and reduction state");
        require(active.gainReductionDb() == frozen.gainReductionDb(), "resumed full-band telemetry retains frozen state");
    }

    p.multiband = true;
    active.prepare(48000, 2, p);
    for (int n = 0; n < 12000; ++n) tick(active, .7f, -.1f);
    p.compressor = false;
    active.setParameters(p);
    for (int n = 0; n < 4096; ++n) tick(active, .1f, -.1f);
    p.compressor = true;
    active.setParameters(p);
    frozen.prepare(48000, 2, p);
    for (int n = 0; n < 4096; ++n) {
        require(tick(active, .3f, -.2f) == tick(frozen, .3f, -.2f), "multiband toggle resets crossover and compressor histories");
        require(active.bandGainReductionDb() == frozen.bandGainReductionDb(), "multiband toggle clears band reduction histories");
    }
}

void independentInstancesTest() {
    Parameters p;
    p.compressor = true;
    p.multiband = true;
    p.thresholdDb = -30;
    Engine first, second, firstReference, secondReference;
    for (Engine* engine : {&first, &second, &firstReference, &secondReference}) engine->prepare(48000, 2, p);
    for (int n = 0; n < 24000; ++n) {
        const float high = float(.6 * std::sin(2 * pi * 7000 * n / 48000));
        const auto a = tick(first, .7f, -.4f);
        const auto b = tick(second, high, 0);
        require(a == tick(firstReference, .7f, -.4f), "interleaved engine does not change first engine audio");
        require(b == tick(secondReference, high, 0), "interleaved engine does not change second engine audio");
    }
    const auto lowBands = first.bandGainReductionDb(), highBands = second.bandGainReductionDb();
    require(lowBands[0] > lowBands[2] + 3, "DC fixture compresses low band independently");
    require(highBands[2] > highBands[0] + 3, "high tone compresses high band independently");
}
}

int main() {
    try {
        scalarReferenceTests();
        monoAndLifecycleTests();
        bypassTests();
        independentInstancesTest();
        std::cout << "compressor state tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "compressor state tests failed: " << error.what() << '\n';
        return 1;
    }
}
