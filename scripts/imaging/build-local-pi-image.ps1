[CmdletBinding()]
param(
    [string]$Output
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$drive = $sourceRoot.Substring(0, 1).ToLowerInvariant()
$tail = $sourceRoot.Substring(3).Replace('\', '/')
$wslSourceRoot = "/mnt/$drive/$tail"
$command = "cd `"$wslSourceRoot`" && bash scripts/imaging/build-local-pi-image.sh"
if ($Output) {
    $resolvedOutput = (Resolve-Path $Output).Path
    $outputDrive = $resolvedOutput.Substring(0, 1).ToLowerInvariant()
    $outputTail = $resolvedOutput.Substring(3).Replace('\', '/')
    $command += " --output `"/mnt/$outputDrive/$outputTail`""
}

& wsl.exe -d Ubuntu -- bash -lc $command
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
