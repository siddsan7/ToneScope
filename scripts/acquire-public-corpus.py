"""Bounded acquisition for the frozen public corpus; never invokes audio or models."""
import argparse
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
from public_corpus import verify_archive


def acquire(output, manifest, seconds=900, now=time.monotonic):
    if not math.isfinite(seconds) or not 0 < seconds <= 900:
        raise ValueError("acquisition deadline must be within 900 seconds")
    expected = manifest["archive"]
    if type(expected["bytes"]) is not int or not 0 < expected["bytes"] <= 200_000_000:
        raise ValueError("invalid frozen archive size")
    url = manifest["download_url"]
    if url != "https://zenodo.org/api/records/14963133/files/P3_music.zip/content":
        raise ValueError("unexpected corpus origin")
    output = Path(output)
    if output.exists():
        verify_archive(output, expected)
        return "verified_cache"
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".partial")
    deadline = now() + seconds
    request = urllib.request.Request(url, headers={"Accept-Encoding": "identity", "User-Agent": "ToneScope-public-regression/1"})
    # Exclusive partial creation preserves previous attempts. Check the overall
    # deadline between single buffered reads, each with a <=30s socket timeout.
    with temporary.open("xb") as stream, urllib.request.urlopen(request, timeout=min(30, seconds)) as response:
        if int(response.headers.get("Content-Length", "-1")) != expected["bytes"]:
            raise ValueError("unexpected corpus response length")
        size = 0
        while True:
            if now() >= deadline:
                raise TimeoutError("public corpus acquisition deadline")
            data = response.read1(64 * 1024)
            if not data:
                break
            size += len(data)
            if size > expected["bytes"]:
                raise ValueError("corpus response exceeds frozen byte limit")
            stream.write(data)
        if size != expected["bytes"]:
            raise ValueError("truncated corpus response")
    verify_archive(temporary, expected)
    os.link(temporary, output)  # Atomic no-replace publication in the same folder.
    temporary.unlink()
    return "downloaded_verified"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = json.loads((ROOT / "evals/datasets/guitar-techs-public.json").read_text())
        print(json.dumps({"status": acquire(args.output, manifest), "archive": str(args.output)}))
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}))
        sys.exit(2)
