$ErrorActionPreference = 'Stop'
function Get-SafePath([string]$Root, [string]$Relative = '') {
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    if ($Relative -and ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)' -or $Relative -match '[:*?]')) { throw "Unsafe relative path: $Relative" }
    $full = [IO.Path]::GetFullPath((Join-Path $base $Relative)).TrimEnd('\','/')
    if ($full -ne $base -and -not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes root' }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point rejected: $cursor" }
        }
        if ($cursor -eq $base) { break }
        $parent = Split-Path $cursor -Parent
        if ($parent -eq $cursor) { break }; $cursor = $parent
    }
    return $full
}
function Read-PackageManifest([string]$Root) {
    $path = Get-SafePath $Root 'manifest.json'
    $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($manifest.schema_version -ne 1 -or $manifest.product -ne 'ToneScope-development' -or $manifest.version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$' -or @($manifest.files).Count -lt 1) { throw 'Invalid development manifest' }
    $seen = @{}
    foreach ($file in $manifest.files) {
        $null = Get-SafePath $Root $file.path
        if ($file.path -ieq 'manifest.json' -or $seen.ContainsKey($file.path) -or $file.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid manifest file entry' }
        $seen[$file.path] = $true
    }
    return $manifest
}
function Test-PackageFiles([string]$Root, $Manifest) {
    foreach ($file in $Manifest.files) {
        $path = Get-SafePath $Root $file.path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $file.sha256) { throw "Package hash mismatch: $($file.path)" }
    }
}
