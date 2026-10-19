import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "./bridge";
import { selectionSummary } from "./selection-summary";
import { summarySpeech, localSummaryVoice, type SpeechHost } from "./summary-speech";

const fixture = () => ({revision: 3, renderedRevision: 3, ready: true, busy: false, source: "measured.wav", sourceFrames: 48000, sampleRate: 48000, channels: 2, selection: [.1, .9], latency: 0, band: 0,
  selectionSummary: {revision: 3, selectionSamples: [4800, 43200], band: 0, available: true, reason: "", dryRms: .1, wetRms: .05, wetPeak: .2}} as Snapshot);
const row = (state: Snapshot | null, label: string, error = false) => selectionSummary(state, error).rows.find(r => r.label === label)!.value;

describe("measured selection summary", () => {
  it("uses calibrated native scalars and explicit units", () => {
    const state = fixture();
    expect(row(state, "Selection")).toBe("0.10 to 0.90 seconds");
    expect(row(state, "Dry reference RMS")).toBe("-20.0 dBFS");
    expect(row(state, "Processed RMS")).toBe("-26.0 dBFS");
    expect(row(state, "Processed sample peak")).toBe("-14.0 dBFS");
    expect(row(state, "RMS level change")).toBe("-6.0 dB");
    expect(selectionSummary(state).text).toContain("not perceived loudness");
  });
  it("does not parse plausible formatted status text or infer measurements from traces", () => {
    const state = fixture(); delete state.selectionSummary;
    state.metrics = "RMS -18 dBFS"; state.wetPeaks = [.5];
    expect(row(state, "Processed RMS")).toContain("Unavailable");
  });
  it("explains disconnected, missing, pending, stale and live states", () => {
    expect(selectionSummary(null).text).toContain("open ToneScope");
    for (const change of [{busy: true}, {revision: 4}, {ready: false}, {monitoring: true}, {recording: true}]) {
      expect(row({...fixture(), ...change}, "Processed RMS")).toContain("Unavailable");
    }
    expect(row(fixture(), "Processed RMS", true)).toContain("did not respond");
  });
  it("rejects mismatched interval, evidence revision and band", () => {
    for (const change of [{revision: 2}, {band: 1}, {selectionSamples: [4801, 43200]}, {selectionSamples: [4800]}]) {
      const state = fixture(); Object.assign(state.selectionSummary!, change);
      expect(row(state, "Processed RMS")).toContain("Unavailable");
    }
  });
  it("distinguishes a pending render from an unavailable or failed render", () => {
    expect(row({...fixture(), busy: true}, "Processed RMS")).toContain("wait");
    expect(row({...fixture(), ready: false, busy: false}, "Processed RMS")).toContain("adjust the selection or settings");
  });
  it("labels aligned latency-tail exclusion at source end", () => {
    const state = fixture(); state.selection = [.1, 1]; state.latency = 32; state.selectionSummary!.selectionSamples = [4800, 47968];
    expect(row(state, "Processed RMS")).toBe("-26.0 dBFS");
    expect(row(state, "Measured interval")).toContain("latency tail excluded");
    expect(row(state, "Alignment delay")).toBe("32 samples");
  });
  it("has no invented decibel floor and rejects invalid values", () => {
    for (const v of [0, 1e-12, NaN, Infinity, -1, null]) {
      const state = fixture(); state.selectionSummary!.wetRms = v;
      expect(row(state, "Processed RMS")).toContain("Unavailable");
      expect(row(state, "RMS level change")).toContain("Unavailable");
      expect(selectionSummary(state).text).not.toMatch(/NaN|Infinity|-240/);
    }
  });
  it("does not reuse baseline scalar measurements during assistant audition", () => {
    const state = fixture(); state.assistant = {status: "ready", auditioning: true};
    expect(row(state, "Processed RMS")).toContain("dismiss the assistant preview");
  });
  it("reports only current full-range, disjoint, contained manual contrast", () => {
    const state = fixture(); state.microscope = {current: true, message: "", soft: [5000, 15000], hard: [25000, 35000], measurements: {valid: true, wetContrastDb: 8.25} as NonNullable<Snapshot["microscope"]>["measurements"]};
    expect(row(state, "Manual hard-to-soft RMS contrast")).toBe("8.3 dB");
    state.microscope.current = false; expect(row(state, "Manual hard-to-soft RMS contrast")).toContain("Unavailable");
    state.microscope.current = true; state.microscope.soft = [0, 15000]; expect(row(state, "Manual hard-to-soft RMS contrast")).toContain("inside this selection");
  });
  it("keeps speech identity stable through ordinary playhead polls", () => {
    expect(selectionSummary({...fixture(), position: .2}).key).toBe(selectionSummary({...fixture(), position: .3}).key);
    expect(selectionSummary({...fixture(), revision: 4}).key).not.toBe(selectionSummary(fixture()).key);
  });
});

const voice = (local = true, lang = "en-US") => ({localService: local, lang, default: true} as SpeechSynthesisVoice);
function platform(voices = [voice()]) {
  const speak = vi.fn(), cancel = vi.fn(), notify = vi.fn();
  const host: SpeechHost = {synthesis: {getVoices: () => voices, speak, cancel}, utterance: text => ({text} as SpeechSynthesisUtterance)};
  return {host, speak, cancel, notify, controller: summarySpeech(host, notify)};
}
describe("explicit local summary speech", () => {
  it("does nothing until the user requests reading and selects only local English", () => {
    const p = platform([voice(false), voice(true, "fr-FR"), voice()]);
    expect(p.speak).not.toHaveBeenCalled();
    p.controller.read("RMS: -20 dBFS.");
    const spoken = p.speak.mock.calls[0][0];
    expect(spoken.voice.localService).toBe(true); expect(spoken.lang).toBe("en-US");
    expect(spoken.text).toContain("decibels relative to full scale");
  });
  it("never falls back to remote or unknown-locality voices", () => {
    const p = platform([voice(false), {lang: "en-US", default: true} as SpeechSynthesisVoice]);
    p.controller.read("Summary"); expect(p.speak).not.toHaveBeenCalled();
    expect(p.notify.mock.calls[0][0]).toContain("unavailable");
    expect(localSummaryVoice(undefined)).toBeUndefined();
  });
  it("cancels owned speech and ignores late callbacks after replacement", () => {
    const p = platform(); p.controller.read("First"); const first = p.speak.mock.calls[0][0]; const late = first.onend;
    p.controller.read("Second"); expect(p.cancel).toHaveBeenCalledTimes(1);
    late(); expect(p.notify.mock.lastCall?.[1]).toBe(true);
    p.controller.stop("Changed."); expect(p.cancel).toHaveBeenCalledTimes(2); expect(p.notify.mock.lastCall).toEqual(["Changed.", false]);
    p.controller.stop(); expect(p.cancel).toHaveBeenCalledTimes(2);
  });
  it("reports completion and platform errors without losing text", () => {
    const p = platform(); p.controller.read("Summary"); p.speak.mock.calls[0][0].onend();
    expect(p.notify.mock.lastCall).toEqual(["Reading finished.", false]);
    p.controller.read("Summary"); p.speak.mock.lastCall![0].onerror(); expect(p.notify.mock.lastCall?.[0]).toContain("text summary remains available");
    p.speak.mockImplementation(() => {throw Error("platform");}); p.controller.read("Summary"); expect(p.notify.mock.lastCall?.[0]).toContain("speech service failed");
  });
  it("handles missing API and oversized text without queueing anything", () => {
    const notify = vi.fn(); summarySpeech(undefined, notify).read("Summary"); expect(notify.mock.lastCall?.[1]).toBe(false);
    const p = platform(); p.controller.read("x".repeat(2401)); expect(p.speak).not.toHaveBeenCalled();
  });
  it("keeps Stop available and refuses a replacement if cancellation fails", () => {
    const p = platform(); p.controller.read("First"); p.cancel.mockImplementation(() => {throw Error("platform");});
    p.controller.read("Second"); expect(p.speak).toHaveBeenCalledTimes(1); expect(p.notify.mock.lastCall?.[1]).toBe(true);
    p.cancel.mockReset(); p.controller.stop(); expect(p.notify.mock.lastCall?.[1]).toBe(false);
  });
  it("keeps Stop available if both speak and cancellation fail", () => {
    const p = platform(); p.speak.mockImplementation(() => {throw Error("speak");}); p.cancel.mockImplementation(() => {throw Error("cancel");});
    p.controller.read("Summary"); expect(p.notify.mock.lastCall?.[1]).toBe(true);
  });
});
