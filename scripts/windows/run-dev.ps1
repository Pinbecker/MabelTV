param(
    [string]$MediaFile,
    [switch]$Fullscreen,
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

$application = Join-Path $repositoryRoot 'out\build\windows-debug\mabeltv.exe'
$arguments = @()
if ($MediaFile) {
    $arguments += [System.IO.Path]::GetFullPath($MediaFile)
} else {
    $mediaRoot = & (Join-Path $PSScriptRoot 'generate-dev-library.ps1')
    $arguments += @(
        '--channels', (Join-Path $repositoryRoot 'config\examples\channels.json'),
        '--settings', (Join-Path $repositoryRoot 'config\examples\settings.json'),
        '--media-root', $mediaRoot,
        '--state', (Join-Path $repositoryRoot 'dev-data\state.json'),
        '--log-dir', (Join-Path $repositoryRoot 'dev-data\logs')
    )
}
if ($Fullscreen) {
    $arguments += '--fullscreen'
}

& $application @arguments
