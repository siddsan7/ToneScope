$ErrorActionPreference = 'Stop'
if (-not ('ToneScope.PackagePathInfo' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace ToneScope {
    public static class PackagePathInfo {
        [StructLayout(LayoutKind.Sequential)]
        private struct AttributeTagInfo { public uint Attributes; public uint Tag; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int infoClass, out AttributeTagInfo info, uint size);
        public static uint ReadTag(string path) {
            // Zero access, share read/write/delete; inspect the reparse entry itself.
            using (var handle = CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                AttributeTagInfo info;
                if (!GetFileInformationByHandleEx(handle, 9, out info, (uint)Marshal.SizeOf<AttributeTagInfo>()))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return info.Tag;
            }
        }
        public static bool IsCloudPlaceholder(uint tag) {
            // Windows SDK winnt.h: CLOUD .. CLOUD_F differ only in CLOUD_MASK.
            // Never allow a name-surrogate (path-redirecting) or unknown tag.
            return (tag & 0x20000000u) == 0 && (tag & ~0x0000F000u) == 0x9000001Au;
        }
    }
}
'@
}
function Get-SafePath([string]$Root, [string]$Relative = '') {
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    if ($Relative -and ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)' -or $Relative -match '[:*?]')) { throw "Unsafe relative path: $Relative" }
    $full = [IO.Path]::GetFullPath((Join-Path $base $Relative)).TrimEnd('\','/')
    if ($full -ne $base -and -not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes root' }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                $tag = [ToneScope.PackagePathInfo]::ReadTag($cursor)
                if (-not [ToneScope.PackagePathInfo]::IsCloudPlaceholder($tag)) { throw "Redirecting or unknown reparse point rejected: $cursor" }
            }
        }
        # The supplied root may itself be an ordinary child below a junction.
        # Validate its entire ancestry as well as the contained relative path.
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
