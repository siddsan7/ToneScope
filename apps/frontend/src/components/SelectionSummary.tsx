import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "../bridge";
import { selectionSummary } from "../selection-summary";
import { localSummaryVoice, summarySpeech, type SpeechHost } from "../summary-speech";
import { Button } from "./ui/button";

export function SelectionSummary({model, transportError = false}: {model: Snapshot | null; transportError?: boolean}) {
  const summary = selectionSummary(model, transportError);
  const [active, setActive] = useState(false), [status, setStatus] = useState("");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const host = useMemo<SpeechHost | undefined>(() => typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance === "function"
    ? {synthesis: window.speechSynthesis, utterance: text => new window.SpeechSynthesisUtterance(text)} : undefined, []);
  const speech = useMemo(() => summarySpeech(host, (message, reading) => {setStatus(message); setActive(reading);}), [host]);
  const blocked = !!(model?.playing || model?.recording || model?.monitoring);
  useEffect(() => {
    const update = () => { try { const available = !!localSummaryVoice(host); setVoiceAvailable(available); if (!available) speech.stop("Reading stopped: the local voice is no longer available."); } catch {setVoiceAvailable(false); speech.stop("Reading stopped: the speech service is unavailable.");} };
    update();
    window.speechSynthesis?.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", update);
  }, [host, speech]);
  useEffect(() => { speech.stop(blocked ? "Reading stopped because audio is active." : "Reading stopped because the summary changed. Choose Read summary aloud to hear the current selection."); }, [summary.key, blocked, speech]);
  useEffect(() => {
    const hide = () => {if (document.hidden) speech.stop("Reading stopped because the window is hidden.");};
    const leave = () => speech.stop();
    const key = (event: KeyboardEvent) => {if (event.key === "Escape") speech.stop();};
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave); window.addEventListener("blur", leave); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); window.removeEventListener("blur", leave); window.removeEventListener("keydown", key); speech.stop(); };
  }, [speech]);
  const speechHelp = blocked ? "Pause playback and stop recording or monitoring before reading aloud." : !voiceAvailable ? "Read aloud unavailable: no local English voice or speech API is available. The text summary remains available." : "Uses a local system voice. Speech starts only when you choose Read summary aloud.";
  return <section className="selection-summary" aria-labelledby="selection-summary-title">
    <div className="summary-heading"><h3 id="selection-summary-title">Selection summary</h3><div className="summary-actions">
      <Button variant="outline" type="button" disabled={!voiceAvailable || blocked} aria-describedby="summary-speech-help" onClick={() => {if (!document.hidden && !blocked) speech.read(summary.text);}}>Read summary aloud</Button>
      <Button variant="ghost" type="button" disabled={!active} onClick={() => speech.stop()}>Stop reading</Button>
    </div></div>
    <p className="secondary">{summary.scope}</p>
    <dl>{summary.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <p className="secondary">RMS measures signal level, not perceived loudness. Sample peak is not true peak.</p>
    <p id="summary-speech-help" className="secondary">{speechHelp}</p>
    <p role="status" aria-live="polite" aria-atomic="true" className="speech-status">{status}</p>
  </section>;
}
