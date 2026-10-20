# Two 90-second walkthrough scripts

These are recording scripts, not recorded videos. Timing includes the listening pauses. Rehearse naturally, trim pauses to fit, and add captions. Audience emphasis is a presentation choice; no company endorsement or integration is implied.

Use the verified private package and attributed source from [the demo runbook](demo-runbook.md). Keep paid AI disabled. Start with the same dry guitar and a neutral patch, with only full-band compression enabled. End on the actual binary identity.

## Chaos: sound, Faust state, and independent evidence

| Time | Screen/action | Narration |
|---|---|---|
| 0–12 s | Import listening/original-2.wav; select 0–8 seconds. Play dry for 4 seconds. | “ToneScope is a guitar-effects workbench. It connects an audible change to the processing and measurements that produced it. Here is the dry guitar.” |
| 12–28 s | Enable compressor: threshold −30 dB, ratio 4:1, attack 10 ms, release 150 ms, knee 6 dB. Play for 4 seconds. | “This is the processed passage. Faust owns the stereo-linked RMS detector, reduction state, and applied gain. C++ hosts the graph and validates and smooths controls.” |
| 28–44 s | Freeze RMS match; show its gain. Switch Dry/Processed on the same selection; listen for 4 seconds. | “I freeze RMS match before comparing. That reduces the average-energy advantage of a louder result. RMS matching does not guarantee equal perceived loudness.” |
| 44–61 s | Pause; show actual gain-reduction trace and manually marked soft/hard passage values. | “The trace reports gain reduction from the processor. These manually marked passages expose measured level contrast. They are measurements, not an inference about musical intent.” |
| 61–78 s | Open the fresh listening page; show curve/timing plots and report identity. | “Independent curve and timing references check defined signals. The musical examples are public regression recordings. They are not an unseen holdout or a listening study.” |
| 78–90 s | Show one undo; end on build identity and limitations caption. | “Changes remain reversible. This is a private desktop engineering demo. It does not establish embedded hardware performance, human preference, or live-model quality.” |

Use non-overlapping soft/hard marks selected from measured dry RMS; rehearse those actions before recording. Keep drive/oversampling for the longer conversation. Be ready to explain detector smoothing versus attack/release, graph lifecycle, and why the numerical reference is independent of the generated processor.

## OHLA: readable evidence and user control

| Time | Screen/action | Narration |
|---|---|---|
| 0–12 s | Import the same source; select 0–8 seconds. Show Selection summary with playback paused. | “ToneScope makes an audio change inspectable through readable measurements. This prototype also exposes what it cannot currently measure.” |
| 12–28 s | Enable the same compressor settings. Play dry and processed for a total of 5 seconds. | “Here is a guitar passage before and after compression. Visual and text evidence accompany the sound, so listening is not the only way to inspect the change.” |
| 28–44 s | Pause. Show dry/processed RMS, sample peak, and actual gain reduction; enlarge interface text. | “The summary identifies the selected interval and the available measurements. RMS is signal level, not perceived loudness. Sample peak is not true peak.” |
| 44–61 s | Tab to an enabled effect control; use its keyboard interaction to adjust it. Show the refreshed summary. | “Controls support keyboard interaction. When the selection or processing changes, the summary updates. Missing or stale evidence is stated explicitly instead of becoming a guessed value.” |
| 61–78 s | Use the speech branch established during preflight: Read summary aloud, then Stop reading; or show the real unavailable message. | Available: “Speech starts only when I request it, using a local system voice. I can stop it.” Unavailable: “This machine has no eligible local voice available to this view. The text remains usable; the interface explains the limitation.” |
| 78–90 s | End on build identity and limitations caption. | “Automated checks cover summary data and speech routing. Human screen-reader testing, audible speech, and accessibility studies remain separate work. No haptic integration is claimed.” |

Choose the speech branch from the actual machine state. Automated speech checks use a deterministic double. A successful rehearsal is one machine observation, not accessibility qualification. Do not claim OHLA compatibility or benefit to a disability group without user evidence.

## Optional assistant segment for a longer walkthrough

Ask “reduce the level by 3 dB,” preview, explicitly apply, then undo. Label it **offline rules baseline; no model call**. Do not describe it as model reasoning or broad tonal understanding. Automatic compression has narrower starting-state/evidence requirements than manual DSP control and is unnecessary for these 90-second cuts.
