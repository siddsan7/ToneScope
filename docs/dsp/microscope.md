# Native microscope processing

The audio engine is sample-state deterministic. Splitting a render into different callback sizes does not change its arithmetic sequence. All filters, delay histories and per-band detectors use fixed storage allocated in the engine constructor. Preparation/reset reconstruct state from zero; authoritative offline renders start at source sample zero. Seeking directly into arbitrary history is unsupported.

## Drive quality and timing

`oversampling` accepts 1, 2 or 4. The drive starts with source-rate pre-emphasis `x[n] + .25*(x[n]-x[n-1])`, then interpolation, drive gain, the generated Faust `tanh`, a one-pole tone lowpass, a 20 Hz DC blocker, and decimation. Tone/DC coefficients use the internal rate. The 1x path bypasses resampling.

Each resampling filter is a DC-normalized Blackman-windowed sinc, length `32*factor+1`, cutoff `.45/factor` cycles per internal sample. Interpolation zero-stuffs and multiplies input by the factor; decimation selects phase zero. Two symmetric FIRs contribute exactly 32 source samples of pure delay. `latencySamples()` reports 32 when drive is enabled at 2x/4x and zero otherwise. Tone/DC and crossover filters additionally have frequency-dependent phase; the integer declaration does not remove that phase. Oversampling is not alias-free. The filters have finite transition width near the source Nyquist frequency, so passband loss there is expected.

Changing oversampling, crossover frequencies or multiband mode requires the stopped `setParameters` call, which resets state. Enabling/disabling oversampled drive or multiband compression also requires that call. `setParametersRealtime` rejects these changes and retains the prior settings without allocation. The host must invalidate previous render/alignment results. `render()` preserves source frame count and does not append a tail; the last 32 delayed samples of an oversampled render are unavailable. Render explicit source padding if a full decay tail is needed.

## Phase-correct three-band compressor

Each crossover uses two cascaded Butterworth second-order lowpasses and two corresponding highpasses (Linkwitz–Riley fourth order). If `L0/H0` are the low crossover and `L1/H1` the high crossover, the bands are:

- Low: `L0*(L1+H1)`
- Mid: `H0*L1`
- High: `H0*H1`

Their unity sum is `(L0+H0)*(L1+H1)`, a product of allpasses. The compensating upper split on the low branch is essential. Magnitude is flat; phase is frequency dependent, so neutral three-band processing is not raw time-domain identity. `crossoverReference` returns the phase-matched unity sum, with the same source clamp and input trim as the engine. It deliberately isolates crossover coloration: no EQ, drive, compression, makeup or output gain. Use it when those other stages are disabled and makeup/output gain are zero, or apply the other linear calibration explicitly.

Crossover frequencies must be finite: low in `[20,.4*fs]`, high in `[40,.45*fs]`, with high at least twice low. Defaults are 200/2000 Hz. The compressor must be enabled for `multiband` to affect Engine output. Each band uses the existing threshold, ratio, knee, makeup and attack/release parameters, with its own stereo-linked energy detector. Per-band controls are unsupported.

For each band, channel-mean squared energy feeds `e[n]=a*e[n-1]+(1-a)*energy[n]`, `a=exp(-1/(.010*fs))`. Threshold and soft knee operate on `10*log10(e)`. Positive reduction in dB follows the target with `a=exp(-1/(tau*fs))`; tau is attack when reduction increases, release otherwise. Thus a fixed target reaches 63.212% after one tau; the energy detector contributes its own preceding 10 ms response. Ratio one and zero makeup preserve the phase-matched reference. `gainReductionDb()` reports the maximum band reduction; `bandGainReductionDb()` reports all three positive dB reductions. Accessors are processing-thread state, not synchronized cross-thread transport.

## Offline comparison and dynamics

`compareAligned` uses `wet[n+wetLatency]` against `dry[n]`. Selection indices are source-time indices. Negative latency, mismatched channels/rates, nonfinite data and unavailable samples are rejected. `alignedResidual` returns `wetGain*wet[n+wetLatency]-dry[n]`, truncating only the unavailable tail. Its gain must be finite in `[0,10^(12/20)]`; retain the frozen gain and latency in evidence. The residual is not distortion-only. Alignment compensates a declared pure integer delay, not frequency-dependent phase or external drift.

`auditionPair` applies the same three-band transfer to both full-history branches, each initialized to zero. Full-band mode is an exact bypass. Low/mid/high have the finite transitions and phase above. Align branches before filtering when their processing latencies differ. Both buffers must have equal frame counts. These helpers allocate and are offline only.

`dynamics` returns channel-mean energy RMS and maximum absolute sample peak per hop, plus the same linked 10 ms RMS envelope used by the compressor. Partial final hops are included. Each timestamp is the source sample at the end of that hop. Sample peak is not true peak; no perceptual loudness, note segmentation, automatic attack estimation or intersample reconstruction is claimed.

## Verification scope

Native tests cover 1x/2x/4x block invariance; callback allocation counts; FIR impulse symmetry and delay; independent complex bilinear-transform crossover response at 44.1/48/96 kHz; phase-reference null; raw phase coloration; aligned identity residual; same-band null; stereo linking; finite controls and a closed-form detector step. They do not qualify the E-ALIAS target, hardware callback budget, human listening or model behavior. Full sweep/alias convergence evidence remains the independent evaluator's responsibility; no numerical qualification threshold is weakened here.
