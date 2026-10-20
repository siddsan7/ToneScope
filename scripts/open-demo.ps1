param([string]$InstallRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/demo-installed'),
      [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/PackageSafety.ps1"
$root = Get-SafePath $InstallRoot
$active = Get-Content -LiteralPath (Get-SafePath $root 'active.json') -Raw | ConvertFrom-Json
if ($active.schema_version -ne 1 -or $active.version -isnot [string] -or
    $active.version -cnotmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Invalid active demo version. Reinstall the verified private package.' }
$package = Get-SafePath $root "versions/$($active.version)"
$manifest = Read-PackageManifest $package
if ($manifest.version -cne $active.version) { throw 'Active demo version does not match its manifest.' }
Test-PackageFiles $package $manifest
$executable = Get-SafePath $package 'bin/ToneScope.exe'
if (@($manifest.files | Where-Object { $_.path -ceq 'bin/ToneScope.exe' }).Count -ne 1) { throw 'Demo manifest must own ToneScope.exe.' }
# Derive the executable from the verified version; never execute the pointer's path.
if ($VerifyOnly) { Write-Output "Verified demo: $executable"; return }
$otherBuilds = @(Get-Process -Name ToneScope -ErrorAction SilentlyContinue | Where-Object { -not $_.Path -or $_.Path -ine $executable })
if ($otherBuilds.Count) { throw 'Another ToneScope build is open. Save your session and close that window, then open this launcher again.' }
Start-Process -FilePath $executable -WorkingDirectory (Split-Path $executable -Parent) -WindowStyle Normal
