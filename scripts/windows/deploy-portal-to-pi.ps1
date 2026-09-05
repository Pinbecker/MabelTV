[CmdletBinding()]
param(
    [string]$PiHost = 'pinbecker@Mabel-TV.local',
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-CheckedExternal {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$ArgumentList,
        [Parameter(Mandatory)] [string]$FailureMessage
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

function Invoke-CapturedExternal {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$ArgumentList,
        [Parameter(Mandatory)] [string]$FailureMessage
    )
    $output = @(& $FilePath @ArgumentList)
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
    return $output
}

function Get-PortalTarget {
    param([Parameter(Mandatory)] [string]$RepositoryPath)

    if ($RepositoryPath.StartsWith('scripts/pi/portal/')) {
        return $RepositoryPath.Substring('scripts/pi/'.Length)
    }
    $topLevelAssets = @{
        'scripts/pi/mabeltv-library.html' = 'mabeltv-library.html'
        'scripts/pi/mabeltv-library-classic.html' = 'mabeltv-library-classic.html'
        'scripts/pi/mabeltv-offline.js' = 'mabeltv-offline.js'
        'scripts/pi/service-worker.js' = 'service-worker.js'
        'scripts/pi/hls.min.js' = 'hls.min.js'
        'scripts/pi/mabeltv-manifest.json' = 'mabeltv-manifest.json'
        'scripts/pi/mabeltv-icon.png' = 'mabeltv-icon.png'
        'scripts/pi/apple-touch-icon.png' = 'apple-touch-icon.png'
        'scripts/pi/icons/icon-192.png' = 'icons/icon-192.png'
        'scripts/pi/icons/icon-512.png' = 'icons/icon-512.png'
    }
    return $topLevelAssets[$RepositoryPath]
}

function Assert-SafeRelativePath {
    param([Parameter(Mandatory)] [string]$Path)
    if ($Path -notmatch '^[A-Za-z0-9._/-]+$' -or $Path.Contains('..') -or $Path.StartsWith('/')) {
        throw "Unsafe deployment path: $Path"
    }
}

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$remoteStaging = $null
$remoteBackup = $null
$activeRelease = $null
$backupReady = $false
$targets = @()

Push-Location $repositoryRoot
try {
    $trackedChanges = Invoke-CapturedExternal git @(
        'diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD'
    ) 'Could not inspect tracked working-tree changes.'
    $untrackedChanges = Invoke-CapturedExternal git @(
        'ls-files', '--others', '--exclude-standard'
    ) 'Could not inspect untracked working-tree files.'
    $changed = @($trackedChanges + $untrackedChanges |
        Where-Object { $_ } | Sort-Object -Unique)

    if (-not $changed) {
        Write-Host 'No saved local changes are waiting for a portal deployment.'
        return
    }

    $deleted = Invoke-CapturedExternal git @(
        'diff', '--name-only', '--diff-filter=D', 'HEAD'
    ) 'Could not inspect deleted working-tree files.'
    $deletedPortal = @($deleted | Where-Object { Get-PortalTarget $_ })
    if ($deletedPortal) {
        throw "Portal quick deploy will not delete live files. Use a reviewed full deployment for: $($deletedPortal -join ', ')"
    }

    $snapshotChanges = @($changed | Where-Object {
        $_ -match '^tests/browser/.+-snapshots/.+\.png$'
    })
    if ($snapshotChanges) {
        throw 'Frozen browser screenshots changed. Review that visual change before deploying.'
    }

    $mixedNativeChanges = @($changed | Where-Object {
        $_ -match '^(CMakeLists\.txt|src/|qml/|shaders/|packaging/linux/)'
    })
    if ($mixedNativeChanges) {
        throw "Native or packaging changes are present. Keep this portal checkpoint separate: $($mixedNativeChanges -join ', ')"
    }

    $unsupportedServiceChanges = @($changed | Where-Object {
        $_ -match '^scripts/pi/(mabeltv-library\.py|mabeltv_backend/)'
    })
    if ($unsupportedServiceChanges) {
        throw "This fast path intentionally excludes Library backend code. Use the broader verified deployment for: $($unsupportedServiceChanges -join ', ')"
    }

    foreach ($repositoryPath in $changed) {
        $target = Get-PortalTarget $repositoryPath
        if (-not $target) { continue }
        Assert-SafeRelativePath $repositoryPath
        Assert-SafeRelativePath $target
        if (-not (Test-Path -LiteralPath $repositoryPath -PathType Leaf)) {
            throw "Portal source file is missing: $repositoryPath"
        }
        $targets += [pscustomobject]@{
            RepositoryPath = $repositoryPath
            Target = $target
        }
    }

    if (-not $targets) {
        Write-Host 'No portal runtime files changed; nothing needs deploying to the Pi.'
        return
    }

    $shellChanged = @($targets | Where-Object {
        $_.RepositoryPath -ne 'scripts/pi/service-worker.js'
    })
    $workerChanged = @($targets | Where-Object {
        $_.RepositoryPath -eq 'scripts/pi/service-worker.js'
    })
    if ($shellChanged -and -not $workerChanged) {
        throw 'The installed PWA shell changed without a service-worker cache revision. Increment SHELL_CACHE first.'
    }

    Write-Host 'Portal quick-deploy plan:'
    $targets | ForEach-Object {
        Write-Host "  $($_.RepositoryPath) -> /opt/mabeltv/current/$($_.Target)"
    }
    if ($PlanOnly) {
        Write-Host 'Plan only: no tests, network copies, service restarts, commits, or pushes were performed.'
        return
    }

    Invoke-CheckedExternal git @('diff', '--check') 'Whitespace validation failed.'
    foreach ($script in $targets | Where-Object { $_.RepositoryPath.EndsWith('.js') }) {
        Invoke-CheckedExternal node @('--check', $script.RepositoryPath) "JavaScript validation failed: $($script.RepositoryPath)"
    }
    Invoke-CheckedExternal python @(
        '-m', 'unittest', 'tests.python.test_architecture_guardrails'
    ) 'Architecture guardrails failed.'

    Push-Location (Join-Path $repositoryRoot 'tests/browser')
    try {
        Invoke-CheckedExternal npx @('playwright', 'test', 'portal.spec.mjs') 'Portal browser tests failed.'
    } finally {
        Pop-Location
    }

    $activeLines = Invoke-CapturedExternal ssh @(
        '-o', 'ConnectTimeout=20', $PiHost, 'readlink -f /opt/mabeltv/current'
    ) 'Could not resolve the active Pi release.'
    $activeRelease = ($activeLines | Select-Object -Last 1).Trim()
    if ($activeRelease -notmatch '^/opt/mabeltv/releases/[A-Za-z0-9._-]+$') {
        throw "Refusing an unexpected active release path: $activeRelease"
    }

    Write-Host "Active Pi release: $activeRelease"
    Invoke-CheckedExternal ssh @(
        '-o', 'ConnectTimeout=20', $PiHost,
        'systemctl is-active mabeltv.service mabeltv-library.service && systemctl show mabeltv.service mabeltv-library.service -p Id -p NRestarts --no-pager'
    ) 'The Pi service baseline is not healthy.'

    $deploymentId = "{0}-{1}" -f (Get-Date -Format 'yyyyMMddHHmmss'),
        ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $remoteStaging = "/tmp/mabeltv-portal-$deploymentId"
    $remoteBackup = "/var/backups/mabeltv/portal-quick-$deploymentId"
    if ($remoteStaging -notmatch '^/tmp/mabeltv-portal-[0-9a-f-]+$') {
        throw "Unsafe staging path: $remoteStaging"
    }

    Invoke-CheckedExternal ssh @(
        '-o', 'ConnectTimeout=20', $PiHost, "mkdir -p '$remoteStaging'"
    ) 'Could not create the Pi staging directory.'

    foreach ($item in $targets) {
        $targetDirectory = Split-Path $item.Target -Parent
        if ($targetDirectory -and $targetDirectory -ne '.') {
            $targetDirectory = $targetDirectory.Replace('\', '/')
            Invoke-CheckedExternal ssh @(
                '-o', 'ConnectTimeout=20', $PiHost,
                "mkdir -p '$remoteStaging/$targetDirectory'"
            ) "Could not prepare the Pi staging directory for $($item.Target)."
        }
        Invoke-CheckedExternal scp @(
            '-o', 'ConnectTimeout=20', $item.RepositoryPath,
            "${PiHost}:$remoteStaging/$($item.Target)"
        ) "Could not stage $($item.RepositoryPath) on the Pi."
    }

    Invoke-CheckedExternal ssh @(
        '-o', 'ConnectTimeout=20', $PiHost, "sudo mkdir -p '$remoteBackup'"
    ) 'Could not create the portal rollback backup.'
    foreach ($item in $targets) {
        $targetDirectory = (Split-Path $item.Target -Parent).Replace('\', '/')
        if (-not $targetDirectory -or $targetDirectory -eq '.') { $targetDirectory = '' }
        $backupDirectory = if ($targetDirectory) { "$remoteBackup/$targetDirectory" } else { $remoteBackup }
        Invoke-CheckedExternal ssh @(
            '-o', 'ConnectTimeout=20', $PiHost,
            "sudo mkdir -p '$backupDirectory' && if sudo test -f '$activeRelease/$($item.Target)'; then sudo cp -p '$activeRelease/$($item.Target)' '$remoteBackup/$($item.Target)'; fi"
        ) "Could not back up $($item.Target)."
    }
    $backupReady = $true

    foreach ($item in $targets) {
        $targetDirectory = (Split-Path $item.Target -Parent).Replace('\', '/')
        if (-not $targetDirectory -or $targetDirectory -eq '.') { $targetDirectory = '' }
        $liveDirectory = if ($targetDirectory) { "$activeRelease/$targetDirectory" } else { $activeRelease }
        Invoke-CheckedExternal ssh @(
            '-o', 'ConnectTimeout=20', $PiHost,
            "sudo mkdir -p '$liveDirectory' && sudo install -m 0644 '$remoteStaging/$($item.Target)' '$activeRelease/$($item.Target)'"
        ) "Could not install $($item.Target)."
    }

    Invoke-CheckedExternal ssh @(
        '-o', 'ConnectTimeout=20', $PiHost,
        'sudo systemctl restart mabeltv-library.service && sleep 1'
    ) 'The Library service did not restart cleanly.'

    foreach ($item in $targets) {
        $localHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.RepositoryPath).Hash.ToLowerInvariant()
        $hashLines = Invoke-CapturedExternal ssh @(
            '-o', 'ConnectTimeout=20', $PiHost,
            "sha256sum '$activeRelease/$($item.Target)'"
        ) "Could not verify $($item.Target) on the Pi."
        $remoteHash = (($hashLines | Select-Object -Last 1) -split '\s+')[0].ToLowerInvariant()
        if ($remoteHash -ne $localHash) {
            throw "Live hash mismatch for $($item.Target)."
        }
    }

    Invoke-CheckedExternal ssh @(
        '-o', 'ConnectTimeout=20', $PiHost,
        "set -eu; test `"`$(readlink -f /opt/mabeltv/current)`" = '$activeRelease'; test `"`$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)`" = '200'; systemctl is-active mabeltv.service mabeltv-library.service; systemctl show mabeltv.service mabeltv-library.service -p Id -p NRestarts --no-pager; systemctl is-active mabeltv-health.timer 2>/dev/null || true; if command -v vcgencmd >/dev/null 2>&1; then vcgencmd measure_temp; vcgencmd get_throttled; fi"
    ) 'Live portal or Pi health verification failed.'

    Write-Host "Portal quick deploy complete. Rollback backup: $remoteBackup"
    Write-Host 'No native build, player restart, commit, or push was performed.'
} catch {
    if ($backupReady -and $activeRelease -and $remoteBackup) {
        Write-Warning 'Portal deploy failed after backup; restoring the previous live files.'
        foreach ($item in $targets) {
            & ssh -o ConnectTimeout=20 $PiHost "if sudo test -f '$remoteBackup/$($item.Target)'; then sudo install -m 0644 '$remoteBackup/$($item.Target)' '$activeRelease/$($item.Target)'; else sudo rm -f '$activeRelease/$($item.Target)'; fi"
        }
        & ssh -o ConnectTimeout=20 $PiHost 'sudo systemctl restart mabeltv-library.service'
    }
    throw
} finally {
    if ($remoteStaging -and $remoteStaging -match '^/tmp/mabeltv-portal-[0-9a-f-]+$') {
        & ssh -o ConnectTimeout=20 $PiHost "rm -rf -- '$remoteStaging'" 2>$null
    }
    Pop-Location
}
