param([string]$BuildRoot='build/windows-dev', [string]$Output='artifacts/smoke/native.png',
      [switch]$CheckSingleton, [string]$Executable)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$app=if($Executable){(Resolve-Path -LiteralPath $Executable).Path}else{(Resolve-Path (Join-Path $BuildRoot 'ToneScope_artefacts/Release/ToneScope.exe')).Path}
$outputPath=if([IO.Path]::IsPathRooted($Output)){[IO.Path]::GetFullPath($Output)}else{[IO.Path]::GetFullPath((Join-Path $root $Output))}
if(Test-Path -LiteralPath $outputPath){throw 'Refusing an existing screenshot; choose a fresh output path'}
$null=New-Item -ItemType Directory -Force (Split-Path $outputPath -Parent)
$instance=[guid]::NewGuid().ToString('N')
$oldData=$env:TONESCOPE_ASSISTANT_DATA_DIR
$env:TONESCOPE_ASSISTANT_DATA_DIR=Join-Path (Split-Path $outputPath -Parent) "private-startup-$instance"
$child=$null
function Launch([string]$image) {
    # Quoted flags also exercise consistent identity/startup argument parsing.
    Start-Process -FilePath $app -ArgumentList @('--demo','"--screenshot"',('"'+$image+'"'),'--ui-test-instance',$instance) -WindowStyle Hidden -PassThru
}
function Finish($process) {
    if(-not $process.WaitForExit(30000)){throw 'Native startup timed out'}
    $process.Refresh()
    if($process.ExitCode -ne 0){throw "Native startup exited with code $($process.ExitCode)"}
}
try {
    if($CheckSingleton){
        $created=$false
        $mutex=[Threading.Mutex]::new($true,"Global\juceAppLock_ToneScope-ui-test-$instance",[ref]$created)
        try {
            if(-not $created){throw 'Singleton fixture unexpectedly already exists'}
            $rejectedPath=Join-Path (Split-Path $outputPath -Parent) "rejected-$instance.png"
            $child=Launch $rejectedPath
            Finish $child
            if(Test-Path -LiteralPath $rejectedPath){throw 'An owned singleton did not reject the duplicate probe'}
        } finally {
            if($created){$mutex.ReleaseMutex()}
            $mutex.Dispose()
        }
    }
    $child=Launch $outputPath
    Finish $child
    if(-not (Test-Path -LiteralPath $outputPath)){throw 'Native startup did not produce its screenshot'}
    $bytes=[IO.File]::ReadAllBytes($outputPath)
    if($bytes.Length -lt 24 -or [Convert]::ToHexString($bytes[0..7]) -cne '89504E470D0A1A0A'){throw 'Native startup produced an invalid PNG'}
    $width=[int]$bytes[16]*16777216+[int]$bytes[17]*65536+[int]$bytes[18]*256+[int]$bytes[19]
    $height=[int]$bytes[20]*16777216+[int]$bytes[21]*65536+[int]$bytes[22]*256+[int]$bytes[23]
    if($width -le 0 -or $height -le 0){throw 'Native screenshot has invalid dimensions'}
    $report=@{schema_version=1;status='pass';instance_id=$instance;same_instance_rejected=[bool]$CheckSingleton;
        desktop_sha256=(Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant();
        screenshot_sha256=(Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant();
        width=$width;height=$height;hardware_opened=$false;scope='Software startup and singleton check; no hardware or human qualification'}
    $report | ConvertTo-Json | Set-Content -LiteralPath "$outputPath.json"
    $report | ConvertTo-Json -Compress
} finally {
    if($child -and -not $child.HasExited -and $child.Path -eq $app){Stop-Process -Id $child.Id}
    if($null -ne $oldData){$env:TONESCOPE_ASSISTANT_DATA_DIR=$oldData}else{Remove-Item Env:TONESCOPE_ASSISTANT_DATA_DIR -ErrorAction SilentlyContinue}
}
