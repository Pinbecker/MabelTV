param(
    [string]$MediaFile,
    [string]$MediaRoot,
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
    if (-not $MediaRoot) {
        $MediaRoot = & (Join-Path $PSScriptRoot 'generate-dev-library.ps1')
    }
    $arguments += @(
        '--channels', (Join-Path $repositoryRoot 'config\examples\channels.json'),
        '--settings', (Join-Path $repositoryRoot 'config\examples\settings.json'),
        '--media-root', ([System.IO.Path]::GetFullPath($MediaRoot)),
        '--state', (Join-Path $repositoryRoot 'dev-data\state.json'),
        '--log-dir', (Join-Path $repositoryRoot 'dev-data\logs')
    )
}
if ($Fullscreen) {
    $arguments += '--fullscreen'
}

& $application @arguments
