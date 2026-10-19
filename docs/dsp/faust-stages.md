# Ahead-of-time Faust stages

The runtime executes four graphs generated with pinned Faust 2.88.0:

- `drive.dsp`: bounded tanh transfer (existing float input/output).
- `compressor.dsp`: RMS integration, dB detector, hard/soft knee, attack/release gain-reduction smoothing, makeup and linear gain.
- `eq-coefficients.dsp`: RBJ low shelf, peaking bell and high shelf coefficient design.
- `biquad.dsp`: transposed direct-form II sample and state update for each tone-EQ section.

`Engine.cpp` calls a persistent generated compressor on every active full-band or band audio step, the coefficient graph when smoothed EQ design parameters change, and the biquad graph for every active EQ section/channel/sample. They are actual algorithm implementations; no parallel handwritten compressor or EQ implementation is used. The compressor graph owns its detector and reduction recurrences, stereo linking, makeup and audio gain. One graph serves full-band and three independent graphs serve the crossover bands. Mono duplicates its input to preserve the mean-energy detector. Host helpers in `Dsp.h` use fixed stack ports. EQ biquad state remains explicit input/output in C++. Generated `clone()` methods allocate but are never invoked by the callback or adapters.

Compressor and EQ use double internal arithmetic **and double graph buffers**; the public audio API remains float. The host retains its existing sample-wise parameter smoothing, stage order, reset/bypass policy and crossover processing. Compressor telemetry copies do not feed its recurrence. Generation can algebraically reorder floating-point expressions, so equality to historical render bytes is not promised. Chunking invariance remains exact within the current implementation. Existing independent numerical tolerances are unchanged. See [the stateful compressor architecture](../showcase/compressor.md).

## Frozen conventions

The linked detector input is mean channel energy; its fixed integration coefficient is `exp(-1/(0.010*sampleRate))`. Detector dB is `10*log10(max(energyState,1e-30))`. With `over = detectorDb - threshold`, compression slope is `1 - 1/ratio`. Below the lower knee edge the target reduction is zero, inside a nonzero knee it is `slope*(over+knee/2)^2/(2*knee)`, and above the upper edge it is `slope*over`. At a hard knee, zero over gives zero reduction. Reduction uses `exp(-1/(milliseconds*0.001*sampleRate))`, selecting attack for increasing reduction and release otherwise. Linear output gain is `10^((makeup-reduction)/20)`. Ratio one and zero makeup produce exact unity gain.

EQ uses a 120 Hz low shelf, user-selected bell frequency/Q, and high shelf at `min(6000,0.4*sampleRate)`. Shelf slope remains the established RBJ convention with `t = 2*sqrt(A)*sin(w)/sqrt(2)`. Parameters are smoothed in the host with its existing 15 ms sample-time coefficient; valid smoothed design parameters are converted to coefficients, rather than interpolating coefficients. Stereo channels share coefficients and retain independent filter histories. Reset clears those histories and forces coefficient regeneration.

The host continues to own scheduling, stage order/bypass, control validation, smoothing, crossover/FIR math, and drive pre-emphasis/tone/DC filters. Stereo energy linking belongs to the compressor graph. Those surrounding filters are authored C++; this document does not claim they are Faust algorithms. No runtime compiler, filesystem access, dynamic buffer allocation or graph UI is needed for processing.

## Reproducibility and verification

Run `dsp/faust/verify-generated.ps1 -Faust <path-to-pinned-faust.exe>`. The script regenerates every graph, checks normalized source/output SHA-256 hashes in `dsp/generated/manifest.json`, and compares exact generated text. Hashes use UTF-8 and LF normalization to survive Git Windows line-ending conversion. Regeneration arguments are stored per graph; coefficient/compressor/biquad graphs require `-double`.

Native checks exercise an independent compressor recurrence through detector rise/decay, hard/soft knees, ratios and rates; coefficient pole stability and shelf/center gains; independent biquad state updates; exact block invariance across six stage orders, both compressor topologies and supported rates; and allocation-free callbacks including smoothed coefficient regeneration. Existing extreme-control, crossover, oversampling, stereo and reset checks remain enabled. These checks do not qualify hardware latency, human listening, or universal numerical behavior outside supported controls.
