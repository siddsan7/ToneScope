# Dynamics timeline and manual passage comparison

These are offline analysis APIs in `tonescope/Engine.h`; they allocate output storage and must run outside the audio callback. Their units are linear digital sample amplitude, dB amplitude ratios, source sample positions and milliseconds. They do not estimate perceptual loudness or identify played notes.

## Actual processing timeline

`renderWithDynamics(source, parameters, hop, blockSize)` returns:

- `dry`: finite source clamped to [-16,16], then input trim, matching Engine ingress order. Input must already be finite, as for `render()`.
- `wet`: the same complete-history, source-length, unguarded output as `render()` with the same parameters. No monitor limiter or comparison gain is applied. Engine state starts at source zero and persists across all blocks.
- `wetLatencySamples`: Engine's declared output delay (32 samples for active 2x/4x drive, otherwise zero).
- `frames`: dry and aligned wet hop RMS/sample-peak/10 ms envelope metrics, plus actual Engine overall and per-band gain-reduction state snapshots.

`frame.dry.sample` and `frame.wet.sample` are the inclusive last source sample of the hop. For a source window [start,end), wet statistics measure raw output [start+latency,end+latency). Wet envelope integration still starts at raw output sample zero, preserving filter/detector history. `wetAvailable=false` means the source-length render lacks all delayed samples for that hop; wet numerical fields must not be displayed as measurements. The wet timestamp remains present. No tail is invented or flushed to make it appear available.

GR is read directly from `Engine::gainReductionDb()` and `bandGainReductionDb()` after processing the hop's last source input sample. It is an instantaneous end-of-hop snapshot, not a hop average or gain inferred from dry/wet amplitudes. In multiband mode overall reduction is the maximum of the three actual band reductions; per-band values are zero in full-band mode. Makeup, EQ, drive and output gain are not compression reduction. If stage order places delayed drive before compression, the detector observes that stage's delayed signal: the GR timestamp denotes Engine processing position, not a claim of correspondence to an undelayed note. The raw envelope and GR state have distinct meanings.

Each hop (default 512 samples) includes its final partial window. Processing block boundaries split at hop endpoints to read exact DSP state, while preserving identical audio samples under the engine's tested sample/block invariance. The dry/wet envelopes use mean channel energy with `e[n] = a*e[n-1] + (1-a)*mean(x_c[n]^2)`, `a=exp(-1/(0.010*sampleRate))`; displayed envelope is `sqrt(e[n])`. Hop RMS averages channel energy over the hop; peak is the maximum absolute channel sample.

## Explicit manual soft/hard selections

`comparePassages(dry, wet, soft, hard, wetLatencySamples)` takes two user-selected [start,end) source-time intervals, each at least two samples. The labels express the user's choice; the API does not automatically rank passages. Supply `DynamicsRender.dry`, `.wet` and `.wetLatencySamples` to preserve calibration and alignment. Any interval lacking its delayed wet tail, invalid shape/rate/channel pairing, or nonfinite data returns `valid=false`. Overlapping selections are permitted.

Each passage returns separate dry/wet RMS, sample peak, crest factor, envelope peak and optional descriptive rise/decay times. Crest is `20*log10(samplePeak/RMS)`. `rmsChangeDb` is `20*log10(wetRMS/dryRMS)` with no RMS matching. The comparison also reports hard-minus-soft RMS contrast for dry and wet; `contrastChangeDb=wetContrastDb-dryContrastDb`. A negative value describes reduced measured contrast. It does not, by itself, prove better playing dynamics or perceived sound quality.

Crest and level ratios are unavailable below 1e-9 RMS. Silent intervals remain valid measurements of zero RMS/peak; flags distinguish unavailable ratios/timing from a measured zero-dB change. No infinities or fabricated timings are returned.

The descriptive envelope starts at the beginning of each complete source, not at the selection boundary. Rise duration is between the first upward crossings of 10% and 90% of the selection's maximum RMS envelope, at or before its first maximum. Decay duration is between the first downward crossings of 90% and 10% after that maximum. Crossing positions use linear interpolation between consecutive envelope samples. Both crossings must lie inside the selection; the known zero detector state just before source sample zero is allowed for a selection starting at zero. A selection starting after an attack, a sustained/rising passage lacking decay, silence, or an incomplete crossing pair has the corresponding availability flag false. These are selected-envelope descriptions, not note onset estimates, compressor attack settings, or fitted physical time constants. A 10 ms squared-energy detector has an approximately 16.51 ms 10–90% RMS step rise and 43.94 ms 90–10% RMS decay.

## Development evidence

Native tests compare timeline output exactly against ordinary render, and GR snapshots against independent one-sample Engine stepping through full-band/multiband and 1x/2x/4x drive. They check delayed wet windows and explicit tail availability, clamp-before-trim dry calibration, output gain producing no fake GR, known two-level soft/hard contrast, analytic step-envelope rise/decay, a monotonic ramp, preserved pre-selection history, silence and invalid inputs. These are software checks; no human listening, polyphonic note segmentation, device timing or perceptual loudness qualification is implied.
