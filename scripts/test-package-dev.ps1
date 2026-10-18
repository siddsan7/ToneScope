$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/PackageSafety.ps1"
$workspace = Split-Path $PSScriptRoot -Parent
$temp = Join-Path $workspace "artifacts/package-tests/$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$checks = 0
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:checks++ }
function Reject([scriptblock]$Action, [string]$Message) { $failed=$false; try { & $Action | Out-Null } catch { $failed=$true }; Assert $failed $Message }
function Payload([string]$Version) {
    $dir = Join-Path $temp "payload-$Version"
    New-Item -ItemType Directory -Path "$dir/bin" -Force | Out-Null
    "synthetic $Version" | Set-Content "$dir/bin/ToneScope.exe"
    @{schema_version=1;product='ToneScope-development';version=$Version;files=@(@{path='bin/ToneScope.exe';sha256=(Get-FileHash "$dir/bin/ToneScope.exe").Hash})} | ConvertTo-Json -Depth 5 | Set-Content "$dir/manifest.json"
    return $dir
}
$v1=Payload 'v1'; $v2=Payload 'v2'; $install=Join-Path $temp 'install'
& "$PSScriptRoot/verify-package.ps1" -PackageRoot $v1
$checks++
& "$PSScriptRoot/install-dev.ps1" -PackageRoot $v1 -InstallRoot $install
& "$PSScriptRoot/install-dev.ps1" -PackageRoot $v2 -InstallRoot $install
Assert ((Get-Content "$install/active.json" -Raw | ConvertFrom-Json).version -eq 'v2') 'Upgrade activation failed'
& "$PSScriptRoot/install-dev.ps1" -PackageRoot $v1 -InstallRoot $install -ActivateVersion v1
Assert ((Get-Content "$install/active.json" -Raw | ConvertFrom-Json).version -eq 'v1') 'Rollback failed'
Reject { & "$PSScriptRoot/install-dev.ps1" -PackageRoot $v1 -InstallRoot $install } 'Existing version overwritten'
'changed' | Set-Content "$install/versions/v1/bin/ToneScope.exe"
Reject { & "$PSScriptRoot/install-dev.ps1" -PackageRoot $v1 -InstallRoot $install -ActivateVersion v1 } 'Tampered rollback accepted'
'user state' | Set-Content "$install/user-data.txt"
'unknown' | Set-Content "$install/versions/v1/unknown.txt"
& "$PSScriptRoot/uninstall-dev.ps1" -InstallRoot $install -Version v1
Assert (Test-Path "$install/versions/v1/bin/ToneScope.exe") 'Modified user file deleted'
Assert (Test-Path "$install/versions/v1/unknown.txt") 'Unknown file deleted'
Assert (Test-Path "$install/user-data.txt") 'User data deleted'
& "$PSScriptRoot/uninstall-dev.ps1" -InstallRoot $install -Version v2
Assert (-not (Test-Path "$install/versions/v2/bin/ToneScope.exe")) 'Owned file not removed'
'mutation' | Set-Content "$v1/bin/ToneScope.exe"
Reject { & "$PSScriptRoot/verify-package.ps1" -PackageRoot $v1 } 'Tampered package accepted'
$evil=Payload 'evil'; $manifest=Get-Content "$evil/manifest.json" -Raw | ConvertFrom-Json
$manifest.files[0].path='../outside.txt'; $manifest | ConvertTo-Json -Depth 5 | Set-Content "$evil/manifest.json"
Reject { & "$PSScriptRoot/install-dev.ps1" -PackageRoot $evil -InstallRoot $install } 'Traversal accepted'
$link=Join-Path $temp 'junction'
New-Item -ItemType Junction -Path $link -Target $v2 | Out-Null
Reject { & "$PSScriptRoot/verify-package.ps1" -PackageRoot $link } 'Junction accepted'
$diag=Join-Path $temp 'diagnostics.json'
& "$PSScriptRoot/diagnostics-dev.ps1" -PackageRoot $v2 -Output $diag
$text=Get-Content $diag -Raw
Assert (-not $text.Contains($temp)) 'Private path leaked'
Assert (-not $text.Contains($env:USERPROFILE)) 'User profile leaked'
Reject { & "$PSScriptRoot/diagnostics-dev.ps1" -PackageRoot $v2 -Output $diag } 'Diagnostics overwritten'
Write-Output "PASS: $checks packaging/install/privacy checks; synthetic artifacts retained at $temp"
