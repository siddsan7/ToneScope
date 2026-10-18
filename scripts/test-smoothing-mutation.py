"""Compile the real Engine and an isolated no-smoothing mutant; retain raw evidence.

Usage: python scripts/test-smoothing-mutation.py [--source-root ROOT] [--output DIR]
Requires MSVC (Windows) or CXX/c++ (other hosts). Never edits product sources.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command, cwd, env):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
    return {"command": command, "exit_code": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("artifacts/smoothing-mutation"))
    args = parser.parse_args()
    root, output = args.source_root.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    test = Path(__file__).resolve().parents[1] / "tests/native/smoothing_tests.cpp"
    source = root / "libs/audio-engine/src/Engine.cpp"
    needle = "impl->smooth=std::exp(-1/(.015*sr));"
    original = source.read_bytes()
    if original.count(needle.encode()) != 1:
        raise RuntimeError("Expected exactly one product smoothing coefficient assignment")
    env = {key.upper() if os.name == "nt" else key: value for key, value in os.environ.items()}
    if os.name == "nt":
        compiler = shutil.which("cl")
        if compiler is None:
            vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
            installation = subprocess.check_output([str(vswhere), "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], text=True).strip()
            vcvars = Path(installation) / "VC/Auxiliary/Build/vcvars64.bat"
            settings = subprocess.check_output(f'call "{vcvars}" >nul && set', shell=True, text=True)
            for line in settings.splitlines():
                if "=" in line and not line.startswith("="):
                    key, value = line.split("=", 1)
                    env[key.upper()] = value
            compiler = shutil.which("cl", path=env.get("PATH", env.get("Path")))
        flags = ["/nologo", "/std:c++20", "/O2", "/MD", "/EHsc"]
    else:
        compiler = shutil.which(os.environ.get("CXX", "c++"))
        flags = ["-std=c++20", "-O2"]
    if not compiler:
        raise RuntimeError("C++ compiler unavailable")
    dependencies = [source, root / "libs/audio-engine/include/tonescope/Engine.h",
                    root / "libs/audio-engine/src/Dsp.h", root / "libs/audio-engine/src/FaustDrive.h",
                    root / "dsp/generated/ToneScopeDrive.h", test, Path(__file__).resolve()]
    hashes = {str(p): digest(p) for p in dependencies}
    evidence = {"schema_version": 1, "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
                "host": platform.platform(), "compiler": compiler,
                "compiler_version": run([compiler] if os.name == "nt" else [compiler, "--version"], output, env),
                "raw_source_sha256": hashes, "mutation": {"from": needle, "to": "impl->smooth=0;"},
                "scope": "Native product parameter smoothing regression and mutation sensitivity; no device or package qualification.", "runs": {}}
    with tempfile.TemporaryDirectory(prefix="smoothing-", dir=output) as directory:
        work = Path(directory)
        for name, data in [("normal", original), ("mutant", original.replace(needle.encode(), b"impl->smooth=0;"))]:
            copy = work / f"Engine-{name}.cpp"
            copy.write_bytes(data)
            exe = work / (name + (".exe" if os.name == "nt" else ""))
            includes = [root / "libs/audio-engine/include", root / "libs/audio-engine/src", root / "dsp/generated"]
            if os.name == "nt":
                command = [compiler, *flags, *("/I" + str(p) for p in includes), str(copy), str(test), "/Fe" + str(exe)]
            else:
                command = [compiler, *flags, *("-I" + str(p) for p in includes), str(copy), str(test), "-o", str(exe)]
            compiled = run(command, work, env)
            evidence["runs"][name] = {"engine_copy_sha256": digest(copy), "compile": compiled}
            if compiled["exit_code"] == 0:
                evidence["runs"][name]["test"] = run([str(exe)], work, env)
        evidence["source_bytes_unchanged"] = hashes == {str(p): digest(p) for p in dependencies}
        normal = evidence["runs"]["normal"].get("test", {})
        mutant = evidence["runs"]["mutant"].get("test", {})
        evidence["passed"] = (normal.get("exit_code") == 0 and mutant.get("exit_code") == 1
                              and "smoothing response mismatch" in mutant.get("stderr", "")
                              and evidence["source_bytes_unchanged"])
    artifact = output / "result.json"
    artifact.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": evidence["passed"], "artifact": str(artifact),
                      "normal_exit": normal.get("exit_code"), "mutant_exit": mutant.get("exit_code")}))
    return 0 if evidence["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
