param(
    [Parameter(Mandatory = $false)]
    [string]$Manifest = (Join-Path $PSScriptRoot 'KidsTV.rpi-imager-manifest')
)

$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$candidates = @(
    @(
        (Get-Command rpi-imager.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        (Join-Path $env:ProgramFiles 'Raspberry Pi Ltd\Imager\rpi-imager.exe'),
        (Join-Path $env:ProgramFiles 'Raspberry Pi Imager\rpi-imager.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Raspberry Pi Ltd\Imager\rpi-imager.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Raspberry Pi Imager\rpi-imager.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
)

if (-not $candidates) {
    throw 'Raspberry Pi Imager is not installed. Install it from https://www.raspberrypi.com/software/ and run this file again.'
}

Start-Process -FilePath $candidates[0] -ArgumentList @('--repo', $manifestPath)
