param(
    [Parameter(Mandatory = $false)]
    [string]$Manifest = (Join-Path $PSScriptRoot 'KidsTV.rpi-imager-manifest'),
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
# Local packages remain portable: their manifest may have been made in WSL,
# downloaded, or moved to another drive. Resolve local assets beside it.
$repository = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$folder = Split-Path -Parent $manifestPath
foreach ($entry in $repository.os_list) {
    foreach ($property in @('url', 'icon')) {
        $assetUri = [Uri]$entry.$property
        if ($assetUri.IsFile) {
            $filename = [System.IO.Path]::GetFileName($assetUri.LocalPath)
            $asset = (Resolve-Path -LiteralPath (Join-Path $folder $filename)).Path
            $entry.$property = ([Uri]$asset).AbsoluteUri
            if ($property -eq 'url') {
                Write-Host 'Checking the SD-card image...'
                $hasher = [System.Security.Cryptography.SHA256]::Create()
                $stream = [System.IO.File]::OpenRead($asset)
                try { $actualHash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
                finally { $stream.Dispose(); $hasher.Dispose() }
                if ($actualHash -ne $entry.image_download_sha256) {
                    throw 'The SD-card image failed its checksum. Recopy the complete installer folder.'
                }
            }
        }
    }
}
$resolvedManifest = Join-Path ([System.IO.Path]::GetTempPath()) 'MabelTV-local-imager.json'
[System.IO.File]::WriteAllText($resolvedManifest, ($repository | ConvertTo-Json -Depth 12),
    [System.Text.UTF8Encoding]::new($false))
if ($PrepareOnly) { Write-Output $resolvedManifest; return }
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

Start-Process -FilePath $candidates[0] -ArgumentList @('--repo', ('"' + $resolvedManifest + '"'))
