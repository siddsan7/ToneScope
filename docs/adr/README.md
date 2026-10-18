# Decisions

The implementation specification is preserved in `../memory/implementation-plan.md`. These decisions describe the current development build; proposed features are not shipped claims.

1. Native C++20/JUCE Windows x64 app, independent headless C++ engine. JUCE exact revision and license inventory recorded in `dependencies.lock.json`. Distribution licensing route remains unselected; no public release is authorized by a development build.
2. Faust2.88.0 generated compressor, EQ coefficient/biquad and tanh kernels execute in the engine. Host C++ owns smoothing, scheduling, crossovers, FIR resampling and surrounding drive filters. 1x/2x/4x drive is checked against converged independent periodic alias references; musical and device qualification remain separate.
3. Single processing-thread writer for DSP state. UI publishes fixed parameter snapshots; full offline renders carry revisions. Callback never performs file reads/render jobs or model calls. Device monitoring requires explicit enablement.
4. Float32 analytical samples; RMS matching freezes selected-region gain at +/-12 dB. Residual is wet minus dry, optionally matched; never label it distortion only. Analytical signal and monitoring guard are separate.
5. WAV source metadata/render/export streams support 2 GiB/two hours. Desktop inspection is capped at ten seconds/1,048,576 frames with exact processing history; replay uses a bounded worker-resampled ring. Eager standalone analysis remains limited to256 MiB. Unsupported resources are rejected explicitly.
6. Offline operation is mandatory. D3 is separately gated and cannot silently send recordings or apply model changes. No live provider calls without opt-in and configured budget.
7. Durable memory preserves full specifications/reference/version records. `delivery/brain.md` holds current work and next actions only. Task prompts point to exact contracts/sections and assigned paths. Worktrees isolate concurrent writers; agent review is separate from human/hardware qualification.
