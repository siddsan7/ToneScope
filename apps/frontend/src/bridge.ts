export type Control = {
  key: string;
  label: string;
  min: number;
  max: number;
  value: number;
  unit: string;
};
export type AssistantState = {
  status: "unavailable" | "idle" | "running" | "ready" | "error";
  message?: string;
  requestId?: string;
  auditioning?: boolean;
  auditionSource?: "baseline" | "candidate";
  matched?: boolean;
  matchGainDb?: number;
  capped?: boolean;
  proposal?: {
    id: string;
    summary: string;
    predicted: string;
    measured: string;
    sourceRevision: number;
    previewReady: boolean;
  };
};
export type Snapshot = {
  streamedSource?: boolean;
  sourceFrames?: number;
  inspectionOffset?: number;
  inspectionEnd?: number;
  gainReductionHistory?: number[];
  bandGainReductionHistory?: number[][];
  microscope?: {
    soft?: number[];
    hard?: number[];
    current: boolean;
    message: string;
    measurements?: {
      valid: boolean;
      soft: PassageMetrics;
      hard: PassageMetrics;
      dryContrastDb?: number;
      wetContrastDb?: number;
      contrastChangeDb?: number;
    };
  };
  canUndo?: boolean;
  canRedo?: boolean;
  captureFinalizing?: boolean;
  assistant?: AssistantState;
  latency: number;
  oversampling: number;
  multiband: boolean;
  band: number;
  dryEnvelope: number[];
  wetEnvelope: number[];
  version: 1;
  revision: number;
  renderedRevision: number;
  source: string;
  duration: number;
  sampleRate: number;
  channels: number;
  status: string;
  metrics: string;
  playing: boolean;
  monitoring: boolean;
  recording: boolean;
  looping: boolean;
  matching: boolean;
  busy: boolean;
  ready: boolean;
  mode: number;
  order: number;
  stages: boolean[];
  position: number;
  selection: number[];
  controls: Control[];
  dryPeaks: number[];
  wetPeaks: number[];
  drySpectrum: number[];
  wetSpectrum: number[];
};
export type PassageSignal = { rmsDbfs: number; peakDbfs: number; crestDb?: number; riseMs?: number; decayMs?: number };
export type PassageMetrics = { dry: PassageSignal; wet: PassageSignal; changeDb?: number };
type Backend = {
  addEventListener: (event: string, fn: (data: any) => void) => number;
  emitEvent: (event: string, data: unknown) => void;
};
declare global {
  interface Window {
    __JUCE__?: { backend: Backend };
  }
}
let nextId = 0;
const waiting = new Map<
  number,
  {
    resolve: (v: Snapshot) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
window.__JUCE__?.backend.addEventListener(
  "__juce__complete",
  ({ promiseId, result }) => {
    const p = waiting.get(promiseId);
    if (p) {
      clearTimeout(p.timer);
      waiting.delete(promiseId);
      p.resolve(result);
    }
  },
);
export const connected = !!window.__JUCE__;
export function command(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Snapshot> {
  if (!window.__JUCE__)
    return Promise.reject(
      new Error("Open ToneScope desktop to connect the audio engine."),
    );
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("Audio engine did not respond."));
    }, 8000);
    waiting.set(id, { resolve, reject, timer });
    window.__JUCE__!.backend.emitEvent("__juce__invoke", {
      name: "tonescopeCommand",
      params: [{ version: 1, action, ...payload }],
      resultId: id,
    });
  });
}
export function wavePath(values: number[], height = 170) {
  if (!values.length) return "";
  const points = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * 1000,
    height / 2 - Math.min(1, Math.abs(v)) * height * 0.46,
  ]);
  return (
    "M" +
    points.map((p) => p.join(",")).join(" L") +
    " L" +
    [...points]
      .reverse()
      .map(([x, y]) => [x, height - y].join(","))
      .join(" L") +
    " Z"
  );
}
export function spectrumPath(values: number[]) {
  return values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(i / Math.max(1, values.length - 1)) * 1000},${180 - Math.max(0, Math.min(100, v + 100)) * 1.8}`,
    )
    .join(" ");
}
