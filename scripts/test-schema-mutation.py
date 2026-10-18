#!/usr/bin/env python3
"""Compile actual session-loader guard mutation; never edit product sources."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Current product checkout, read only")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]/"artifacts/schema-mutation-current")
    parser.add_argument("--cmake", type=Path)
    args = parser.parse_args()
    root, out = args.root.resolve(), args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    cmake = args.cmake or root/".tools/python/cmake/data/bin/cmake.exe"
    session = root/"libs/session/include/tonescope/Session.h"
    test = Path(__file__).resolve().parents[1]/"tests/native/session_schema_tests.cpp"
    records = []
    summary = {"schema_version":1,"status":"blocked","campaign":"actual-product-schema-version-guards",
               "generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "product_root":str(root),"product_header":str(session),"test_source":str(test),
               "script_sha256":digest(__file__),"records":records,"hardware_or_live_model_claim":False}

    def run(label, argv, timeout=240):
        record = {"label":label,"argv":[str(x) for x in argv]}
        records.append(record)
        try:
            process = subprocess.run(record["argv"],capture_output=True,timeout=timeout)
            stdout,stderr = process.stdout,process.stderr
            record["exit_code"] = process.returncode
        except subprocess.TimeoutExpired as error:
            stdout,stderr=error.stdout or b"",error.stderr or b""
            record["exit_code"],record["timed_out"]=None,True
        for stream,data in (("stdout",stdout),("stderr",stderr)):
            target=out/f"{label}-{stream}.log"
            target.write_bytes(data)
            record[stream]={"path":str(target),"sha256":digest(target)}
        return record

    try:
        if not cmake.is_file() or not (root/".deps/JUCE/modules/juce_core/juce_core.h").is_file():
            raise RuntimeError("checked-out JUCE and pinned CMake are required; no downloads attempted")
        original = session.read_bytes().decode("utf-8")
        summary.update(product_header_sha256=digest(session),test_source_sha256=digest(test),cmake_sha256=digest(cmake))
        # Remove only schema-version tests, retaining object checks and every
        # other validation. Both independent guards must be changed.
        changes = [
            ('if(!document.isObject()||!document["schema_version"].isInt()||int(document["schema_version"])!=1)',
             'if(!document.isObject())'),
            ('if (!root || !document["schema_version"].isInt() || int(document["schema_version"]) != 1)',
             'if (!root)'),
        ]
        mutated=original
        summary["changed_guards"]=[]
        for before,after in changes:
            count=mutated.count(before)
            if count != 1:
                raise RuntimeError(f"mutation preimage drift: expected exactly one guard, got {count}: {before}")
            mutated=mutated.replace(before,after)
            summary["changed_guards"].append({"before":before,"after":after,"replace_count":count})
        if mutated==original or len(summary["changed_guards"])!=2:
            raise RuntimeError("mutation did not change exactly two guards")
        project=out/"project"
        project.mkdir(exist_ok=True)
        for label,text in (("baseline",original),("mutant",mutated)):
            header=project/label/"tonescope/Session.h"
            header.parent.mkdir(parents=True,exist_ok=True)
            header.write_bytes(text.encode("utf-8"))
            summary[label+"_header"]={"path":str(header),"sha256":digest(header)}
        test_copy=project/"session_schema_tests.cpp"
        test_copy.write_bytes(test.read_bytes())
        quote=lambda path:'"'+Path(path).as_posix()+'"'
        text=f'''cmake_minimum_required(VERSION 3.22)
project(ToneScopeSchemaMutation LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include({quote(root/'.deps/JUCE/extras/Build/CMake/JUCEModuleSupport.cmake')})
juce_add_module({quote(root/'.deps/JUCE/modules/juce_core')} ALIAS_NAMESPACE juce)
juce_add_module({quote(root/'.deps/JUCE/modules/juce_cryptography')} ALIAS_NAMESPACE juce)
add_library(tonescope_core STATIC {quote(root/'libs/audio-engine/src/Engine.cpp')})
target_include_directories(tonescope_core PUBLIC {quote(root/'libs/audio-engine/include')} PRIVATE {quote(root/'dsp/generated')})
foreach(variant baseline mutant)
  add_executable(schema_${{variant}} session_schema_tests.cpp)
  target_include_directories(schema_${{variant}} BEFORE PRIVATE "${{CMAKE_CURRENT_SOURCE_DIR}}/${{variant}}" {quote(root/'libs/session/include')})
  target_compile_definitions(schema_${{variant}} PRIVATE JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
  target_compile_options(schema_${{variant}} PRIVATE /utf-8)
  target_link_libraries(schema_${{variant}} PRIVATE tonescope_core juce::juce_core juce::juce_cryptography)
endforeach()
'''
        (project/"CMakeLists.txt").write_text(text,encoding="utf-8")
        summary["cmake_project_sha256"]=digest(project/"CMakeLists.txt")
        summary["core_sources"]=[{"path":str(p),"sha256":digest(p)} for p in (
            root/"libs/audio-engine/src/Engine.cpp",root/"libs/audio-engine/src/Dsp.h",
            root/"libs/audio-engine/include/tonescope/Engine.h",root/"libs/session/include/tonescope/ParameterState.h",
            root/"dsp/generated/ToneScopeDrive.h")]
        build=out/"build"
        configure=run("configure",[cmake,"-S",project,"-B",build,"-G","Visual Studio 17 2022","-A","x64"])
        if configure["exit_code"]!=0: raise RuntimeError("standalone configure failed; see raw logs")
        compile_result=run("build",[cmake,"--build",build,"--config","Release","--target","schema_baseline","schema_mutant","--","/m:1","/nr:false"])
        if compile_result["exit_code"]!=0: raise RuntimeError("baseline/mutant did not both compile; see raw logs")
        cache=(build/"CMakeCache.txt").read_text(encoding="utf-8")
        summary["compiler_configuration"]=[line for line in cache.splitlines() if re.match(r"CMAKE_(CXX_COMPILER|GENERATOR|GENERATOR_PLATFORM|CXX_FLAGS_RELEASE):",line)]
        compiler_info=next(build.glob("CMakeFiles/*/CMakeCXXCompiler.cmake"),None)
        if compiler_info:
            summary["compiler_identity"]={"path":str(compiler_info),"sha256":digest(compiler_info),
                "details":[line for line in compiler_info.read_text().splitlines() if any(k in line for k in ("CMAKE_CXX_COMPILER_ID ","CMAKE_CXX_COMPILER_VERSION ","CMAKE_CXX_COMPILER \""))]}
        baseline=run("baseline",[build/"Release/schema_baseline.exe"],30)
        mutant=run("mutant",[build/"Release/schema_mutant.exe"],30)
        summary["executables"]=[{"path":str(p),"sha256":digest(p)} for p in (build/"Release/schema_baseline.exe",build/"Release/schema_mutant.exe")]
        summary["product_header_unchanged"]=digest(session)==summary["product_header_sha256"]
        baseline_text=(out/"baseline-stdout.log").read_text(encoding="utf-8")
        mutant_text=(out/"mutant-stdout.log").read_text(encoding="utf-8")
        expected_outcomes=("schema_cases=5 failures=0" in baseline_text and "schema_cases=5 failures=4" in mutant_text
            and all(f"{case} expected=reject actual=accept result=FAIL" in mutant_text
                    for case in ("schema-99","schema-0","schema-float","schema-missing")))
        summary["expected_behavioral_outcomes"]=expected_outcomes
        summary["baseline_byte_identical"]=summary["baseline_header"]["sha256"]==summary["product_header_sha256"]
        killed=(baseline["exit_code"]==0 and mutant["exit_code"]==1 and not mutant.get("timed_out")
                and summary["product_header_unchanged"] and summary["baseline_byte_identical"] and expected_outcomes)
        summary["status"]="pass" if killed else "fail"
        summary["mutation_detected"]=killed
    except (OSError,RuntimeError,ValueError) as error:
        summary["reason"]=str(error)
    finally:
        (out/"run.json").write_text(json.dumps(summary,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    print(json.dumps({"status":summary["status"],"evidence":str(out/"run.json")}))
    return {"pass":0,"fail":1,"blocked":2}[summary["status"]]


if __name__=="__main__":sys.exit(main())
