# 80-second walkthrough script

This is a recording plan. A narrated video has not been recorded. Rehearse with the actual desktop build, use the generated licensed examples, and record its build identity. Show captions and keep playback at a comfortable level.

| Time | Screen and action | Narration |
|---|---|---|
| 0–10 s | Open a Guitar-TECHS DI WAV. Show its source and selected passage. | “ToneScope is a guitar-effects workbench. It connects a sound change to the measurements and settings that produced it.” |
| 10–23 s | Play a short dry selection. Enable the compressor with the showcase settings. Play the processed selection. | “Here is the dry input. This is a stereo-linked RMS compressor. Both channels share one reduction value, so the control signal does not move the stereo image.” |
| 23–38 s | Freeze RMS match. Switch dry/processed on the same passage. Show the displayed match gain. | “A louder result can seem better. I freeze RMS match before comparing. That controls average signal energy; it does not claim equal perceived loudness.” |
| 38–51 s | Show actual gain reduction and the static/timing plots. | “The engine reports actual gain reduction. Independent curve and timing references check the result. The detector and attack/release stages have distinct roles.” |
| 51–65 s | Bypass the compressor. Select the drive excerpt and enable drive at 18 dB, 5 kHz tone, and 4x oversampling. Show the oversampling plot. | “The drive has one, two, and four-times modes. These periodic tests compare them with a converged reference. They measure this defined test, not every possible guitar sound.” |
| 65–80 s | Show undo, then the generated page's report and attribution links. | “Changes remain reviewable and undoable. The report records the exact binary, source hashes, settings, and attribution. Hardware, listening, and live-model qualification are separate work.” |

Use the stateful-Faust wording only after the migration binary passes its gates and the showcase has been regenerated. In that recording, add: “Faust owns the compressor's detector and gain state; C++ validates controls and hosts the graph.” Keep the final recording between 60 and 90 seconds by trimming pauses rather than speeding up speech.
