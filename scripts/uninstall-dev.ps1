param([Parameter(Mandatory)][string]$Version,
      [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'ToneScope-development'))
. "$PSScriptRoot/PackageSafety.ps1"
if ($Version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Invalid version' }
$root = Get-SafePath $InstallRoot
$destination = Get-SafePath $root "versions/$Version"
$manifest = Read-PackageManifest $destination
if ($manifest.version -ne $Version) { throw 'Version identity mismatch' }
$preserved = @()
foreach ($file in $manifest.files) {
    $path = Get-SafePath $destination $file.path
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ieq $file.sha256) { Remove-Item -LiteralPath $path }
        else { $preserved += $file.path }
    }
}
# Keep the ownership receipt when modified files survive. Never recurse or remove user data.
if ($preserved.Count -eq 0) { Remove-Item -LiteralPath (Get-SafePath $destination 'manifest.json') }
$active = Get-SafePath $root 'active.json'
if ((Test-Path -LiteralPath $active) -and ((Get-Content -LiteralPath $active -Raw | ConvertFrom-Json).version -eq $Version)) { Remove-Item -LiteralPath $active }
Write-Output "Uninstalled manifest-owned unchanged files. Preserved modified files: $($preserved -join ', ')"
