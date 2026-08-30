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
        $remoteDirectory = (Split-Path $relativePath -Parent).Replace('\', '/')
        ssh $PiHost "mkdir -p '$PiSourceRoot/$remoteDirectory'"
        if ($LASTEXITCODE) { throw "Could not create the destination directory on the Pi: $remoteDirectory" }
        & scp $relativePath "${PiHost}:${PiSourceRoot}/${remoteDirectory}/"
        if ($LASTEXITCODE) { throw "Copy to the Pi failed: $relativePath" }
    }

    $needsPlayerBuild = $All -or ($changed | Where-Object { $_ -match '^(CMakeLists\.txt|src/|qml/|shaders/)' })
    $needsLibraryRestart = $All -or ($changed | Where-Object { $_ -match '^(scripts/pi/(mabeltv-library\.(py|html)|mabeltv-offline\.js|service-worker\.js|hls\.min\.js|mabeltv-manifest\.json|mabeltv-icon\.png|apple-touch-icon\.png|icons/|portal/)|packaging/linux/mabeltv-library\.service$)' })
    $needsAdminHelper = $All -or ($changed | Where-Object { $_ -eq 'packaging/linux/mabeltv-admin-action' })

    if ($needsPlayerBuild) {
        ssh $PiHost "cmake -S '$PiSourceRoot' -B '$PiSourceRoot/out/dev-pi' -G Ninja -DMABELTV_PI_APPLIANCE=ON && cmake --build '$PiSourceRoot/out/dev-pi' --parallel 1 && sudo install -m 0755 '$PiSourceRoot/out/dev-pi/mabeltv' /opt/mabeltv/current/mabeltv && sudo systemctl restart mabeltv.service"
        if ($LASTEXITCODE) { throw 'The incremental MabelTV player build or restart failed on the Pi.' }
    }
    if ($needsAdminHelper) {
        ssh $PiHost "sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends psmisc sg3-utils && sudo install -m 0755 '$PiSourceRoot/packaging/linux/mabeltv-admin-action' /usr/local/libexec/mabeltv-admin-action"
        if ($LASTEXITCODE) { throw 'The MabelTV USB power helper update failed on the Pi.' }
    }
    if ($needsLibraryRestart) {
        ssh $PiHost "sudo install -m 0755 '$PiSourceRoot/scripts/pi/mabeltv-library.py' /opt/mabeltv/current/mabeltv-library && sudo install -m 0644 '$PiSourceRoot/scripts/pi/mabeltv-library.html' /opt/mabeltv/current/mabeltv-library.html && sudo install -m 0644 '$PiSourceRoot/scripts/pi/hls.min.js' /opt/mabeltv/current/hls.min.js && sudo install -m 0644 '$PiSourceRoot/scripts/pi/mabeltv-offline.js' /opt/mabeltv/current/mabeltv-offline.js && sudo install -m 0644 '$PiSourceRoot/scripts/pi/service-worker.js' /opt/mabeltv/current/service-worker.js && sudo install -m 0644 '$PiSourceRoot/scripts/pi/mabeltv-icon.png' /opt/mabeltv/current/mabeltv-icon.png && sudo install -m 0644 '$PiSourceRoot/scripts/pi/apple-touch-icon.png' /opt/mabeltv/current/apple-touch-icon.png && sudo install -m 0644 '$PiSourceRoot/scripts/pi/mabeltv-manifest.json' /opt/mabeltv/current/mabeltv-manifest.json && sudo install -d -m 0755 /opt/mabeltv/current/icons /opt/mabeltv/current/portal && sudo cp -a '$PiSourceRoot/scripts/pi/portal/.' /opt/mabeltv/current/portal/ && sudo find /opt/mabeltv/current/portal -type d -exec chmod 0755 '{}' + && sudo find /opt/mabeltv/current/portal -type f -exec chmod 0644 '{}' + && sudo install -m 0644 '$PiSourceRoot/scripts/pi/icons/icon-192.png' /opt/mabeltv/current/icons/icon-192.png && sudo install -m 0644 '$PiSourceRoot/scripts/pi/icons/icon-512.png' /opt/mabeltv/current/icons/icon-512.png && sudo install -m 0644 '$PiSourceRoot/packaging/linux/mabeltv-library.service' /etc/systemd/system/mabeltv-library.service && sudo systemctl daemon-reload && sudo systemctl restart mabeltv-library.service"
        if ($LASTEXITCODE) { throw 'The MabelTV Library update or restart failed on the Pi.' }
    }
    ssh $PiHost 'systemctl is-active mabeltv.service mabeltv-library.service'
    if ($LASTEXITCODE) { throw 'One or more MabelTV services are not active on the Pi.' }
    Write-Host 'Fast developer deploy complete. Do not use this route for a customer release or SD-card image.'
} finally { Pop-Location }
