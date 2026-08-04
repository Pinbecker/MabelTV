param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'toolchain.ps1')
$toolchainRoot = Enter-MabelTvToolchain
$ffmpeg = Join-Path $toolchainRoot 'ucrt64\bin\ffmpeg.exe'
$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

if (-not $OutputPath) {
    $OutputPath = Join-Path $repositoryRoot 'dev-data\media\milestone-0\test-pattern.mp4'
}

$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path $OutputPath -Parent
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& $ffmpeg -hide_banner -loglevel warning -y `
    -f lavfi -i 'testsrc2=size=640x480:rate=25' `
    -f lavfi -i 'sine=frequency=440:sample_rate=48000' `
    -t 8 `
    -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p `
    -c:a aac -b:a 128k -shortest `
    $OutputPath

if ($LASTEXITCODE -ne 0) {
    throw "Generating the synthetic test video failed with exit code $LASTEXITCODE."
}

Write-Output $OutputPath

