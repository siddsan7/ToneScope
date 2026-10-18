param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$lock = Get-Content dependencies.lock.json -Raw | ConvertFrom-Json
if (!(Test-Path .deps/JUCE/CMakeLists.txt)) {
  if ($VerifyOnly) { throw 'JUCE missing; run bootstrap without -VerifyOnly' }
  git clone https://github.com/juce-framework/JUCE.git .deps/JUCE
  if ($LASTEXITCODE) { throw 'JUCE download failed' }
  git -C .deps/JUCE checkout $lock.juce.commit
  if ($LASTEXITCODE) { throw 'JUCE checkout failed' }
}
$actual = git -C .deps/JUCE rev-parse HEAD
if ($actual -ne $lock.juce.commit) { throw 'JUCE revision differs from lock' }
if (!(Test-Path .tools/python/cmake/data/bin/cmake.exe)) {
  if ($VerifyOnly) { throw 'Local CMake missing' }
  python -m pip install --target .tools/python cmake==3.31.6
  if ($LASTEXITCODE) { throw 'CMake bootstrap failed' }
}
Write-Output "Pinned JUCE $($lock.juce.version) verified. CMake: .tools/python/cmake/data/bin/cmake.exe"
Write-Output 'Distribution blocked until JUCE licensing route, device/human qualification and release review are recorded.'
