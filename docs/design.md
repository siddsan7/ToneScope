# ToneScope interface design

The current interface embeds dark React/shadcn/Radix instrument controls and Motion inside JUCE's native Windows shell. Space Grotesk and Commit Mono are locally bundled from Free Faces selections. Muted sage identifies dry audio and amber identifies processed audio; labels and dashed lines preserve non-color cues. Waveform selection follows the pointer continuously; reduced motion, forced colors and 100–200% text sizing are supported. See `frontend/README.md` for assets, licenses and the native command boundary.

Native audio, choosers, devices, sessions and exports remain owned by C++. The browser receives bounded measurements and typed commands; it does not process audio or receive assistant credentials. The optional assistant presents predictions separately from measured previews and requires explicit acceptance. Native controls remain the runtime fallback.

The following section documents the original native fallback design. Its historical capture/duration and implementation limits are superseded by `delivery/brain.md` and `delivery/progress.json`.

## Native fallback reference

The design thesis is **a closer listen**: the waveform and spectrum share one large, quiet study surface, while effects remain in a consistent signal-chain inspector. The blue dry trace and amber processed trace are the only strong colors; solid versus interrupted strokes and explicit names also identify them. This is a native JUCE Windows application, not a browser or rendered mockup. Native Windows titlebar, file choosers, device selector, keyboard navigation and JUCE control accessibility provide the platform foundation.

## References read and translated

The implementation uses the requested `apple-look` and `apple-motion` skills. Apple platform principles guide the hierarchy and behavior; macOS-specific menu locations, SF fonts and materials are not copied into Windows. The following local skill references were read (headings and short excerpts identify the applied principle):

| Reference and heading | Principle | Native implementation |
|---|---|---|
| `accessibility.md` › Vision | “Convey information with more than color alone.” | Names, line styles, numeric values and keyboard selection accompany traces. |
| `layout.md` › Visual hierarchy | “Group related items to clearly express related information or functions.” | Study surface, comparison controls and persistent chain inspector have distinct spatial roles. |
| `typography.md` › Ensuring legibility | “In general, avoid light font weights.” | System font, regular/bold weights, 13 pt control labels and a compact 28 pt product title. |
| `color.md` › Best practices | Semantic roles and sufficient contrast | One appearance-aware palette for background, surface, ink, secondary ink, grid and two signals. |
| `designing-for-macos.md` › Best practices | Resizable windows and productive display use | Native titlebar; responsive study surface and fixed readable inspector; minimum 960×720 logical pixels. Windows conventions take priority. |
| `keyboards.md` › Best practices | “Respect standard keyboard shortcuts.” | Ctrl+O import, Ctrl+S session, Space play/pause and Escape stop; tab-accessible controls with numeric entry. |
| `focus-and-selection.md` › Best practices | “Avoid changing focus without people’s interaction.” | Standard JUCE focus behavior; background completion updates content without requesting focus. |
| `charting-data.md` › Best practices | “Keep a chart simple, letting people choose when they want additional details.” | One linked waveform and one logarithmic frequency trace with explicit units; no decorative plots. |
| `motion.md` › Best practices | “Let people cancel motion.” | No input-blocking transitions. Selection follows pointer immediately; playback cursor updates independently of worker analysis. |
| `dark-mode.md` › Best practices | “Avoid offering an app-specific appearance setting.” | JUCE Desktop appearance listener applies light/dark semantic roles when Windows appearance changes. |
| `cross-platform.md` › Desktop conventions | Prefer native chrome and input conventions | JUCE native Windows shell and controls rather than imitating macOS window furniture. |
| `apple-motion/SKILL.md` › Response / Direct manipulation / Reduced motion | Immediate, continuous response and static alternatives | No springs, parallax, animated backgrounds, transitions or looping decoration. Thus both OS motion settings receive the same static controls. The moving playback cursor conveys time only. |

References reside under `C:/Users/sidds/.codex/skills/apple-look/references/` and `C:/Users/sidds/.codex/skills/apple-motion/SKILL.md`. They are design evidence, not a claim of Windows accessibility conformance. No transparency effects are required for the instrument surface.

## Implemented interactions

- Import bounded mono/stereo WAV to an immutable source. A background worker renders from sample zero, preserving effect history when selecting a later passage. Stale revisions cannot publish measurements or playback buffers. Queued stale replaceable jobs are removed, bounding rendering to one active plus one pending job; export work remains separate from this cancellation policy.
- Play/pause, rewind, seek and loop the selected interval. Playback uses linear rate conversion when source and device rates differ; it is a development resampler, not qualified production SRC. A 128-source-frame boundary envelope and ±0.95 monitor output guard affect audition only.
- Per-stage enable/bypass and six stage orders; input trim and all API compressor/EQ/drive controls. Stages begin bypassed. Live chain topology changes stop monitoring before reconfiguration.
- Dry, processed, raw residual and RMS-matched residual audition. Frozen RMS correction comes from the selected interval and is capped by the shared comparison engine. Residual is labelled as a mathematical difference, never isolated distortion. Live offers dry/processed; residual uses replay.
- Pointer time selection plus numeric seconds start/end. Both waveform channels remain in playback; plots aggregate channels for display. Spectrum takes up to 2048 selected samples, zero-pads short intervals, and labels padding explicitly. The shared analysis engine defines the Hann/window normalization and channel aggregation.
- Audio device and buffer selection. Monitoring requires an explicit user action after selection; it starts off. Negotiated rate and buffer, live gain reduction, invalid sample count and output guard interventions are visible. Device failure disables monitoring; it requires explicit re-enabling.
- Bounded local dry capture, up to 120 seconds. Stop creates a replayable source to render through current settings. No upload or external account exists.
- Atomic file-backed session save, strict version/parameter validation on open, missing-source error and full-source processed WAV plus JSON comparison evidence export. The session contract is shared with CLI: `schema_version`, `source`, `parameters` keyed by Engine.h names and optional `ui` selection/audition fields. UI selection bounds are normalized to 0…1; audition is `dry`, `wet` or `residual`; `rms_match` distinguishes matched residual.

## Ownership and real-time behavior

The message thread owns UI/source/render lifetimes. Replacing cached playback detaches the audio callback, publishes immutable buffers, then reattaches; the callback never creates or destroys shared pointers. Live input uses fixed 512-frame stereo scratch blocks and a preallocated bounded capture buffer. Parameters cross a fixed SPSC queue; callback consumes at most 32 entries and applies the latest validated snapshot once. Processing, capture, cursor and telemetry use lock-free atomics; file I/O, rendering, FFT, JSON and UI stay outside the callback. The callback uses the core nonthrowing realtime setter and mutes on a rejected snapshot. The device-start path prepares the engine without reading controls. Hardware profiling is still required to qualify the whole device callback.

## Concrete development limits

This is a D1 development shell with parts of D2. File import is limited to 100 MiB and 120 seconds to bound full-source render memory. Live rates are restricted to 44.1–96 kHz. File plots are cached; live plots require capture and replay. Frequency-band audition, multiband compression, attack/decay segmentation, envelope/gain-reduction histories, undo, recording overflow persistence, device-removal recovery qualification, qualified high-quality resampling and installer/signature workflows are not implemented here. Captured takes can replay/export wet audio but cannot yet save a persistent dry-source session. Source digest checks are implemented on import/session reopen; missing-source recovery and full schema migration remain integration work. A full native command menu is also absent.

Contrast and accessibility must be measured in the running Windows app, including high contrast, Narrator, keyboard traversal, system text scaling and mixed-DPI displays. There has been no human accessibility pilot or listening test. The layout, OS appearance propagation and interactive motion require runtime inspection; source inspection cannot establish effectiveness. The interface deliberately uses no optional spatial animation, so reduced-motion behavior is immediate static state changes by construction.

## Snapshot review and measured colors

The native offline component snapshot `artifacts/ui/desktop-final.png` was inspected. Numeric controls now use the content ink, and labels use ASCII to avoid Windows narrow-string encoding errors. This verifies rendered layout only, not keyboard/Narrator/hardware behavior.

light: ink #172c40 on #f9fbfd = 13.77:1, secondary #435e75 on #f9fbfd = 6.54:1, dry #156296 on #f9fbfd = 6.29:1, wet #944c05 on #f9fbfd = 6.14:1.

dark: ink #edf3f8 on #1d2a38 = 13.03:1, secondary #b4c5d6 on #1d2a38 = 8.26:1, dry #83c4ee on #1d2a38 = 7.70:1, wet #ffc080 on #1d2a38 = 9.10:1.

