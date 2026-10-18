param([string]$Faust = (Join-Path $PSScriptRoot '../../.tools/faust/bin/faust.exe'))
$ErrorActionPreference = 'Stop'
$version = (& $Faust -v | Out-String)
if ($LASTEXITCODE -ne 0 -or $version -notmatch '2\.88\.0') { throw 'Faust 2.88.0 is required' }
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('ToneScopeDrive-' + [guid]::NewGuid() + '.h')
try {
    & $Faust -lang cpp -light -cn ToneScopeDrive -o $temporary (Join-Path $PSScriptRoot 'drive.dsp')
    if ($LASTEXITCODE -ne 0) { throw 'Faust generation failed' }
    $expected = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../generated/ToneScopeDrive.h')).Replace("`r`n", "`n")
    $actual = [IO.File]::ReadAllText($temporary).Replace("`r`n", "`n")
    if ($actual -cne $expected) { throw 'Generated DSP differs from checked-in header' }
    Write-Output 'Faust 2.88.0 source-to-generated verification passed'
} finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
