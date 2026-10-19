export type SpeechHost = { synthesis: Pick<SpeechSynthesis, "getVoices" | "speak" | "cancel">; utterance: (text: string) => SpeechSynthesisUtterance };

export function localSummaryVoice(host?: SpeechHost) {
  if (!host) return undefined;
  return host.synthesis.getVoices().find(v => v.localService === true && /^en(?:-|$)/i.test(v.lang) && v.default)
    ?? host.synthesis.getVoices().find(v => v.localService === true && /^en(?:-|$)/i.test(v.lang));
}

export function summarySpeech(host: SpeechHost | undefined, notify: (message: string, active: boolean) => void) {
  let owned: SpeechSynthesisUtterance | undefined;
  const stop = (message = "Reading stopped.") => {
    if (!owned) return;
    const item = owned, end = item.onend, error = item.onerror;
    item.onend = item.onerror = null;
    try { host?.synthesis.cancel(); } catch { item.onend = end; item.onerror = error; notify("Could not stop reading. Try Stop reading again or use system speech controls.", true); return; }
    owned = undefined;
    notify(message, false);
  };
  return {
    stop,
    read(text: string) {
      stop();
      if (owned) return; // Do not queue another utterance if platform cancellation failed.
      try {
        const voice = localSummaryVoice(host);
        if (!host || !voice) { notify("Read aloud unavailable: no local English voice is available. The text summary remains available.", false); return; }
        if (!text || text.length > 2400) { notify("Read aloud unavailable: the summary is too long. Read the text summary instead.", false); return; }
        const item = host.utterance(text.replace(/dBFS/g, "decibels relative to full scale").replace(/\bdB\b/g, "decibels"));
        item.voice = voice; item.lang = voice.lang; item.rate = 1;
        item.onend = () => { if (owned === item) { owned = undefined; notify("Reading finished.", false); } };
        item.onerror = () => { if (owned === item) { owned = undefined; notify("Read aloud failed. The text summary remains available.", false); } };
        owned = item;
        host.synthesis.speak(item);
        if (owned === item) notify("Reading selection summary.", true);
      } catch { stop(); if (!owned) notify("Read aloud unavailable: the speech service failed. The text summary remains available.", false); }
    },
  };
}
