Set-StrictMode -Version Latest

function Get-MabelTvMsysRoot {
    $candidates = @()
    if ($env:MABELTV_MSYS2_ROOT) {
        $candidates += $env:MABELTV_MSYS2_ROOT
    }

    $candidates += @(
        (Join-Path $env:USERPROFILE 'Tools\msys64-mabeltv'),
        'C:\msys64'
    )

    foreach ($candidate in $candidates) {
        $ucrtBin = Join-Path $candidate 'ucrt64\bin'
        if ((Test-Path -LiteralPath (Join-Path $ucrtBin 'cmake.exe')) -and
            (Test-Path -LiteralPath (Join-Path $ucrtBin 'g++.exe')) -and
            (Test-Path -LiteralPath (Join-Path $ucrtBin 'libmpv-2.dll'))) {
            return $candidate
        }
    }

    throw @'
Mabel TV's MSYS2 UCRT64 toolchain was not found.
Set MABELTV_MSYS2_ROOT or install the documented Windows prerequisites.
'@
}

function Enter-MabelTvToolchain {
    $root = Get-MabelTvMsysRoot
    $ucrtBin = Join-Path $root 'ucrt64\bin'
    $env:MABELTV_MSYS2_ROOT = $root
    $env:PATH = "$ucrtBin;$env:PATH"
    $env:PKG_CONFIG_PATH = Join-Path $root 'ucrt64\lib\pkgconfig'
    return $root
}
