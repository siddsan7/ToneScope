param([string]$Output = 'artifacts/ToneScope-0.1.0-dev-win64.zip', [string]$Version = '0.1.0-dev', [string]$BuildRoot = 'build/windows-dev', [string]$AssistantBundle = 'artifacts/assistant-bundle')
. "$PSScriptRoot/PackageSafety.ps1"
$root = Split-Path $PSScriptRoot -Parent
if ($Version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Invalid version' }
function Absolute([string]$Path) { if ([IO.Path]::IsPathRooted($Path)) { return $Path }; return (Join-Path $root $Path) }
$stage = Join-Path $root "artifacts/package/$([guid]::NewGuid().ToString('N'))/ToneScope-dev"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
function Include([string]$Source, [string]$Target) {
    $sourcePath = Absolute $Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Required package input missing: $Source" }
    $null = Get-SafePath (Split-Path $sourcePath -Parent) (Split-Path $sourcePath -Leaf)
    $targetPath = Get-SafePath $stage $Target
    New-Item -ItemType Directory -Path (Split-Path $targetPath -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath
}
Include "$(Absolute $BuildRoot)/ToneScope_artefacts/Release/ToneScope.exe" 'bin/ToneScope.exe'
Include "$(Absolute $BuildRoot)/tonescope_cli_artefacts/Release/tonescope_cli.exe" 'bin/tonescope_cli.exe'
$buildIdentity = & (Join-Path $stage 'bin/tonescope_cli.exe') build-info
if ($LASTEXITCODE -ne 0) { throw 'Packaged renderer build identity failed' }
$identity = $buildIdentity | ConvertFrom-Json
if ($identity.schema_version -ne 1 -or -not $identity.commit_sha -or -not $identity.source_identity_sha256) { throw 'Packaged renderer build identity incomplete' }
$buildIdentity | Set-Content -LiteralPath (Join-Path $stage 'build-info.json') -Encoding utf8
foreach ($name in @('host.mjs','dependencies.json','THIRD-PARTY-NOTICES.txt','frontend-dependencies.json','FRONTEND-NOTICES.txt')) { Include "$(Absolute $AssistantBundle)/$name" "bin/assistant/$name" }
$legal = "$(Absolute $AssistantBundle)/host.mjs.LEGAL.txt"
if (Test-Path -LiteralPath $legal) { Include $legal 'bin/assistant/host.mjs.LEGAL.txt' }
foreach ($name in @('PackageSafety.ps1','verify-package.ps1','install-dev.ps1','uninstall-dev.ps1','diagnostics-dev.ps1')) { Include "scripts/$name" "tools/$name" }
foreach ($name in @('README.md','dependencies.lock.json')) { Include $name $name }
foreach ($name in @('JUCE-LICENSE.md','JUCE.spdx.json','COMPONENTS.md')) { Include "docs/licenses/$name" "docs/licenses/$name" }
Include 'docs/dsp/faust-maths-license.txt' 'docs/licenses/faust-maths-license.txt'
Include 'apps/frontend/public/fonts/SpaceGrotesk-OFL.txt' 'docs/licenses/SpaceGrotesk-OFL.txt'
Include 'apps/frontend/public/fonts/CommitMono-OFL.txt' 'docs/licenses/CommitMono-OFL.txt'
Include 'apps/frontend/src/components/ui/LICENSE.md' 'docs/licenses/shadcn-LICENSE.md'
Include 'docs/distribution/development.md' 'docs/development.md'
Include 'docs/runbooks.md' 'docs/runbooks.md'
@"
UNSIGNED PRIVATE DEVELOPMENT BUILD; NOT A QUALIFIED RELEASE.
Windows x64. Microsoft VC++ 2015-2022 x64 runtime and Evergreen WebView2 runtime
are external prerequisites. Node 24.x on PATH is needed only for the optional
local assistant broker; core audio and CLI work independently of Node.
No administrator action, registry, service, PATH or shortcut changes are made.
JUCE distribution route is unselected: no public redistribution authorization.
Hardware, human accessibility/listening, signing and clean-machine qualification
are unperformed. See docs/development.md for development scope.
"@ | Set-Content -LiteralPath (Join-Path $stage 'DEVELOPMENT.txt') -Encoding utf8
$files = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
    @{path=[IO.Path]::GetRelativePath($stage,$_.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$_.Length}
})
@{schema_version=1; product='ToneScope-development'; version=$Version; unsigned=$true; files=$files} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8
Test-PackageFiles $stage (Read-PackageManifest $stage)
$outputPath = Absolute $Output
New-Item -ItemType Directory -Path (Split-Path $outputPath -Parent) -Force | Out-Null
if (Test-Path -LiteralPath $outputPath) { throw 'Output exists; choose a new package filename' }
Compress-Archive -LiteralPath $stage -DestinationPath $outputPath
Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
Write-Output "Verified staging directory: $stage"
