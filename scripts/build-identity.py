"""Embed source identity in the CLI; hashes establish consistency, not signing."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments], text=True).strip()


def identity(root):
    # This matches evals/provenance.py. A release additionally requires clean Git.
    digest = hashlib.sha256()
    for name in sorted(git(root, "ls-files").splitlines()):
        path = root / name
        digest.update(name.encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest() if path.is_file() else b"MISSING")
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--compiler", required=True)
    parser.add_argument("--generator", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    payload = {"schema_version": 1, "commit_sha": git(root, "rev-parse", "HEAD"),
               "source_identity_sha256": identity(root),
               "working_tree_dirty": bool(git(root, "status", "--porcelain")),
               "compiler": args.compiler, "generator": args.generator,
               "dependencies_lock_sha256": hashlib.sha256((root / "dependencies.lock.json").read_bytes()).hexdigest(),
               "dsp_manifest_sha256": hashlib.sha256((root / "dsp/generated/manifest.json").read_bytes()).hexdigest()}
    content = '#pragma once\ninline constexpr char tonescopeBuildIdentity[] = R"ts_identity(' + json.dumps(payload, sort_keys=True) + ')ts_identity";\n'
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if not args.out.exists() or args.out.read_text(encoding="utf-8") != content:
        args.out.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
