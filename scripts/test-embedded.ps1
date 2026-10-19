param([string]$BuildRoot='build/windows-dev', [int]$Port=9337, [string]$Source, [switch]$Assistant, [switch]$SelectionSummary, [switch]$MetricsOnly, [string]$Executable,
      [string]$InstanceId=([guid]::NewGuid().ToString('N')))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid loopback test port'}
if($InstanceId -cnotmatch '^[0-9a-f]{32}$'){throw 'Invalid UI test instance identifier'}
$portProbe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
$portProbe.ExclusiveAddressUse=$true
try{$portProbe.Start()}catch{throw "UI test port $Port is already in use"}finally{$portProbe.Stop()}
$app=if($Executable){(Resolve-Path -LiteralPath $Executable).Path}else{(Resolve-Path (Join-Path $BuildRoot 'ToneScope_artefacts/Release/ToneScope.exe')).Path}
$arguments=@('--web-ui-test','--web-debug-port',"$Port",'--ui-test-instance',$InstanceId)
$oldData=$env:TONESCOPE_ASSISTANT_DATA_DIR
$oldAssistant=$env:TONESCOPE_TEST_ASSISTANT
$oldDebugPort=$env:TONESCOPE_WEB_DEBUG_PORT
$oldMetricsOnly=$env:TONESCOPE_TEST_METRICS_ONLY
$child=$null
try {
if($MetricsOnly -and (-not $Assistant -or $Source)){throw 'MetricsOnly requires Assistant and the generated test source'}
if($MetricsOnly){$env:TONESCOPE_TEST_METRICS_ONLY='1'}else{Remove-Item Env:TONESCOPE_TEST_METRICS_ONLY -ErrorAction SilentlyContinue}
$env:TONESCOPE_ASSISTANT_DATA_DIR=Join-Path $root "artifacts/frontend-native/private-test-$([guid]::NewGuid().ToString('N'))"
if($Assistant){$env:TONESCOPE_TEST_ASSISTANT='1'}
if($Assistant -and -not $Source){
    $null=New-Item -ItemType Directory -Force $env:TONESCOPE_ASSISTANT_DATA_DIR
    $Source=Join-Path $env:TONESCOPE_ASSISTANT_DATA_DIR 'ui-source.wav'
    # The existing passage assertions require a known soft/hard contrast.
    $frames=if($MetricsOnly){5808000}else{192000}
    $softFrames=if($MetricsOnly){288000}else{96000}
    python -c "import math,sys; from pathlib import Path; sys.path.insert(0,'evals'); from oracles import write_float_wav; frames,soft=int(sys.argv[2]),int(sys.argv[3]); write_float_wav(Path(sys.argv[1]), [[(.02 if n<soft else .2)*math.sin(2*math.pi*220*n/48000) for n in range(frames)]]*2)" $Source $frames $softFrames
    if($LASTEXITCODE -ne 0){throw 'Cannot generate the deterministic UI smoke source'}
}
if($Source){$arguments+=@('--source',('"'+(Resolve-Path -LiteralPath $Source).Path+'"'))}else{$arguments+='--demo'}
$child=Start-Process -FilePath $app -ArgumentList $arguments -WindowStyle Hidden -PassThru
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
    if($SelectionSummary){
        node tests/ui/selection-summary-native.mjs
        if($LASTEXITCODE -ne 0){throw 'Embedded selection-summary probe failed'}
    }
    $identity=@{schema_version=1; desktop_sha256=(Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant(); instance_id=$InstanceId; hardware_opened=$false; scope='Actual embedded React/native software probe; no physical audio or human accessibility qualification'}
    if($Source){$identity.source_sha256=(Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant()}
    $identity | ConvertTo-Json | Set-Content artifacts/frontend-native/binary-identity.json
} finally {
    if($null -ne $oldMetricsOnly){$env:TONESCOPE_TEST_METRICS_ONLY=$oldMetricsOnly}else{Remove-Item Env:TONESCOPE_TEST_METRICS_ONLY -ErrorAction SilentlyContinue}
    if($null -ne $oldDebugPort){$env:TONESCOPE_WEB_DEBUG_PORT=$oldDebugPort}else{Remove-Item Env:TONESCOPE_WEB_DEBUG_PORT -ErrorAction SilentlyContinue}
    if($null -ne $oldAssistant){$env:TONESCOPE_TEST_ASSISTANT=$oldAssistant}else{Remove-Item Env:TONESCOPE_TEST_ASSISTANT -ErrorAction SilentlyContinue}
    if($null -ne $oldData){$env:TONESCOPE_ASSISTANT_DATA_DIR=$oldData}else{Remove-Item Env:TONESCOPE_ASSISTANT_DATA_DIR -ErrorAction SilentlyContinue}
    if($child -and -not $child.HasExited -and $child.Path -eq $app){$null=$child.CloseMainWindow();if(-not $child.WaitForExit(5000)){Stop-Process -Id $child.Id}}
}
