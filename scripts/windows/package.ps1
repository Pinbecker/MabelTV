param(
    [switch]$SkipDebugTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'toolchain.ps1')
$toolchainRoot = Enter-MabelTvToolchain
$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'out\package'))
$staging = [System.IO.Path]::GetFullPath((Join-Path $outputRoot 'MabelTV-windows-x64'))
$expectedOutputPrefix = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'out')) + [System.IO.Path]::DirectorySeparatorChar
if (-not $staging.StartsWith($expectedOutputPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to package outside the repository output directory: $staging"
}

if (-not $SkipDebugTests) {
    & (Join-Path $PSScriptRoot 'build.ps1') -Preset windows-debug
}
& (Join-Path $PSScriptRoot 'build.ps1') -Preset windows-release -SkipTests

if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$cmake = Join-Path $toolchainRoot 'ucrt64\bin\cmake.exe'
& $cmake --install (Join-Path $repositoryRoot 'out\build\windows-release') --prefix $staging
if ($LASTEXITCODE -ne 0) {
    throw "Installing the release build failed with exit code $LASTEXITCODE."
}

$windeployqt = Join-Path $toolchainRoot 'ucrt64\bin\windeployqt6.exe'
& $windeployqt --release --no-translations --compiler-runtime `
    (Join-Path $staging 'mabeltv.exe')
if ($LASTEXITCODE -ne 0) {
    throw "Deploying Qt runtime files failed with exit code $LASTEXITCODE."
}

# MSYS2's windeployqt cannot launch its qmlimportscanner from PowerShell on
# every host. Deploy the small set of runtime QML modules imported by the
# resource-embedded UI explicitly instead.
$qmlInstallRoot = Join-Path $toolchainRoot 'ucrt64\share\qt6\qml'
$qmlDeployRoot = Join-Path $staging 'qml'
function Copy-QmlModuleFiles {
    param([Parameter(Mandatory)][string]$RelativePath)

    $source = Join-Path $qmlInstallRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required QML runtime module is missing from the toolchain: $RelativePath"
    }
    $destination = Join-Path $qmlDeployRoot $RelativePath
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -LiteralPath $source -File | Copy-Item -Destination $destination -Force
}

Copy-QmlModuleFiles 'QtQml'
Copy-QmlModuleFiles 'QtQml\Models'
Copy-QmlModuleFiles 'QtQml\WorkerScript'
Copy-QmlModuleFiles 'QtQuick'
Copy-QmlModuleFiles 'QtQuick\Window'
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'packaging\windows\qt.conf') `
    -Destination (Join-Path $staging 'qt.conf') -Force

$ucrtBin = Join-Path $toolchainRoot 'ucrt64\bin'
Copy-Item -LiteralPath (Join-Path $ucrtBin 'libmpv-2.dll') -Destination $staging -Force
Copy-Item -LiteralPath (Join-Path $ucrtBin 'ffprobe.exe') -Destination $staging -Force

# Resolve libmpv, FFmpeg and codec DLLs recursively. Qt's deployment tool
# handles Qt itself; this pass adds non-Qt MSYS2 runtime dependencies.
$objdump = Join-Path $ucrtBin 'objdump.exe'
$queue = [System.Collections.Generic.Queue[string]]::new()
Get-ChildItem -LiteralPath $staging -Recurse -File |
    Where-Object { $_.Extension -in @('.exe', '.dll') } |
    ForEach-Object { $queue.Enqueue($_.FullName) }
$visited = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

while ($queue.Count -gt 0) {
    $binary = $queue.Dequeue()
    if (-not $visited.Add($binary)) {
        continue
    }

    $dependencies = & $objdump -p $binary 2>$null |
        Select-String -Pattern '^\s*DLL Name:\s*(.+)$' |
        ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() }
    foreach ($dependency in $dependencies) {
        $source = Join-Path $ucrtBin $dependency
        if (-not (Test-Path -LiteralPath $source)) {
            continue
        }
        $destination = Join-Path $staging $dependency
        if (-not (Test-Path -LiteralPath $destination)) {
            Copy-Item -LiteralPath $source -Destination $destination
        }
        $queue.Enqueue($destination)
    }
}

$configurationDirectory = Join-Path $staging 'config'
New-Item -ItemType Directory -Force -Path $configurationDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'config\examples\channels.json') `
    -Destination (Join-Path $configurationDirectory 'channels.json')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'config\examples\settings.json') `
    -Destination (Join-Path $configurationDirectory 'settings.json')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'README.md') -Destination $staging
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination $staging
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs') -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-MabelTV.cmd') -Destination $staging

$originalPath = $env:PATH
try {
    $env:PATH = "$staging;$env:SystemRoot;$env:SystemRoot\System32"
    & (Join-Path $staging 'mabeltv.exe') --self-test
    if ($LASTEXITCODE -ne 0) {
        throw "The packaged libmpv self-test failed with exit code $LASTEXITCODE."
    }

    & (Join-Path $staging 'mabeltv_media_check.exe') `
        --channels (Join-Path $configurationDirectory 'channels.json') `
        --media-root (Join-Path $repositoryRoot 'dev-data\media') `
        --cache (Join-Path $repositoryRoot 'dev-data\package-media-index.json')
    if ($LASTEXITCODE -ne 0) {
        throw "The packaged media checker failed with exit code $LASTEXITCODE."
    }

    $smokeRoot = Join-Path $outputRoot 'ui-smoke'
    if (Test-Path -LiteralPath $smokeRoot) {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
    $smokeMediaRoot = & (Join-Path $PSScriptRoot 'generate-dev-library.ps1')
    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = Join-Path $staging 'mabeltv.exe'
    $processInfo.WorkingDirectory = $staging
    $processInfo.UseShellExecute = $false
    $processInfo.Environment['PATH'] = $env:PATH
    foreach ($argument in @(
        '--channels', (Join-Path $configurationDirectory 'channels.json'),
        '--settings', (Join-Path $configurationDirectory 'settings.json'),
        '--media-root', $smokeMediaRoot,
        '--state', (Join-Path $smokeRoot 'state.json'),
        '--log-dir', (Join-Path $smokeRoot 'logs')
    )) {
        $processInfo.ArgumentList.Add($argument)
    }
    $uiProcess = [System.Diagnostics.Process]::Start($processInfo)
    Start-Sleep -Seconds 6
    if ($uiProcess.HasExited) {
        throw "The packaged UI exited early with code $($uiProcess.ExitCode)."
    }
    if (-not $uiProcess.CloseMainWindow()) {
        $uiProcess.Kill()
    }
    if (-not $uiProcess.WaitForExit(5000)) {
        $uiProcess.Kill()
        $uiProcess.WaitForExit()
    }
    $smokeLog = Get-ChildItem (Join-Path $smokeRoot 'logs') -Filter '*.log' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $smokeLog) {
        throw 'The packaged UI did not create its diagnostic log.'
    }
    $qmlErrors = Select-String -Path $smokeLog.FullName `
        -Pattern 'QQmlApplicationEngine failed|is not installed|is not a type|qrc:.*error' `
        -CaseSensitive:$false
    if ($qmlErrors) {
        throw "The packaged QML smoke test failed: $($qmlErrors.Line -join '; ')"
    }
} finally {
    $env:PATH = $originalPath
}

$archive = "$staging.zip"
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -CompressionLevel Optimal
Write-Output $archive
