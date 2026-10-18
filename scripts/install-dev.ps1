param([Parameter(Mandatory)][string]$PackageRoot,
      [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'ToneScope-development'),
      [string]$ActivateVersion)
. "$PSScriptRoot/PackageSafety.ps1"
$root = Get-SafePath $InstallRoot
if ($ActivateVersion) {
    if ($ActivateVersion -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Invalid version' }
    $destination = Get-SafePath $root "versions/$ActivateVersion"
    $manifest = Read-PackageManifest $destination
    if ($manifest.version -cne $ActivateVersion) { throw 'Version identity mismatch' }
    Test-PackageFiles $destination $manifest
} else {
    $source = Get-SafePath $PackageRoot
    $manifest = Read-PackageManifest $source
    Test-PackageFiles $source $manifest
    $destination = Get-SafePath $root "versions/$($manifest.version)"
    if (Test-Path -LiteralPath $destination) { throw 'Version already installed; use -ActivateVersion for rollback' }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($file in $manifest.files) {
        $target = Get-SafePath $destination $file.path
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Get-SafePath $source $file.path) -Destination $target
    }
    Copy-Item -LiteralPath (Get-SafePath $source 'manifest.json') -Destination $destination
    Test-PackageFiles $destination $manifest
}
$executable = Get-SafePath $destination 'bin/ToneScope.exe'
if (@($manifest.files | Where-Object { (Get-SafePath $destination $_.path) -eq $executable }).Count -ne 1) { throw 'Manifest must own the activated executable' }
$relativeExecutable = [IO.Path]::GetRelativePath($root, $executable).Replace('\','/')
$active = Get-SafePath $root 'active.json'
@{schema_version=1; version=$manifest.version; executable=$relativeExecutable} | ConvertTo-Json | Set-Content -LiteralPath $active -Encoding utf8
Write-Output "Active development version: $($manifest.version). Launch $destination/bin/ToneScope.exe"
