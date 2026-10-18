param([Parameter(Mandatory)][string]$PackageRoot)
. "$PSScriptRoot/PackageSafety.ps1"
$manifest = Read-PackageManifest $PackageRoot
Test-PackageFiles $PackageRoot $manifest
Write-Output "Verified $(@($manifest.files).Count) manifest files ($($manifest.version))"
