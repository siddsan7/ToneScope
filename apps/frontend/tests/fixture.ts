// Browser-only integration fixture. Synthetic traces and a protocol double are
// intentionally excluded from the production entry point and native resources.
const controls = [
  ["inputDb", "Input", -24, 24, 0, "dB"],
  ["thresholdDb", "Threshold", -60, 0, -18, "dBFS"],
  ["ratio", "Ratio", 1, 20, 4, ":1"],
  ["attackMs", "Attack", 0.1, 100, 10, "ms"],
  ["releaseMs", "Release", 10, 2000, 150, "ms"],
  ["kneeDb", "Knee", 0, 24, 6, "dB"],
  ["makeupDb", "Makeup", -24, 24, 0, "dB"],
  ["lowDb", "Low shelf", -18, 18, 0, "dB"],
  ["midDb", "Mid gain", -18, 18, 0, "dB"],
  ["midHz", "Mid frequency", 20, 20000, 1000, "Hz"],
  ["midQ", "Mid Q", 0.2, 10, 0.707, ""],
  ["highDb", "High shelf", -18, 18, 0, "dB"],
  ["driveDb", "Drive", 0, 36, 6, "dB"],
  ["toneHz", "Tone", 20, 20000, 5000, "Hz"],
  ["outputDb", "Output", -24, 24, 0, "dB"],
  ["crossoverLowHz", "Low crossover", 40, 1000, 200, "Hz"],
  ["crossoverHighHz", "High crossover", 500, 10000, 2000, "Hz"],
].map(([key, label, min, max, value, unit]) => ({
  key,
  label,
  min,
  max,
  value,
  unit,
}));
const model: any = {
  version: 1,
  revision: 2,
  renderedRevision: 2,
  source: "Synthetic guitar pluck · BROWSER TEST FIXTURE",
  duration: 2,
  sampleRate: 48000,
  channels: 2,
  status:
    "TEST FIXTURE — No device, audio engine, file export or model qualification.",
  metrics:
    "Selected RMS | dry −24.2 dBFS | wet −21.1 dBFS | frozen match −3.1 dB | delay 0 samples",
  playing: false,
  monitoring: false,
  recording: false,
  looping: false,
  matching: false,
  busy: false,
  ready: true,
  mode: 2,
  order: 1,
  stages: [false, false, true],
  position: 0.25,
  selection: [0.1, 0.8],
  controls,
  oversampling: 1,
  multiband: false,
  band: 0,
  latency: 0,
  dryPeaks: [],
  wetPeaks: [],
  drySpectrum: [],
  wetSpectrum: [],
  dryEnvelope: [],
  wetEnvelope: [],
  assistant: {
    status: "idle",
    message: "Deterministic browser test fixture. No provider connected.",
  },
};
for (let i = 0; i < 1024; i++) {
  const t = (i / 1024) * 2,
    envelope = Math.exp(-3.5 * (t % 0.5));
  model.dryPeaks.push(0.55 * envelope * Math.abs(Math.sin(t * 330)));
  model.wetPeaks.push(0.7 * envelope * Math.abs(Math.sin(t * 330)));
}
for (let i = 0; i < 256; i++) {
  model.drySpectrum.push(-80 + 52 * Math.exp(-(((i - 65) / 35) ** 2)));
  model.wetSpectrum.push(-80 + 54 * Math.exp(-(((i - 70) / 37) ** 2)));
  model.dryEnvelope.push(-25 - 12 * Math.abs(Math.sin(i / 30)));
  model.wetEnvelope.push(-21 - 10 * Math.abs(Math.sin(i / 30)));
}
const listeners = new Map<string, (data: any) => void>();
(window as any).__JUCE__ = {
  backend: {
    addEventListener: (event: string, fn: (data: any) => void) =>
      listeners.set(event, fn),
    emitEvent: (_event: string, payload: any) => {
      const p = payload.params[0],
        action = p.action;
      if (action === "parameter") {
        const c = model.controls.find((c: any) => c.key === p.key);
        if (c) c.value = p.value;
        model.revision++;
      } else if (action === "stage") model.stages[p.index] = p.value;
      else if (action === "play") model.playing = !model.playing;
      else if (action === "pause") model.playing = false;
      else if (action === "rewind") model.position = model.selection[0];
      else if (action === "quality") model.oversampling = p.value;
      else if (action === "band") model.band = p.value;
      else if (action === "selection") model.selection = [p.from, p.to];
      else if (action === "seek") model.position = p.value;
      else if (action === "multiband") model.multiband = p.value;
      else if (action === "mode" || action === "order") model[action] = p.value;
      else if (action === "loop") model.looping = p.value;
      else if (action === "match") model.matching = p.value;
      else if (action === "assistant.ask")
        model.assistant = {
          status: "ready",
          message: "Browser test proposal",
          proposal: {
            id: "test-only",
            summary: "Soften the upper mids",
            predicted: "Less edge around 3 kHz.",
            measured: "",
            sourceRevision: model.revision,
            previewReady: false,
          },
        };
      else if (action === "assistant.preview") {
        model.assistant.proposal.previewReady = true;
        model.assistant.proposal.measured =
          "Synthetic fixture result — no audio engine measurement.";
      } else if (action === "assistant.dismiss")
        model.assistant = { status: "idle" };
      model.renderedRevision = model.revision;
      queueMicrotask(() =>
        listeners.get("__juce__complete")?.({
          promiseId: payload.resultId,
          result: structuredClone(model),
        }),
      );
    },
  },
};
await import("../src/main");
export {};
