$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$folder=Join-Path $root "artifacts/ui-smoke-guards/$([guid]::NewGuid().ToString('N'))"
$null=New-Item -ItemType Directory -Force $folder
$checks=0
function Reject([scriptblock]$action,[string]$expected) {
    $rejected=$false
    try{& $action | Out-Null}catch{if($_.ToString() -notlike "*$expected*"){throw};$rejected=$true}
    if(-not $rejected){throw "Expected rejection: $expected"}
    $script:checks++
}
$variables=@('TONESCOPE_ASSISTANT_DATA_DIR','TONESCOPE_TEST_ASSISTANT','TONESCOPE_WEB_DEBUG_PORT')
$saved=@{}
foreach($key in $variables){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
try {
    $env:TONESCOPE_ASSISTANT_DATA_DIR='sentinel-data'
    $env:TONESCOPE_TEST_ASSISTANT='sentinel-assistant'
    $env:TONESCOPE_WEB_DEBUG_PORT='sentinel-port'
    Reject { & scripts/test-embedded.ps1 -Assistant -Source (Join-Path $folder 'missing.wav') } 'does not exist'
    if($env:TONESCOPE_ASSISTANT_DATA_DIR -cne 'sentinel-data' -or $env:TONESCOPE_TEST_ASSISTANT -cne 'sentinel-assistant' -or $env:TONESCOPE_WEB_DEBUG_PORT -cne 'sentinel-port'){throw 'Failed setup leaked environment changes'}
    $checks++
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start()
    try{Reject { & scripts/test-embedded.ps1 -Port $listener.LocalEndpoint.Port } 'already in use'}finally{$listener.Stop()}
    Reject { & scripts/test-embedded.ps1 -InstanceId '../unsafe' } 'Invalid UI test instance identifier'
    $existing=Join-Path $folder 'existing.png'
    'preserve' | Set-Content -LiteralPath $existing
    Reject { & scripts/test-startup.ps1 -Output $existing } 'Refusing an existing screenshot'
    if((Get-Content -LiteralPath $existing -Raw).Trim() -cne 'preserve'){throw 'Existing screenshot was replaced'}
    $checks++
    @{status='pass';checks=$checks;scope='Launch guard failures; no desktop launched'} | ConvertTo-Json | Set-Content (Join-Path $folder 'report.json')
    Write-Output "UI smoke guard regressions passed: $checks"
} finally {
    foreach($key in $variables){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}
}
