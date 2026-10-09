[CmdletBinding()]
param(
    [string]$Output
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$drive = $sourceRoot.Substring(0, 1).ToLowerInvariant()
$tail = $sourceRoot.Substring(3).Replace('\', '/')
$wslSourceRoot = "/mnt/$drive/$tail"
$arguments = @('-d', 'Ubuntu', '--cd', $wslSourceRoot, '--', 'bash', 'scripts/imaging/build-local-pi-image.sh')
if ($Output) {
    $resolvedOutput = [System.IO.Path]::GetFullPath($Output)
    [System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
    $outputDrive = $resolvedOutput.Substring(0, 1).ToLowerInvariant()
    $outputTail = $resolvedOutput.Substring(3).Replace('\', '/')
    $arguments += @('--output', "/mnt/$outputDrive/$outputTail")
}

& wsl.exe @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
