param(
    [string]$MediaRoot,
    [string]$ChannelsFile,
    [switch]$Strict,
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'toolchain.ps1')
$toolchainRoot = Enter-MabelTvToolchain
$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

if (-not $NoBuild) {
    & (Join-Path $PSScriptRoot 'build.ps1') -Preset windows-debug
}
if (-not $MediaRoot) {
    $MediaRoot = Join-Path ([Environment]::GetFolderPath('MyVideos')) 'MabelTV'
}
if (-not $ChannelsFile) {
    $ChannelsFile = Join-Path $repositoryRoot 'config\examples\channels.json'
}

$application = Join-Path $repositoryRoot 'out\build\windows-debug\mabeltv_media_check.exe'
$arguments = @(
    '--channels', ([System.IO.Path]::GetFullPath($ChannelsFile)),
    '--media-root', ([System.IO.Path]::GetFullPath($MediaRoot)),
    '--cache', (Join-Path $repositoryRoot 'dev-data\media-index.json')
)
if ($Strict) {
    $arguments += '--strict'
}

& $application @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Media validation reported exit code $LASTEXITCODE."
}
