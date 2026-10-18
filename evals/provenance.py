"""Local evidence identity. Hashes establish consistency, never reviewer authenticity."""
import hashlib
import subprocess
import json
from pathlib import Path


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def source_identity(root):
    """Hash tracked file paths and actual bytes, including pending tracked edits."""
    root = Path(root)
    files = git(root, "ls-files").splitlines()
    digest = hashlib.sha256()
    for name in sorted(files):
        path = root / name
        digest.update(name.encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest() if path.is_file() else b"MISSING")
    return digest.hexdigest()


def runtime_files(root, cli):
    paths = [Path(p) for p in sorted((Path(root) / "evals").rglob("*.py"))]
    paths += [Path(p) for p in sorted((Path(root) / "evals").rglob("*.json"))]
    if cli:
        paths.append(Path(cli))
    return [{"path": str(p.resolve()), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in paths if p.is_file()]


def compiled_identity(cli):
    if not cli or not Path(cli).is_file():
        return None
    try:
        result = subprocess.run([str(cli), "build-info"], capture_output=True, text=True, timeout=5, check=True)
        if len(result.stdout) > 16384:
            return None
        value = json.loads(result.stdout)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def valid_compiled_identity(value, commit, source):
    return (isinstance(value, dict) and value.get("schema_version") == 1
            and value.get("commit_sha") == commit
            and value.get("source_identity_sha256") == source
            and value.get("working_tree_dirty") is False
            and bool(value.get("compiler")) and bool(value.get("generator")))
