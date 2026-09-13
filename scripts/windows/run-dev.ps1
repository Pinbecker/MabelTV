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
    $database = Join-Path $repositoryRoot 'dev-data\mabeltv.db'
    $stateTool = Join-Path $repositoryRoot 'scripts\pi\mabeltv-state-migrate.py'
    if (Test-Path -LiteralPath $database) {
        & python $stateTool upgrade --database $database | Out-Null
    } else {
        & python $stateTool bootstrap `
            --database $database `
            --channels (Join-Path $repositoryRoot 'config\examples\channels.json') `
            --settings (Join-Path $repositoryRoot 'config\examples\settings.json') | Out-Null
    }
    $arguments += @(
        '--media-root', ([System.IO.Path]::GetFullPath($MediaRoot)),
        '--database', $database,
        '--log-dir', (Join-Path $repositoryRoot 'dev-data\logs')
    )
}
if ($Fullscreen) {
    $arguments += '--fullscreen'
}

& $application @arguments
