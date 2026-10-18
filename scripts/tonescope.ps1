param([Parameter(Position=0,Mandatory=$true)][string]$Command, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $root 'build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe'
if ($Command -eq 'eval') {
  python (Join-Path $root 'evals/run.py') --cli $cli @Arguments
} elseif ($Command -eq 'report' -or $Command -eq 'release-check') {
  python (Join-Path $root 'evals/run.py') $Command @Arguments
} elseif ($Command -eq 'qualify') {
  Write-Error 'Physical qualification requires the protocol in qualification/; software cannot certify device timing.'
  exit 2
} else {
  if (!(Test-Path $cli)) { throw 'Renderer not built; build with CMake windows-dev preset first.' }
  & $cli $Command @Arguments
}
exit $LASTEXITCODE
