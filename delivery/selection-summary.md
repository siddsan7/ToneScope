# Accessible selection-summary prototype

Goal: provide a keyboard-readable plain-language summary of the current selection
using structured native evidence. Explicitly explain missing, stale, silent or
unsupported measurements. Speech starts only after a user action; paid AI stays
disabled. Preserve all existing numerical checks and audio/application controls.

Design: one quiet section beside selection controls, semantic heading/definition
list, visible unavailable reasons, ordinary Read aloud/Stop reading buttons and a
small speech status (no live announcements of polling measurements). Reuse the
existing colors, typography, focus treatment and text scaling. No new dependency.

Speech: use only an explicitly local browser/system voice. Never speak on load or
poll, never fall back to a remote voice, cancel stale/hidden/interrupted summaries,
and leave playback controls under the user's control. No voice/API support is a
visible unavailable state; text always remains available.

Acceptance: structured native revision/sample-span evidence, zero/silence and
invalid values handled honestly; unchanged polls do not restart speech; keyboard
buttons, cancellation, voice failure/absence and privacy tested; real embedded
summary values agree with native state. Existing UI/native/service/eval gates
remain intact. Automated checks do not establish human screen-reader usability.

Implementation: `WebFrontend.inc` exports cached dry/processed RMS, unmatched
processed sample peak, revision, band and aligned source span. It withholds old
values during render/live audio/assistant audition. `selection-summary.ts` checks
freshness independently, derives bounded text and level ratios, and labels zero
or sub-floor energy without inventing a decibel floor. Manual contrast requires
current disjoint marks inside the measured full-range selection.

`SelectionSummary.tsx` uses a named region, heading and definition list. Its text
is not a live region; only speech-action status is polite/atomic. Read/Stop are
ordinary keyboard buttons. `summary-speech.ts` owns one utterance, refuses remote
or unknown-locality voices, exposes API/voice/cancellation errors, and does not
control instrument playback. Text scaling and reduced motion reuse existing UI.

Design review used apple-look references: accessibility.md › Vision (“Support
larger text sizes” and “Convey information with more than color alone”);
focus-and-selection.md › Best practices (“Avoid changing focus without people’s
interaction”); feedback.md › Best practices (“Show people when a command can’t be
carried out and help them understand why”). Existing theme/type/focus and a plain
inline section are project conventions; local-English-only speech and disabling
Read during audio activity are implementation choices for this English prototype.
No new dependency, automatic narration, provider call or audio callback work.

Independent review confirmed scalar/matching/latency/streaming semantics and found
one speech-error bug: simultaneous speak/cancel failure could disable Stop. The
fix preserves ownership/active state and has a regression. Platform cancel failure
retains Stop and directs people to system speech controls instead of claiming it
stopped. The first test invocation hit restricted Windows temp permissions; tests
use an explicit workspace temp directory without weakening checks.

Human follow-up: navigate the summary with Windows Narrator and keyboard; confirm
reading order, unavailable explanations, focus visibility and 200% text; test an
actual installed local English voice, Stop/Escape, selection changes, audio start,
minimize and voice removal. Browser-reported localService is the voice-selection
boundary, not an independent audit of an OS speech provider. No human hearing or
screen-reader qualification is inferred from deterministic speech tests.

Final verification: frontend22/22 tests, typecheck/build and dependency audit0;
Python95/95, service139/139/typecheck and native9/9; existing contracts10/10,
DSP12/12, integration7/7 and required blocked AI replay development gate pass.
The rebuilt desktop passes startup/singleton and all6 existing UI guard checks.
Actual embedded assistant preview/A-B/match/apply/undo checks remain intact.
The added embedded probe verifies native RMS text, keyboard Enter/Stop, no speech
on load/poll, selection/playback/hidden-page cancellation, remote-voice refusal,
named accessibility-tree region/buttons and200% text without horizontal overflow.
Speech/lifecycle routing uses a deterministic test double, not audible speech.

Windows restricted npm restoration failed before bundling; existing locked
dependencies were restored with the required filesystem access, then the app was
rebuilt. Initial embedded probes therefore found the old bundle. A later keyboard
probe omitted Enter's character event; diagnostics showed a focused/enabled button
with no activation, and the complete Enter event passed. Failed logs are retained.
No product checks were removed or loosened to address those environment/probe
failures. A final formatter regression distinguishes pending rendering from an
unavailable/failed render and offers a retry action instead of an indefinite wait.

Evidence: ignored `artifacts/selection-summary/`, especially `embedded-summary.json`,
`embedded-summary.png`, final test/build logs and `verification.json`. Windows CI
adds the optional `-SelectionSummary` probe after the original embedded assertions.
No paid AI adapter, budget, model or DSP numerical gate changed. No remote CI,
human Narrator/voice/listening, device or public release qualification performed.
