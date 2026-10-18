param([Parameter(Mandatory)][string]$PackageRoot, [Parameter(Mandatory)][string]$Output)
. "$PSScriptRoot/PackageSafety.ps1"
$manifest = Read-PackageManifest $PackageRoot
$checks = foreach ($file in $manifest.files) {
    $path = Get-SafePath $PackageRoot $file.path
    @{component=$file.path; hash_matches=((Test-Path -LiteralPath $path -PathType Leaf) -and ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ieq $file.sha256))}
}
$report = @{schema_version=1; product=$manifest.product; version=$manifest.version; os_version=[Environment]::OSVersion.Version.ToString(); process_architecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString(); package_checks=@($checks); qualification='development only'; privacy='No environment variables, user paths, logs, audio, session data, dumps or keys collected'}
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Diagnostics output already exists' }
$null = Get-SafePath (Split-Path $outputPath -Parent) (Split-Path $outputPath -Leaf)
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Output 'Created explicit local redacted diagnostics report.'
