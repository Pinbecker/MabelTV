param(
    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'toolchain.ps1')
$toolchainRoot = Enter-MabelTvToolchain
$ffmpeg = Join-Path $toolchainRoot 'ucrt64\bin\ffmpeg.exe'
$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $repositoryRoot 'dev-data\media'
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

$episodes = @(
    @{ Path = 'kids-tv\kids-01.mp4'; Hue = 0; Frequency = 440 },
    @{ Path = 'kids-tv\kids-02.mp4'; Hue = 35; Frequency = 494 },
    @{ Path = 'cartoons\cartoon-01.mp4'; Hue = 90; Frequency = 523 },
    @{ Path = 'cartoons\cartoon-02.mp4'; Hue = 125; Frequency = 587 },
    @{ Path = 'films\film-01.mp4'; Hue = 180; Frequency = 659 },
    @{ Path = 'films\film-02.mp4'; Hue = 215; Frequency = 698 },
    @{ Path = 'family\family-01.mp4'; Hue = 260; Frequency = 349 },
    @{ Path = 'family\family-02.mp4'; Hue = 325; Frequency = 294 }
)

foreach ($episode in $episodes) {
    $outputPath = Join-Path $OutputRoot $episode.Path
    if (Test-Path -LiteralPath $outputPath) {
        continue
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $outputPath -Parent) | Out-Null
    $videoFilter = "hue=h=$($episode.Hue)"
    $audioSource = "sine=frequency=$($episode.Frequency):sample_rate=48000"
    & $ffmpeg -hide_banner -loglevel warning -y `
        -f lavfi -i 'testsrc2=size=640x480:rate=25' `
        -f lavfi -i $audioSource `
        -t 8 -vf $videoFilter `
        -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p `
        -c:a aac -b:a 96k -shortest `
        $outputPath

    if ($LASTEXITCODE -ne 0) {
        throw "Generating $outputPath failed with exit code $LASTEXITCODE."
    }
}

Write-Output $OutputRoot
