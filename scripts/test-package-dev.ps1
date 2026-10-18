$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/PackageSafety.ps1"
$temp = Join-Path ([IO.Path]::GetTempPath()) "ToneScope-package-tests/$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$checks = 0
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:checks++ }
function Reject([scriptblock]$Action, [string]$Message) { $failed=$false; try { & $Action | Out-Null } catch { $failed=$true }; Assert $failed $Message }
Assert ([ToneScope.PackagePathInfo]::IsCloudPlaceholder(0x9000601Au)) 'Documented CLOUD_6 tag rejected'
Assert (-not [ToneScope.PackagePathInfo]::IsCloudPlaceholder(0xA0000003u)) 'Mount-point tag allowed'
Assert (-not [ToneScope.PackagePathInfo]::IsCloudPlaceholder(0xA000000Cu)) 'Symlink tag allowed'
Assert (-not [ToneScope.PackagePathInfo]::IsCloudPlaceholder(0x9000001Bu)) 'Unknown tag allowed'
$cloudAncestors = 0
$ancestor = $PSScriptRoot
while ($ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $tag = [ToneScope.PackagePathInfo]::ReadTag($ancestor)
        if ([ToneScope.PackagePathInfo]::IsCloudPlaceholder($tag)) {
            Assert ((Get-SafePath $PSScriptRoot) -eq [IO.Path]::GetFullPath($PSScriptRoot)) 'Actual cloud placeholder ancestry rejected'
            Write-Output ('Verified actual cloud ancestor tag: 0x{0:X8}' -f $tag)
            $cloudAncestors++
        }
    }
    $ancestor = Split-Path $ancestor -Parent
}
Write-Output "Actual cloud placeholder ancestors checked: $cloudAncestors"
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
Assert ((Get-Content "$install/active.json" -Raw | ConvertFrom-Json).executable -ceq 'versions/v1/bin/ToneScope.exe') 'Activation path was not derived from verified tree'
$receiptPath = "$install/versions/v2/manifest.json"
$originalReceipt = Get-Content $receiptPath -Raw
$receipt = $originalReceipt | ConvertFrom-Json
$receipt.version = 'unverified'
$receipt | ConvertTo-Json -Depth 5 | Set-Content $receiptPath
$activeBefore = Get-Content "$install/active.json" -Raw
Reject { & "$PSScriptRoot/install-dev.ps1" -PackageRoot $v2 -InstallRoot $install -ActivateVersion v2 } 'Mismatched receipt identity accepted'
Assert ((Get-Content "$install/active.json" -Raw) -ceq $activeBefore) 'Failed identity check changed active version'
$originalReceipt | Set-Content $receiptPath
$receipt = $originalReceipt | ConvertFrom-Json
$receipt.files[0].path = 'bin/other.exe'
Copy-Item -LiteralPath "$install/versions/v2/bin/ToneScope.exe" -Destination "$install/versions/v2/bin/other.exe"
$receipt | ConvertTo-Json -Depth 5 | Set-Content $receiptPath
Reject { & "$PSScriptRoot/install-dev.ps1" -PackageRoot $v2 -InstallRoot $install -ActivateVersion v2 } 'Unowned executable activated'
Assert ((Get-Content "$install/active.json" -Raw) -ceq $activeBefore) 'Failed ownership check changed active version'
$originalReceipt | Set-Content $receiptPath
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
Reject { Get-SafePath $temp 'junction/bin/ToneScope.exe' } 'Junction below supplied root accepted'
$ancestorTarget = Join-Path $temp 'ancestor-target'
New-Item -ItemType Directory -Path "$ancestorTarget/ordinary-child" -Force | Out-Null
Copy-Item -LiteralPath "$v2/bin" -Destination "$ancestorTarget/ordinary-child" -Recurse
Copy-Item -LiteralPath "$v2/manifest.json" -Destination "$ancestorTarget/ordinary-child"
$ancestorLink = Join-Path $temp 'ancestor-junction'
New-Item -ItemType Junction -Path $ancestorLink -Target $ancestorTarget | Out-Null
$nestedRoot = "$ancestorLink/ordinary-child"
Reject { & "$PSScriptRoot/verify-package.ps1" -PackageRoot $nestedRoot } 'Package root below ancestor junction accepted'
Reject { & "$PSScriptRoot/install-dev.ps1" -PackageRoot $v2 -InstallRoot "$nestedRoot/install" } 'Install root below ancestor junction accepted'
Reject { & "$PSScriptRoot/diagnostics-dev.ps1" -PackageRoot $v2 -Output "$nestedRoot/report.json" } 'Diagnostic output below ancestor junction accepted'
Assert (-not (Test-Path "$ancestorTarget/ordinary-child/install")) 'Rejected install mutated junction target'
Assert (-not (Test-Path "$ancestorTarget/ordinary-child/report.json")) 'Rejected diagnostics mutated junction target'
$diag=Join-Path $temp 'diagnostics.json'
& "$PSScriptRoot/diagnostics-dev.ps1" -PackageRoot $v2 -Output $diag
$text=Get-Content $diag -Raw
Assert (-not $text.Contains($temp)) 'Private path leaked'
Assert (-not $text.Contains($env:USERPROFILE)) 'User profile leaked'
Reject { & "$PSScriptRoot/diagnostics-dev.ps1" -PackageRoot $v2 -Output $diag } 'Diagnostics overwritten'
Write-Output "PASS: $checks packaging/install/privacy checks; synthetic artifacts retained at $temp"
