import type { Snapshot } from "./bridge";

export type SelectionSummary = { key: string; scope: string; rows: {label: string; value: string}[]; text: string };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unavailable = (reason: string) => `Unavailable: ${reason}`;
const db = (value: unknown) => finite(value) && value >= 0 ? value < 1e-9 ? unavailable("silent or below the measurement floor") : `${(20 * Math.log10(value)).toFixed(1)} dBFS` : unavailable("no valid measurement");

export function selectionSummary(model: Snapshot | null, transportError = false): SelectionSummary {
  const rate = model?.sampleRate, frames = model?.sourceFrames;
  const selection = model?.selection;
  const validRange = finite(rate) && rate > 0 && finite(frames) && Number.isSafeInteger(frames) && frames > 0 && selection?.length === 2 && selection.every(finite) && selection[0] >= 0 && selection[1] <= 1 && selection[1] > selection[0];
  const start = validRange ? Math.trunc(selection[0] * frames) : 0;
  const requestedEnd = validRange ? Math.trunc(selection[1] * frames) : 0;
  const measuredEnd = validRange && finite(model?.latency) && Number.isSafeInteger(model.latency) && model.latency >= 0 ? Math.min(requestedEnd, frames - model.latency) : 0;
  const evidence = model?.selectionSummary;
  let reason = transportError ? "the audio engine did not respond" : !model ? "open ToneScope desktop to connect" : !validRange ? "load audio and select a valid interval" : model.monitoring || model.recording ? "stop live audio to inspect a recorded selection" : model.assistant?.auditioning ? "dismiss the assistant preview to summarize current settings" : model.busy ? "wait for the current render" : !model.ready || model.revision !== model.renderedRevision ? "no current render; adjust the selection or settings to retry" : "";
  if (!reason && (!evidence || evidence.available !== true || evidence.revision !== model?.revision || evidence.band !== model?.band || evidence.selectionSamples?.length !== 2 || evidence.selectionSamples[0] !== start || evidence.selectionSamples[1] !== measuredEnd || measuredEnd - start < 2)) reason = evidence?.reason === "measurement_unavailable" ? "silent or insufficient aligned audio" : "current selection measurements are not available";
  const range = validRange ? `${(start / rate).toFixed(2)} to ${(requestedEnd / rate).toFixed(2)} seconds` : unavailable("no valid selection");
  const bands = ["Full range", "Low band", "Mid band", "High band"];
  const scope = `${bands[model?.band ?? 0] ?? "Unknown band"} comparison before audition RMS matching.`;
  const dry = reason ? unavailable(reason) : db(evidence?.dryRms), wet = reason ? unavailable(reason) : db(evidence?.wetRms);
  const change = !reason && finite(evidence?.dryRms) && finite(evidence?.wetRms) && evidence.dryRms >= 1e-9 && evidence.wetRms >= 1e-9 ? `${(20 * Math.log10(evidence.wetRms / evidence.dryRms)).toFixed(1)} dB` : unavailable(reason || "both branches need measurable energy");
  const marks = model?.microscope, passages = marks?.measurements;
  const inside = (v?: number[]) => !!v && v.length === 2 && v.every(n => finite(n) && Number.isSafeInteger(n)) && v[0] >= start && v[1] <= measuredEnd && v[1] - v[0] >= 2;
  const marked = inside(marks?.soft) && inside(marks?.hard) && (marks!.soft![1] <= marks!.hard![0] || marks!.hard![1] <= marks!.soft![0]);
  const contrast = !reason && model?.band === 0 && marked && marks?.current && passages?.valid && finite(passages.wetContrastDb) ? `${passages.wetContrastDb.toFixed(1)} dB` : unavailable(reason || (model?.band !== 0 ? "use Full range for manual passage evidence" : !marked ? "mark disjoint soft and hard passages inside this selection" : "manual passage measurements are not current or have insufficient energy"));
  const rows = [{label: "Selection", value: range}, {label: "Measured interval", value: reason ? unavailable(reason) : `${(start / rate!).toFixed(2)} to ${(measuredEnd / rate!).toFixed(2)} seconds; latency tail excluded`},
    {label: "Dry reference RMS", value: dry}, {label: "Processed RMS", value: wet}, {label: "Processed sample peak", value: reason ? unavailable(reason) : db(evidence?.wetPeak)},
    {label: "RMS level change", value: change}, {label: "Alignment delay", value: reason ? unavailable(reason) : `${model!.latency} samples`}, {label: "Manual hard-to-soft RMS contrast", value: contrast}];
  const text = ["Selection summary.", scope, ...rows.map(r => `${r.label}: ${r.value}.`), "RMS measures signal level, not perceived loudness. Sample peak is not true peak."].join(" ");
  // Do not key speech to playhead position or object identity: polls must not restart it.
  return {key: JSON.stringify([model?.revision, model?.source, model?.selection, model?.band, text]), scope, rows, text};
}
