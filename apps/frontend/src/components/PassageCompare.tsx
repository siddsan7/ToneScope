import { Button } from "./ui/button";
import type { Snapshot, PassageSignal } from "../bridge";

type Props = { model: Snapshot | null; send: (action: string) => Promise<void> };
const number = (value: number | undefined, unit: string) => value === undefined ? "Unavailable" : `${value.toFixed(2)} ${unit}`;
export function PassageCompare({ model, send }: Props) {
  const state = model?.microscope;
  const mark = (name: "soft" | "hard") => {
    const selection = state?.[name];
    return selection ? `${(selection[0] / model!.sampleRate).toFixed(2)}–${(selection[1] / model!.sampleRate).toFixed(2)} s` : "Not marked";
  };
  const metrics = state?.current && state.measurements?.valid ? state.measurements : undefined;
  const row = (label: string, key: keyof PassageSignal, unit: string) => (
    <tr key={key}><th scope="row">{label}</th>{[metrics?.soft.dry, metrics?.soft.wet, metrics?.hard.dry, metrics?.hard.wet].map((value, i) => <td key={i}>{number(value?.[key], unit)}</td>)}</tr>
  );
  return <section className="passage-compare" aria-label="Manual passage dynamics comparison">
    <h3>How does your playing change the tone?</h3>
    <p className="secondary">Choose two passages and label them. Compare measured levels and the shape of their envelopes.</p>
    <div className="passage-actions">
      <Button variant="outline" disabled={!model?.ready} onClick={() => send("microscope.soft")}>Mark selection as soft</Button>
      <span>Soft: {mark("soft")}</span>
      <Button variant="outline" disabled={!model?.ready} onClick={() => send("microscope.hard")}>Mark selection as hard</Button>
      <span>Hard: {mark("hard")}</span>
      <Button variant="ghost" onClick={() => send("microscope.clear")}>Clear marks</Button>
    </div>
    {metrics && <div className="passage-table"><table>
      <caption>Current settings · raw branch measurements</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">Soft dry</th><th scope="col">Soft processed</th><th scope="col">Hard dry</th><th scope="col">Hard processed</th></tr></thead>
      <tbody>{row("RMS", "rmsDbfs", "dBFS")}{row("Sample peak", "peakDbfs", "dBFS")}{row("Crest factor", "crestDb", "dB")}{row("Envelope rise, 10–90%", "riseMs", "ms")}{row("Envelope decay, 90–10%", "decayMs", "ms")}</tbody>
    </table><p>Hard-to-soft RMS contrast: dry {number(metrics.dryContrastDb, "dB")} · processed {number(metrics.wetContrastDb, "dB")} · change {number(metrics.contrastChangeDb, "dB")}.</p></div>}
    <p className="secondary" role="status">{state?.message ?? "Mark a soft passage and a hard passage to begin."}</p>
  </section>;
}
