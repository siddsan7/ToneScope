# Security and privacy

Audio stays local. No account, telemetry upload, cloud audio processing or runtime DSP compilation is needed. Session and WAV parsing must validate bounds before allocation. Float ingress clamps the declared +/-16 domain and counts invalid samples. Audio callbacks cannot execute tools, disk IO, networking or model inference.

Please report security issues privately to the repository owner. Do not attach private recordings, credentials, absolute source paths or unredacted diagnostics to public reports. The optional assistant must use opaque authorized handles, strict closed schemas and revision-checked preview/apply/undo. Never treat metadata as instructions.
