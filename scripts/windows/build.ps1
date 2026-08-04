param(
    [ValidateSet('windows-debug', 'windows-release')]
    [string]$Preset = 'windows-debug',
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'toolchain.ps1')
$toolchainRoot = Enter-MabelTvToolchain
$cmake = Join-Path $toolchainRoot 'ucrt64\bin\cmake.exe'
$ctest = Join-Path $toolchainRoot 'ucrt64\bin\ctest.exe'

& $cmake --preset $Preset
if ($LASTEXITCODE -ne 0) {
    throw "CMake configuration failed with exit code $LASTEXITCODE."
}

& $cmake --build --preset $Preset
if ($LASTEXITCODE -ne 0) {
    throw "The Mabel TV build failed with exit code $LASTEXITCODE."
}

if (-not $SkipTests -and $Preset -eq 'windows-debug') {
    & $ctest --preset windows-debug
    if ($LASTEXITCODE -ne 0) {
        throw "The Mabel TV tests failed with exit code $LASTEXITCODE."
    }
}

