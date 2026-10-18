param([string]$Output = 'artifacts/ToneScope-0.1.0-dev-win64.zip')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$stage=Join-Path $root 'artifacts/package/ToneScope-dev'
New-Item -ItemType Directory -Force (Join-Path $stage 'bin'),(Join-Path $stage 'evidence'),(Join-Path $stage 'docs') | Out-Null
Copy-Item -LiteralPath 'build/windows-dev/ToneScope_artefacts/Release/ToneScope.exe' -Destination (Join-Path $stage 'bin')
Copy-Item -LiteralPath 'build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe' -Destination (Join-Path $stage 'bin')
Copy-Item -LiteralPath README.md,dependencies.lock.json -Destination $stage
Copy-Item -LiteralPath docs/licenses -Destination (Join-Path $stage 'docs') -Recurse -Force
Copy-Item -LiteralPath docs/dsp -Destination (Join-Path $stage 'docs') -Recurse -Force
Copy-Item -LiteralPath docs/design.md -Destination (Join-Path $stage 'docs')
Copy-Item -LiteralPath delivery/progress.json -Destination (Join-Path $stage 'evidence')
foreach($suite in @('contracts','integration','dsp','ai-replay','ai-live')) {
  $run=Join-Path $root "artifacts/$suite/run.json"
  if(Test-Path -LiteralPath $run) { Copy-Item -LiteralPath $run -Destination (Join-Path $stage "evidence/$suite.json") }
}
@'
LOCAL DEVELOPMENT BUILD; NOT A QUALIFIED RELEASE
Windows x64; Microsoft Visual C++ 2015-2022 x64 runtime required.
No installer, signature, device timing or clean-machine qualification.
JUCE distribution licensing route remains unselected; do not publicly redistribute.
The full specification and unfinished features are tracked in the source repository.
'@ | Set-Content -LiteralPath (Join-Path $stage 'DEVELOPMENT.txt')
$binaryHashes=Get-ChildItem -LiteralPath (Join-Path $stage 'bin') -File | Get-FileHash -Algorithm SHA256 | Select-Object Hash,@{Name='File';Expression={Split-Path $_.Path -Leaf}}
$binaryHashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'evidence/binaries.json')
Compress-Archive -LiteralPath $stage -DestinationPath $Output -Force
Get-FileHash -LiteralPath $Output -Algorithm SHA256
