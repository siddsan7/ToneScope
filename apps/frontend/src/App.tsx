import { useCallback, useEffect, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import {
  AudioLines,
  ArrowUpFromLine,
  FolderOpen,
  Save,
  Download,
  Settings2,
  Play,
  Pause,
  RotateCcw,
  Mic,
  Disc3,
  SlidersHorizontal,
  Waves,
  Activity,
  ChevronRight,
  Headphones,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Slider } from "./components/ui/slider";
import { Switch } from "./components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import {
  command,
  connected,
  wavePath,
  spectrumPath,
  type Snapshot,
  type Control,
} from "./bridge";
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(2).padStart(5, "0")}`;
function Numeric({
  control,
  onChange,
}: {
  control: Control;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(control.value));
  useEffect(
    () => setDraft(String(Number(control.value.toFixed(2)))),
    [control.value],
  );
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v) && v >= control.min && v <= control.max) onChange(v);
    else setDraft(String(control.value));
  };
  return (
    <div className="parameter">
      <label htmlFor={control.key}>{control.label}</label>
      <div className="numeric">
        <input
          id={control.key}
          type="number"
          min={control.min}
          max={control.max}
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(String(control.value));
          }}
        />
        <span>{control.unit}</span>
      </div>
      <Slider
        aria-label={control.label}
        min={control.min}
        max={control.max}
        step={0.01}
        value={[control.value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
export default function App() {
  const [model, setModel] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [panel, setPanel] = useState("chain"),
    [analysis, setAnalysis] = useState("spectrum"),
    [prompt, setPrompt] = useState("");
  const send = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      try {
        const value = await command(action, payload);
        setModel(value);
        setError("");
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );
  useEffect(() => {
    if (!connected) return;
    let alive = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const s = await command("snapshot");
        if (alive) setModel(s);
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 100);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[role="slider"],[role="switch"],button',
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void send("play");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        void send("import");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void send("save");
      }
      if (e.key === "Escape") void send("pause");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [send]);
  const controls = model?.controls ?? [],
    sel = model?.selection ?? [0, 1],
    duration = model?.duration ?? 0;
  const change = (c: Control, v: number) =>
    void send("parameter", { key: c.key, value: v });
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
    >
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <span className="brand-symbol">
              <AudioLines size={27} />
            </span>
            <div>
              <h1>ToneScope</h1>
              <span>A closer listen.</span>
            </div>
          </div>
          <div className="file-actions">
            <Button
              variant="outline"
              onClick={() => send("import")}
              disabled={!connected}
            >
              <ArrowUpFromLine />
              Import audio
            </Button>
            <Button
              variant="ghost"
              onClick={() => send("open")}
              disabled={!connected}
              title="Open session"
            >
              <FolderOpen />
              <span>Open</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => send("save")}
              disabled={!model?.ready}
            >
              <Save />
              <span>Save</span>
            </Button>
            <Button
              onClick={() => send("export")}
              disabled={!model?.ready || model?.busy}
            >
              <Download />
              Export WAV
            </Button>
          </div>
        </header>
        <div className="workspace">
          <main>
            <div className="source-title">
              <div>
                <p className="eyebrow">AUDIO MICROSCOPE</p>
                <h2>{model?.source || "Find the detail in your sound."}</h2>
                <p className="secondary">
                  {duration
                    ? `${time(duration)} · ${((model?.sampleRate ?? 0) / 1000).toFixed(1)} kHz · ${model?.channels} channels`
                    : "Import a WAV or capture a live take to start a comparison."}
                </p>
              </div>
              <span className="local">
                <span />
                LOCAL ENGINE
              </span>
            </div>
            <section className="scope-card" aria-label="Audio comparison">
              <div className="scope-heading">
                <div>
                  <Waves size={17} />
                  <h3>Waveform</h3>
                  <span className="scope-note">Drag to select a passage</span>
                </div>
                <div className="legend">
                  <span className="dry">— Dry</span>
                  <span className="wet">— Processed</span>
                </div>
              </div>
              <div
                className="waveform"
                onPointerDown={(e) => {
                  if (!duration) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.dataset.anchor = String(
                    Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                  );
                }}
                onPointerUp={(e) => {
                  const a = Number(e.currentTarget.dataset.anchor);
                  if (!duration || !Number.isFinite(a)) return;
                  const r = e.currentTarget.getBoundingClientRect(),
                    b = Math.max(
                      0,
                      Math.min(1, (e.clientX - r.left) / r.width),
                    );
                  if (Math.abs(a - b) > 0.002)
                    void send("selection", {
                      from: Math.min(a, b),
                      to: Math.max(a, b),
                    });
                }}
              >
                <svg
                  viewBox="0 0 1000 170"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={
                    duration
                      ? "Dry and processed waveform with selected passage"
                      : "No audio loaded"
                  }
                >
                  <defs>
                    <pattern
                      id="grid"
                      width="125"
                      height="42.5"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M125 0H0V42.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth=".7"
                      />
                    </pattern>
                  </defs>
                  <rect width="1000" height="170" fill="url(#grid)" />
                  <path d="M0 85H1000" className="zero" />
                  {duration > 0 && (
                    <>
                      <rect
                        x={sel[0] * 1000}
                        y="0"
                        width={(sel[1] - sel[0]) * 1000}
                        height="170"
                        className="selection"
                      />
                      <path
                        d={wavePath(model?.dryPeaks ?? [])}
                        className="dry-wave"
                      />
                      <path
                        d={wavePath(model?.wetPeaks ?? [])}
                        className="wet-wave"
                      />
                      <line
                        x1={(model?.position ?? 0) * 1000}
                        x2={(model?.position ?? 0) * 1000}
                        y1="0"
                        y2="170"
                        className="playhead"
                      />
                    </>
                  )}
                </svg>
                {!duration && (
                  <div className="empty">
                    <AudioLines size={30} />
                    <p>Your sound, under the microscope.</p>
                    <Button
                      variant="outline"
                      disabled={!connected}
                      onClick={() => send("import")}
                    >
                      Choose a WAV file
                    </Button>
                  </div>
                )}
              </div>
              <div className="axis">
                {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <span key={v}>{time(duration * v)}</span>
                ))}
              </div>
              <div className="seek-row">
                <Slider
                  aria-label="Playback position"
                  min={0}
                  max={1}
                  step={0.0001}
                  disabled={!model?.ready}
                  value={[model?.position ?? 0]}
                  onValueChange={([value]) => send("seek", { value })}
                />
              </div>
              <div className="transport">
                <Button
                  className="play"
                  onClick={() => send("play")}
                  disabled={!model?.ready || model?.monitoring || model?.busy}
                  aria-label={model?.playing ? "Pause" : "Play"}
                >
                  {model?.playing ? <Pause /> : <Play />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Rewind to selection"
                  onClick={() => send("rewind")}
                >
                  <RotateCcw />
                </Button>
                <span className="time">
                  {time((model?.position ?? 0) * duration)}
                  <small> / {time(duration)}</small>
                </span>
                <label className="inline">
                  <Switch
                    checked={model?.looping ?? false}
                    onCheckedChange={(value) => send("loop", { value })}
                  />
                  Loop
                </label>
                <span className="shortcut">
                  SPACE TO {model?.playing ? "PAUSE" : "PLAY"}
                </span>
              </div>
              <div className="scope-heading frequency-heading">
                <div>
                  <Activity size={17} />
                  <h3>Frequency response</h3>
                  <span className="scope-note">
                    Selected passage · stereo energy
                  </span>
                </div>
                <select
                  aria-label="Analysis view"
                  value={analysis}
                  onChange={(e) => setAnalysis(e.target.value)}
                >
                  <option value="spectrum">Spectrum / dBFS</option>
                  <option value="dynamics">Dynamics / dBFS</option>
                </select>
              </div>
              <div className="spectrum">
                <div className="spectrum-scale">
                  <span>0</span>
                  <span>−50</span>
                  <span>−100</span>
                </div>
                <svg
                  viewBox="0 0 1000 180"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Dry and processed frequency spectrum"
                >
                  <path d="M0 0H1000M0 90H1000M0 179H1000" className="zero" />
                  <path
                    d={spectrumPath(
                      (analysis === "spectrum"
                        ? model?.drySpectrum
                        : model?.dryEnvelope) ?? [],
                    )}
                    className="dry-spectrum"
                  />
                  <path
                    d={spectrumPath(
                      (analysis === "spectrum"
                        ? model?.wetSpectrum
                        : model?.wetEnvelope) ?? [],
                    )}
                    className="wet-spectrum"
                  />
                </svg>
              </div>
              <div className="axis frequency-axis">
                {(analysis === "spectrum"
                  ? ["20 Hz", "100", "1k", "10k", "20k"]
                  : [
                      time(0),
                      time(duration * 0.25),
                      time(duration * 0.5),
                      time(duration * 0.75),
                      time(duration),
                    ]
                ).map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            </section>
            <div className="comparison-row">
              <div>
                <p className="eyebrow">LISTEN TO</p>
                <select
                  aria-label="Audition source"
                  value={model?.mode ?? 2}
                  onChange={(e) =>
                    send("mode", { value: Number(e.target.value) })
                  }
                >
                  {[
                    "Dry",
                    "Processed",
                    "Raw residual",
                    "RMS-matched residual",
                  ].map((x, i) => (
                    <option key={x} value={i + 1}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline match">
                <Switch
                  checked={model?.matching ?? false}
                  disabled={!model?.ready}
                  onCheckedChange={(value) => send("match", { value })}
                />
                <span>
                  Freeze RMS match<small>Level matched · ±12 dB cap</small>
                </span>
              </label>
              <div className="selection-inputs">
                <span>SELECTION / SEC</span>
                {[0, 1].map((i) => (
                  <input
                    key={i}
                    aria-label={
                      i ? "Selection end seconds" : "Selection start seconds"
                    }
                    type="number"
                    min={0}
                    max={duration}
                    step={0.01}
                    value={Number((sel[i] * duration).toFixed(2))}
                    onChange={(e) => {
                      const next = [...sel];
                      next[i] = Number(e.target.value) / duration;
                      if (next[0] < next[1])
                        void send("selection", { from: next[0], to: next[1] });
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="audition-band">
              <span>FREQUENCY AUDITION</span>
              <select
                aria-label="Frequency audition"
                value={model?.band ?? 0}
                disabled={!model?.ready || model.monitoring}
                onChange={(e) =>
                  send("band", { value: Number(e.target.value) })
                }
              >
                {["Full range", "Low band", "Mid band", "High band"].map(
                  (name, i) => (
                    <option key={name} value={i}>
                      {name}
                    </option>
                  ),
                )}
              </select>
              <small>Identical filters on both branches</small>
            </div>
            <div className="measurements">
              <Activity size={16} />
              <p>
                {model?.metrics ||
                  "Comparison measurements appear after audio is rendered."}
              </p>
            </div>
          </main>
          <aside>
            <Tabs value={panel} onValueChange={setPanel}>
              <TabsList className="panel-tabs">
                <TabsTrigger value="chain">
                  <SlidersHorizontal size={15} />
                  Signal chain
                </TabsTrigger>
                <TabsTrigger value="assistant">Assistant</TabsTrigger>
              </TabsList>
              <TabsContent value="chain">
                <div className="chain-heading">
                  <h2>Shape. Compare. Hear.</h2>
                  <p>Enable a stage to explore its effect.</p>
                </div>
                <select
                  className="order"
                  aria-label="Processing stage order"
                  value={model?.order ?? 1}
                  onChange={(e) =>
                    send("order", { value: Number(e.target.value) })
                  }
                >
                  {[
                    "Comp → EQ → Drive",
                    "Drive → EQ → Comp",
                    "EQ → Comp → Drive",
                    "Comp → Drive → EQ",
                    "EQ → Drive → Comp",
                    "Drive → Comp → EQ",
                  ].map((x, i) => (
                    <option key={x} value={i + 1}>
                      {x}
                    </option>
                  ))}
                </select>
                <div className="quality-controls">
                  <label>
                    Drive quality
                    <select
                      aria-label="Drive oversampling"
                      value={model?.oversampling ?? 1}
                      disabled={!connected}
                      onChange={(e) =>
                        send("quality", { value: Number(e.target.value) })
                      }
                    >
                      <option value={1}>1� native</option>
                      <option value={2}>2� oversampled</option>
                      <option value={4}>4� oversampled</option>
                    </select>
                  </label>
                  <label className="inline">
                    <Switch
                      aria-label="Three-band compressor"
                      checked={model?.multiband ?? false}
                      disabled={!connected}
                      onCheckedChange={(value) => send("multiband", { value })}
                    />
                    Three-band compressor
                  </label>
                  <p>Changing topology stops live monitoring.</p>
                </div>
                {[
                  {
                    name: "Compressor",
                    detail: "Dynamics & articulation",
                    icon: Activity,
                    indices: model?.multiband
                      ? [1, 2, 3, 4, 5, 6, 15, 16]
                      : [1, 2, 3, 4, 5, 6],
                  },
                  {
                    name: "Tone EQ",
                    detail: "Balance & presence",
                    icon: SlidersHorizontal,
                    indices: [7, 8, 9, 10, 11],
                  },
                  {
                    name: "Overdrive",
                    detail: "Harmonics & character",
                    icon: Waves,
                    indices: [12, 13],
                  },
                ].map((stage, index) => (
                  <motion.section
                    className={
                      "stage " + (model?.stages[index] ? "enabled" : "")
                    }
                    key={stage.name}
                    layout="position"
                  >
                    <div className="stage-heading">
                      <stage.icon size={18} />
                      <div>
                        <h3>{stage.name}</h3>
                        <p>{stage.detail}</p>
                      </div>
                      <Switch
                        aria-label={`${stage.name} enabled`}
                        checked={model?.stages[index] ?? false}
                        disabled={!connected}
                        onCheckedChange={(value) =>
                          send("stage", { index, value })
                        }
                      />
                    </div>
                    <div className="stage-controls">
                      {stage.indices.map(
                        (i) =>
                          controls[i] && (
                            <Numeric
                              key={controls[i].key}
                              control={controls[i]}
                              onChange={(v) => change(controls[i], v)}
                            />
                          ),
                      )}
                    </div>
                  </motion.section>
                ))}
                <div className="gain-controls">
                  {[0, 14].map(
                    (i) =>
                      controls[i] && (
                        <Numeric
                          key={controls[i].key}
                          control={controls[i]}
                          onChange={(v) => change(controls[i], v)}
                        />
                      ),
                  )}
                </div>
              </TabsContent>
              <TabsContent value="assistant">
                <div className="assistant">
                  <AudioLines size={28} />
                  <h2>A second pair of ears.</h2>
                  <p>
                    {model?.assistant?.message ||
                      "The assistant service is not connected. Audio stays on this computer."}
                  </p>
                  {model?.assistant &&
                  model.assistant.status !== "unavailable" ? (
                    <>
                      <label htmlFor="assistant-prompt">
                        What would you like to hear?
                      </label>
                      <textarea
                        id="assistant-prompt"
                        placeholder="Keep the pick attack, soften the upper mids�"
                        value={prompt}
                        maxLength={2000}
                        onChange={(e) => setPrompt(e.target.value)}
                      />
                      <Button
                        disabled={
                          !prompt.trim() ||
                          !model.ready ||
                          model.assistant.status === "running"
                        }
                        onClick={() => send("assistant.ask", { prompt })}
                      >
                        Ask assistant
                      </Button>
                      {model.assistant.status === "running" && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            send("assistant.cancel", {
                              requestId: model.assistant?.requestId,
                            })
                          }
                        >
                          Cancel request
                        </Button>
                      )}
                      {model.assistant.proposal && (
                        <section className="proposal">
                          <h3>{model.assistant.proposal.summary}</h3>
                          <p>
                            <strong>Prediction</strong>
                            <br />
                            {model.assistant.proposal.predicted}
                          </p>
                          <p>
                            <strong>Measured preview</strong>
                            <br />
                            {model.assistant.proposal.measured ||
                              "Render the preview to compare the measured effect."}
                          </p>
                          <Button
                            variant="outline"
                            onClick={() =>
                              send("assistant.preview", {
                                proposalId: model.assistant?.proposal?.id,
                                revision: model.revision,
                              })
                            }
                          >
                            Preview suggestion
                          </Button>
                          <Button
                            disabled={
                              !model.assistant.proposal.previewReady ||
                              model.assistant.proposal.sourceRevision !==
                                model.revision
                            }
                            onClick={() =>
                              send("assistant.apply", {
                                proposalId: model.assistant?.proposal?.id,
                                revision: model.revision,
                              })
                            }
                          >
                            Apply suggestion
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              send("assistant.dismiss", {
                                proposalId: model.assistant?.proposal?.id,
                              })
                            }
                          >
                            Dismiss
                          </Button>
                        </section>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => send("assistant.history.delete")}
                      >
                        Delete assistant history
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        Preview suggestions before applying them to your signal
                        chain. No provider requests run from this interface.
                      </p>
                      <span className="service-state">SERVICE UNAVAILABLE</span>
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        </div>
        <footer>
          <div className="live-controls">
            <Mic size={16} />
            <label className="inline">
              <Switch
                aria-label="Monitor live input"
                checked={model?.monitoring ?? false}
                disabled={!connected}
                onCheckedChange={(value) => send("live", { value })}
              />
              Live input
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={!model?.monitoring}
              onClick={() => send("capture")}
            >
              <Disc3 size={14} />
              {model?.recording ? "Use captured take" : "Capture take"}
            </Button>
            <span className="headphone">
              <Headphones size={14} />
              Use headphones
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => send("devices")}
            disabled={!connected}
          >
            <Settings2 />
            Audio devices
            <ChevronRight size={13} />
          </Button>
        </footer>
        <div className="status" role="status" aria-live="polite">
          <span className={error ? "error-dot" : "status-dot"} />
          {error ||
            model?.status ||
            (connected
              ? "Connecting to audio engine…"
              : "Desktop preview · Open ToneScope to connect the audio engine.")}
          {model?.busy && <span className="busy">Rendering comparison…</span>}
        </div>
      </div>
    </MotionConfig>
  );
}
