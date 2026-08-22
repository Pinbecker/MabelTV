[CmdletBinding()]
param(
    [string]$PiHost = 'pinbecker@Mabel-TV.local',
    [string]$PiSourceRoot = '/home/pinbecker/MabelTV',
    [switch]$All,
    [switch]$AllowDirtyPiSource
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $repositoryRoot
try {
    $changed = if ($All) {
        git ls-files
    } else {
        @(git diff --name-only HEAD; git ls-files --others --exclude-standard) | Sort-Object -Unique
    }
    $changed = @($changed | Where-Object { $_ -and $_ -notmatch '^(out|dev-data|\.test-firstboot-run)/' })
    if (-not $changed) { Write-Host 'No saved changes to deploy.'; return }

    $remoteStatus = ssh $PiHost "git -C '$PiSourceRoot' status --porcelain"
    if ($LASTEXITCODE) { throw 'Could not inspect the Pi source checkout.' }
    if ($remoteStatus -and -not $AllowDirtyPiSource) {
        throw "The Pi source checkout has local changes. Review them first, or rerun with -AllowDirtyPiSource."
    }

    $copyable = @($changed | Where-Object { Test-Path -LiteralPath (Join-Path $repositoryRoot $_) -PathType Leaf })
    foreach ($relativePath in $copyable) {
        $remoteDirectory = (Split-Path $relativePath -Parent).Replace('\\', '/')
        ssh $PiHost "mkdir -p '$PiSourceRoot/$remoteDirectory'"
        if ($LASTEXITCODE) { throw "Could not create the destination directory on the Pi: $remoteDirectory" }
        & scp $relativePath "${PiHost}:${PiSourceRoot}/${remoteDirectory}/"
        if ($LASTEXITCODE) { throw "Copy to the Pi failed: $relativePath" }
    }

    $needsPlayerBuild = $All -or ($changed | Where-Object { $_ -match '^(CMakeLists\.txt|src/|qml/|shaders/)' })
    $needsLibraryRestart = $All -or ($changed | Where-Object { $_ -match '^scripts/pi/mabeltv-library\.(py|html)$' })

    if ($needsPlayerBuild) {
        ssh $PiHost "cmake -S '$PiSourceRoot' -B '$PiSourceRoot/out/dev-pi' -G Ninja -DMABELTV_PI_APPLIANCE=ON && cmake --build '$PiSourceRoot/out/dev-pi' --parallel 1 && sudo install -m 0755 '$PiSourceRoot/out/dev-pi/mabeltv' /opt/mabeltv/current/mabeltv && sudo systemctl restart mabeltv.service"
        if ($LASTEXITCODE) { throw 'The incremental MabelTV player build or restart failed on the Pi.' }
    }
    if ($needsLibraryRestart) {
        ssh $PiHost "sudo install -m 0755 '$PiSourceRoot/scripts/pi/mabeltv-library.py' /opt/mabeltv/current/mabeltv-library && sudo install -m 0644 '$PiSourceRoot/scripts/pi/mabeltv-library.html' /opt/mabeltv/current/mabeltv-library.html && sudo install -m 0644 '$PiSourceRoot/scripts/pi/mabeltv-icon.png' /opt/mabeltv/current/mabeltv-icon.png && sudo systemctl restart mabeltv-library.service"
        if ($LASTEXITCODE) { throw 'The MabelTV Library update or restart failed on the Pi.' }
    }
    ssh $PiHost 'systemctl is-active mabeltv.service mabeltv-library.service'
    if ($LASTEXITCODE) { throw 'One or more MabelTV services are not active on the Pi.' }
    Write-Host 'Fast developer deploy complete. Do not use this route for a customer release or SD-card image.'
} finally { Pop-Location }
