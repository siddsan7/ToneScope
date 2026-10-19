#!/usr/bin/env python3
"""Build a local, attributed listening page and measured plots. No downloads."""
import argparse
import datetime
import hashlib
import html
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
from types import SimpleNamespace
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
from oracles import flatten, read_wav, rms, sha256
from public_corpus import MANIFEST, safe_listing, verify_archive, write_json
from run import Runner


def matched_audition(dry, wet):
    """Return shared-headroom PCM audition samples and the exact applied gains."""
    if len(dry) != len(wet) or any(len(a) != len(b) for a, b in zip(dry, wet)):
        raise ValueError("audition shape mismatch")
    a, b = rms(flatten(dry)), rms(flatten(wet))
    if not a or not b:
        raise ValueError("cannot RMS-match silent selection")
    match = a / b
    peak = max(max(map(abs, flatten(dry))), max(map(abs, flatten(wet))) * match)
    headroom = min(1., .95 / peak)
    return ([[x * headroom for x in c] for c in dry],
            [[x * match * headroom for x in c] for c in wet],
            {"wet_rms_match_db": 20 * math.log10(match),
             "shared_headroom_db": 20 * math.log10(headroom)})


def pcm16(path, channels, rate):
    with wave.open(str(path), "wb") as stream:
        stream.setparams((len(channels), 2, rate, 0, "NONE", "not compressed"))
        stream.writeframes(b"".join(struct.pack("<h", round(max(-1., min(1., x)) * 32767))
                                   for x in flatten(channels)))


def plot(path, title, series, x_label, y_label):
    """Small dependency-free SVG; every series comes from recorded measurements."""
    points = [p for _, values in series for p in values]
    if not points or any(not math.isfinite(v) for p in points for v in p):
        raise ValueError("plot requires finite measurements")
    xs, ys = zip(*points)
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    dx, dy = max(xmax - xmin, 1), max(ymax - ymin, 1)
    ymin, ymax = ymin - .08 * dy, ymax + .08 * dy
    dy = ymax - ymin
    colors = ("#86efac", "#fbbf24", "#93c5fd")
    def esc(value): return html.escape(str(value))
    items = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" role="img" aria-label="{esc(title)}">',
             '<rect width="800" height="420" fill="#111827"/>',
             f'<g font-family="sans-serif" font-size="14" fill="#e5e7eb"><text x="75" y="28" font-size="20">{esc(title)}</text>']
    for i in range(6):
        x, y = 75 + i * 132, 330 - i * 54
        items.extend([f'<path d="M{x},60 V330 M75,{y} H735" stroke="#374151"/>',
                      f'<text x="{x}" y="352" text-anchor="middle">{xmin + dx*i/5:.2f}</text>',
                      f'<text x="65" y="{y+5}" text-anchor="end">{ymin + dy*i/5:.2f}</text>'])
    for index, (label, values) in enumerate(series):
        color = colors[index % len(colors)]
        coords = " ".join(f'{75 + 660*(x-xmin)/dx:.2f},{330 - 270*(y-ymin)/dy:.2f}' for x, y in values)
        items.extend([f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="2"/>',
                      f'<text x="{75+index*220}" y="400" fill="{color}">{esc(label)}</text>'])
        items.extend(f'<circle cx="{75+660*(x-xmin)/dx:.2f}" cy="{330-270*(y-ymin)/dy:.2f}" r="3" fill="{color}"/>' for x, y in values if len(values) < 30)
    items.extend([f'<text x="405" y="377" text-anchor="middle">{esc(x_label)}</text>',
                  f'<text transform="translate(17 195) rotate(-90)" text-anchor="middle">{esc(y_label)}</text>', '</g></svg>'])
    path.write_text("\n".join(items), encoding="utf-8")


def build(args):
    out, cli = args.output.resolve(), args.cli.resolve()
    out.mkdir(parents=True, exist_ok=False)
    frozen = json.loads(MANIFEST.read_text(encoding="utf-8"))
    verify_archive(args.archive, frozen["archive"])
    cli_hash = sha256(cli)
    log = []
    def command(*arguments):
        argv = [str(cli), *map(str, arguments)]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=120)
        log.append({"argv": argv, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
        write_json(out / "commands.json", log)
        if result.returncode:
            raise RuntimeError("native command failed; see commands.json")
        return json.loads(result.stdout)
    report = {"schema_version": 1, "status": "building", "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "compiled_build_info": command("build-info"), "cli_sha256": cli_hash,
              "script_sha256": sha256(__file__), "corpus_manifest_sha256": sha256(MANIFEST),
              "evaluation_source_sha256": {name: sha256(ROOT / "evals" / name) for name in ("run.py", "numeric.py", "oracles.py", "gates.json", "public_corpus.py")},
              "classification": frozen["classification"], "examples": []}
    notice = frozen["attribution"] + "\nSource: " + frozen["source_url"] + "\nLicense: " + frozen["license_url"]
    notice += "\nChanges: two eight-second excerpts per original; ToneScope compression or drive; separate RMS-matched PCM16 audition copies with shared headroom. Raw float32 renders remain unchanged. No endorsement, holdout, or listening qualification.\n"
    (out / "NOTICE.txt").write_text(notice, encoding="utf-8")
    with zipfile.ZipFile(args.archive) as archive:
        safe_listing(archive, frozen["maximum_uncompressed_bytes"])
        for index, item in enumerate(frozen["records"], 1):
            data = archive.read(item["member"])
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("frozen member hash mismatch")
            original = out / f"original-{index}.wav"
            original.write_bytes(data)
            rate, channels = read_wav(original)
            if (rate, len(channels), len(channels[0])) != (item["sample_rate_hz"], item["channels"], item["frames"]):
                raise ValueError("frozen member dimensions mismatch")
            for variant, start, parameters in (
                ("compressor", 0, {"compressor": True, "thresholdDb": -30, "ratio": 4, "attackMs": 10, "releaseMs": 150, "kneeDb": 6}),
                ("drive", 8, {"drive": True, "driveDb": 18, "oversampling": 4, "toneHz": 5000})):
                name = f"di-{index}-{variant}"
                config, raw = out / f"{name}.json", out / f"{name}-raw.wav"
                write_json(config, {"schema_version": 1, "parameters": parameters})
                manifest = command("render", "--source", original, "--out", raw, "--session", config,
                                   "--start", start * rate, "--end", (start + 8) * rate)
                wet_rate, wet = read_wav(raw)
                dry = [c[start * rate:(start + 8) * rate] for c in channels]
                if wet_rate != rate or manifest["source_sha256"] != sha256(original) or manifest["artifact_sha256"] != sha256(raw):
                    raise ValueError("render provenance mismatch")
                matched_dry, matched_wet, gains = matched_audition(dry, wet)
                pcm16(out / f"{name}-dry.wav", matched_dry, rate)
                pcm16(out / f"{name}-wet.wav", matched_wet, rate)
                report["examples"].append({"name": name, "member": item["member"], "performance_group": item["performance_group"],
                    "source_seconds": [start, start + 8], "parameters": parameters, "render_manifest": manifest, **gains})
    runner = Runner(SimpleNamespace(output=str(out / "measurements"), cli=str(cli), suite="dsp"))
    measurements = {}
    for name, method in (("curve", runner.compressor), ("timing", runner.compressor_timing), ("oversampling", runner.alias)):
        folder = out / "measurements" / name
        folder.mkdir()
        runner.active_folder = folder
        measurements[name] = method(folder)
    curve = measurements["curve"]
    plot(out / "compressor-curve.svg", "Compressor: settled DC transfer, 4:1 hard knee", [
        ("Measured", [(float(x), float(x) + v["measured_gain_db"]) for x, v in curve.items()]),
        ("Independent reference", [(float(x), float(x) + v["expected_gain_db"]) for x, v in curve.items()])], "Input (dBFS)", "Output (dBFS)")
    folder = out / "measurements" / "timing"
    source = read_wav(folder / "timing-48000-input.wav")[1][0]
    wet = read_wav(folder / "timing-48000.wav")[1][0]
    from numeric import compressor_reference
    expected = compressor_reference(source, 48000)
    plot(out / "compressor-timing.svg", "Compressor: low / high / low DC at 48 kHz", [
        (label, [(i / 48000, 20 * math.log10(values[i] / source[i])) for i in range(0, len(source), 120)])
        for label, values in (("Measured", wet), ("Independent reference", expected))], "Time (seconds)", "Gain (dB)")
    subset = [v for v in measurements["oversampling"].values() if v["sample_rate_hz"] == 48000]
    plot(out / "oversampling.svg", "Drive: periodic waveform error at 48 kHz", [
        (f"{factor}x", [(v["frequency_hz"], 20 * math.log10(v["modes"][str(factor)]["rms_error"])) for v in subset])
        for factor in (1, 2, 4)], "Input sine frequency (Hz)", "Reference error (dBFS)")
    report["measurements"] = measurements
    if sha256(cli) != cli_hash:
        raise RuntimeError("CLI changed during showcase generation")
    report["status"] = "pass"
    cards = []
    for example in report["examples"]:
        name = example["name"]
        cards.append(f'<section><h2>{name}</h2><p>{html.escape(example["member"])} · seconds {example["source_seconds"]}</p><p>Dry</p><audio controls preload="none" src="{name}-dry.wav"></audio><p>Processed, RMS matched</p><audio controls preload="none" src="{name}-wet.wav"></audio><p>Wet match: {example["wet_rms_match_db"]:.2f} dB; shared headroom: {example["shared_headroom_db"]:.2f} dB.</p><a href="{name}-raw.wav">Raw analytical render</a></section>')
    (out / "index.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ToneScope listening bench</title><style>body{font:18px/1.5 system-ui;background:#111827;color:#e5e7eb;max-width:960px;margin:40px auto;padding:0 24px}a{color:#93c5fd}section{border-top:1px solid #4b5563;padding:20px 0}audio{width:100%}img{width:100%}</style><h1>ToneScope listening bench</h1><p>Four attributed DI excerpts. Start at a low playback volume. Dry and processed audition copies share headroom; wet RMS is matched to dry. RMS matching does not establish equal perceived loudness. Browser players do not provide sample-aligned switching.</p>' + ''.join(cards) + '<h2>Measured behavior</h2><p>These existing numerical checks passed for this binary. Curve uses three settled DC levels. Timing uses a DC step. Oversampling error includes finite filter differences; it is not a universal alias or musical-quality score.</p>' + ''.join(f'<img src="{name}.svg" alt="{title}">' for name, title in (("compressor-curve", "Settled compressor transfer"), ("compressor-timing", "Attack and release gain response"), ("oversampling", "Periodic waveform reference error"))) + '<p><a href="report.json">Settings, measurements and binary identity</a> · <a href="NOTICE.txt">Attribution and transformations</a></p><pre style="white-space:pre-wrap">' + html.escape(notice) + '</pre></html>', encoding="utf-8")
    report["evidence"] = [{"path": str(p.relative_to(out)), "sha256": sha256(p)} for p in sorted(out.rglob("*")) if p.is_file()]
    write_json(out / "report.json", report)
    print(json.dumps({"status": "pass", "output": str(out), "examples": len(report["examples"])}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        build(args)
        return 0
    except Exception as error:
        print(json.dumps({"status": "fail", "reason": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
