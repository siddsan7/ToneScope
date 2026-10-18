# Private unsigned development package

Build frontend/native executables and run `node scripts/bundle-assistant.mjs`
with the locked dependencies installed first. Run `pwsh scripts/package-dev.ps1`
to create a fresh UUID staging tree and new ZIP. Inputs are explicitly listed;
session histories, evaluation results, private manifests, environment files and
audio are never copied. Existing ZIP outputs are refused. `manifest.json` hashes
every delivered file except itself with SHA-256. Hashes detect accidental changes;
they do not authenticate an unsigned package or manifest.

Extract locally and run `pwsh tools/verify-package.ps1 -PackageRoot <extracted>`.
Install with `pwsh tools/install-dev.ps1 -PackageRoot <extracted>`; the default is
`%LOCALAPPDATA%/ToneScope-development/versions/<version>`. Run the printed EXE path.
No elevation, registry changes, auto-launch or shortcuts. The active.json pointer
records the chosen version. Install another uniquely named version, then use
`-ActivateVersion <previous-version>` with the same PackageRoot argument to roll
back after file verification. Install never overwrites an existing version.

Uninstall with `pwsh tools/uninstall-dev.ps1 -Version <version>`. It removes only
manifest-owned files whose hashes still match, preserves modified and unknown
files, retains a receipt if modified files remain, and never recursively deletes.
Empty directories may remain. User sessions, captures, history and budget state
outside the install tree are preserved. Stop the app before upgrading/uninstalling.
Reparse points and escaping manifest paths are rejected.

Create a local support report explicitly with
`pwsh tools/diagnostics-dev.ps1 -PackageRoot <version-directory> -Output <new.json>`.
It reports OS version, process architecture and package integrity; it excludes
audio, session contents, paths, environment, logs, keys and crash dumps by design.
It never uploads or sends a report. Review it before sharing.

Supported development target: Windows x64 with Microsoft VC++ 2015-2022 x64 runtime
and Evergreen WebView2 installed. Native fallback/core audio and CLI do not depend
on the optional assistant. The broker is a Node ESM bundle at bin/assistant/host.mjs,
requires Node 24.x on PATH, and is launched with private native-host configuration.
It is not an Eve deployment and performs no model calls during packaging/install.

Disposable tests exercise hashes, tampering, traversal, reparse protection,
side-by-side upgrades, rollback and preservation. This is development install
infrastructure, not a signed/qualified installer. Clean-machine install, physical
hardware lifecycle, human accessibility/listening and signing remain unperformed.
Public distribution remains blocked on the JUCE licensing route and the
repository's independent review/release gates.
