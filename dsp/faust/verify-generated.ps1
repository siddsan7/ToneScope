param([string]$Faust = (Join-Path $PSScriptRoot '../../.tools/faust/bin/faust.exe'))
$ErrorActionPreference = 'Stop'
$version = (& $Faust -v | Out-String)
if ($LASTEXITCODE -ne 0 -or $version -notmatch '\b2\.88\.0\b') { throw 'Faust 2.88.0 is required' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$manifest = Get-Content -Raw (Join-Path $PSScriptRoot '../generated/manifest.json') | ConvertFrom-Json
if ($manifest.version -ne '2.88.0') { throw 'Unexpected manifest compiler version' }
function NormalizedText([string]$path) { return [IO.File]::ReadAllText($path).Replace("`r`n", "`n") }
function TextHash([string]$value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
foreach ($graph in $manifest.graphs) {
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('ToneScopeFaust-' + [guid]::NewGuid() + '.h')
    try {
        $source = Join-Path $root $graph.source
        $expected = NormalizedText (Join-Path $root $graph.output)
        if ((TextHash (NormalizedText $source)) -cne $graph.sourceSha256) { throw "Source hash differs: $($graph.source)" }
        if ((TextHash $expected) -cne $graph.outputSha256) { throw "Output hash differs: $($graph.output)" }
        $arguments = @($graph.arguments)
        & $Faust @arguments -o $temporary $source
        if ($LASTEXITCODE -ne 0) { throw "Faust generation failed: $($graph.source)" }
        if ((NormalizedText $temporary) -cne $expected) { throw "Generated DSP differs: $($graph.output)" }
        Write-Output "Verified $($graph.output)"
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
Write-Output 'Faust 2.88.0 source-to-generated and manifest hash verification passed'
