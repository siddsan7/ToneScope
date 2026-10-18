param([string]$BuildRoot='build/windows-dev', [int]$Port=9337, [string]$Source, [switch]$Assistant)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid loopback test port'}
$app=(Resolve-Path (Join-Path $BuildRoot 'ToneScope_artefacts/Release/ToneScope.exe')).Path
$arguments=@('--web-ui-test','--web-debug-port',"$Port")
$oldData=$env:TONESCOPE_ASSISTANT_DATA_DIR
$env:TONESCOPE_ASSISTANT_DATA_DIR=Join-Path $root "artifacts/frontend-native/private-test-$([guid]::NewGuid().ToString('N'))"
if($Assistant){$env:TONESCOPE_TEST_ASSISTANT='1'}
if($Source){$arguments+=@('--source',('"'+(Resolve-Path -LiteralPath $Source).Path+'"'))}else{$arguments+='--demo'}
$child=Start-Process -FilePath $app -ArgumentList $arguments -WindowStyle Hidden -PassThru
try {
    $ready=$false
    for($attempt=0;$attempt -lt 80;$attempt++){
        if($child.HasExited){throw 'Native UI test process exited before WebView startup'}
        try {$targets=Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 1;if(@($targets | Where-Object type -eq 'page').Count){$ready=$true;break}}catch{}
        Start-Sleep -Milliseconds 250
    }
    if(-not $ready){throw 'Embedded WebView2 did not expose its explicit test endpoint'}
    $env:TONESCOPE_WEB_DEBUG_PORT="$Port"
    node tests/ui/embedded-native.mjs
    if($LASTEXITCODE -ne 0){throw 'Embedded native bridge probe failed'}
    $identity=@{schema_version=1; desktop_sha256=(Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant(); hardware_opened=$false; scope='Actual embedded React/native software probe; no physical audio or human accessibility qualification'}
    $identity | ConvertTo-Json | Set-Content artifacts/frontend-native/binary-identity.json
} finally {
    Remove-Item Env:TONESCOPE_WEB_DEBUG_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:TONESCOPE_TEST_ASSISTANT -ErrorAction SilentlyContinue
    if($null -ne $oldData){$env:TONESCOPE_ASSISTANT_DATA_DIR=$oldData}else{Remove-Item Env:TONESCOPE_ASSISTANT_DATA_DIR -ErrorAction SilentlyContinue}
    if(-not $child.HasExited -and $child.Path -eq $app){$null=$child.CloseMainWindow();if(-not $child.WaitForExit(5000)){Stop-Process -Id $child.Id}}
}
