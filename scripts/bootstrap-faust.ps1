$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$lock=Get-Content (Join-Path $root 'dependencies.lock.json') -Raw | ConvertFrom-Json
$archive=Join-Path $root ".tools/Faust-$($lock.faust.version)-win64.exe"
$compiler=Join-Path $root '.tools/faust/bin/faust.exe'
New-Item -ItemType Directory -Force (Join-Path $root '.tools') | Out-Null
if(-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $lock.faust.url -OutFile $archive }
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $lock.faust.windows_installer_sha256){throw 'Faust archive differs from dependency lock'}
if(-not (Test-Path -LiteralPath $compiler)) {
    $extractor=Get-Command 7z -ErrorAction SilentlyContinue
    if($extractor){$sevenZip=$extractor.Source}else{$sevenZip=Join-Path $root '.tools/7zip/7z.exe'}
    if(-not (Test-Path -LiteralPath $sevenZip)){throw '7-Zip is required to extract the pinned NSIS archive without running its installer'}
    & $sevenZip x $archive ("-o"+(Join-Path $root '.tools/faust')) -y | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Pinned Faust extraction failed'}
}
$previousLibraries=$env:FAUST_LIB_PATH
try {
    $env:FAUST_LIB_PATH=Join-Path $root '.tools/faust/share/faust'
    & (Join-Path $root 'dsp/faust/verify-generated.ps1') -Faust $compiler
    if($LASTEXITCODE -ne 0){throw 'Generated Faust verification failed'}
} finally {
    if($null -ne $previousLibraries){$env:FAUST_LIB_PATH=$previousLibraries}else{Remove-Item Env:FAUST_LIB_PATH -ErrorAction SilentlyContinue}
}
