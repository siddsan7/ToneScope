# Decisions

The implementation specification is preserved in `../memory/implementation-plan.md`. These decisions describe the current development build; proposed features are not shipped claims.

1. Native C++20/JUCE Windows x64 app, independent headless C++ engine. JUCE exact revision and license inventory recorded in `dependencies.lock.json`. Distribution licensing route remains unselected; no public release is authorized by a development build.
2. Faust 2.88.0 ahead-of-time generated waveshaper, source and generated hashes tracked. Other native filters/dynamics must be described as authored C++, until converted and verified. 1x drive is an explicit development limitation; oversampling qualification cannot pass without reference sweeps.
3. Single processing-thread writer for DSP state. UI publishes fixed parameter snapshots; full offline renders carry revisions. Callback never performs file reads/render jobs or model calls. Device monitoring requires explicit enablement.
4. Float32 analytical samples; RMS matching freezes selected-region gain at +/-12 dB. Residual is wet minus dry, optionally matched; never label it distortion only. Analytical signal and monitoring guard are separate.
5. The initial integrated build may use explicitly bounded in-memory files/captures. This does not satisfy the specification's two-hour streaming requirement. Reject unsupported resources with actionable errors.
6. Offline operation is mandatory. D3 is separately gated and cannot silently send recordings or apply model changes. No live provider calls without opt-in and configured budget.
7. Durable memory preserves full specifications/reference/version records. `delivery/brain.md` holds current work and next actions only. Task prompts point to exact contracts/sections and assigned paths. Worktrees isolate concurrent writers; agent review is separate from human/hardware qualification.
