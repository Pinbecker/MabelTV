# MabelTV Media Prep — local Windows preparation app.
# It does not connect to, upload to, or modify the Raspberry Pi.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:appName = 'MabelTV Media Prep'
$script:settingsDirectory = Join-Path $env:APPDATA 'MabelTV Media Prep'
$script:settingsPath = Join-Path $script:settingsDirectory 'settings.json'
$script:queue = [System.Collections.ArrayList]::new()
$script:currentJob = $null
$script:ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue).Source
$script:ffprobe = (Get-Command ffprobe.exe -ErrorAction SilentlyContinue).Source

function Get-Settings {
    $fallback = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MabelTV Prepared'
    if (Test-Path -LiteralPath $script:settingsPath) {
        try {
            $saved = Get-Content -LiteralPath $script:settingsPath -Raw | ConvertFrom-Json
            if ($saved.output_folder -and (Test-Path -LiteralPath $saved.output_folder)) { return [string]$saved.output_folder }
        } catch { }
    }
    return $fallback
}

function Save-Settings([string]$OutputFolder) {
    New-Item -ItemType Directory -Force -Path $script:settingsDirectory | Out-Null
    @{ output_folder = $OutputFolder } | ConvertTo-Json | Set-Content -LiteralPath $script:settingsPath -Encoding utf8
}

function Format-Bytes([double]$Bytes) {
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    return ('{0:N0} KB' -f ($Bytes / 1KB))
}

function Format-Time([double]$Seconds) {
    if ($Seconds -lt 0 -or [double]::IsNaN($Seconds)) { return 'calculating…' }
    $span = [TimeSpan]::FromSeconds([Math]::Ceiling($Seconds))
    if ($span.TotalHours -ge 1) { return ('{0:hh\\:mm\\:ss}' -f $span) }
    return ('{0:mm\\:ss}' -f $span)
}

function Test-H264Encoder([string]$Encoder) {
    & $script:ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=black:s=64x64:r=1' -frames:v 1 -c:v $Encoder -f null - 2>$null
    return $LASTEXITCODE -eq 0
}

function Get-FrameRate([string]$Value) {
    if (-not $Value -or $Value -eq '0/0') { return 0 }
    if ($Value -match '^(\d+)\/(\d+)$') { return [double]$Matches[1] / [double]$Matches[2] }
    return [double]$Value
}

function Test-FastStart([string]$Path) {
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $count = [Math]::Min([int64](4MB), $stream.Length)
            $buffer = [byte[]]::new($count)
            [void]$stream.Read($buffer, 0, $count)
            return ([System.Text.Encoding]::ASCII.GetString($buffer).Contains('moov'))
        } finally { $stream.Dispose() }
    } catch { return $false }
}

function Inspect-Media([string]$Path, [string]$Target) {
    try {
        $probe = & $script:ffprobe -v error -show_entries 'stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate:format=bit_rate,duration' -of json -- $Path 2>$null | Out-String | ConvertFrom-Json
        $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' }) | Select-Object -First 1
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' }) | Select-Object -First 1
        if (-not $video) { throw 'No video track found.' }
        $fps = Get-FrameRate ([string]$video.r_frame_rate)
        $bitrate = 0; [void][double]::TryParse([string]$probe.format.bit_rate, [ref]$bitrate)
        $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
        $fastStart = ($extension -in @('.mp4', '.m4v')) -and (Test-FastStart $Path)
        $maxWidth = if ($Target -eq 'Mabel TV') { 1280 } else { 1920 }
        $maxHeight = if ($Target -eq 'Mabel TV') { 720 } else { 1080 }
        $maxBitrate = if ($Target -eq 'Mabel TV') { 2800000 } else { 7000000 }
        $reasons = [System.Collections.Generic.List[string]]::new()
        if ($extension -notin @('.mp4', '.m4v')) { $reasons.Add('not an MP4 or M4V container') }
        if ($video.codec_name -ne 'h264') { $reasons.Add("video is $($video.codec_name), not H.264") }
        if ($video.pix_fmt -ne 'yuv420p') { $reasons.Add("video colour format is $($video.pix_fmt), not 8-bit yuv420p") }
        if (-not $audio -or $audio.codec_name -ne 'aac') { $reasons.Add('audio is not AAC') }
        if ([int]$video.width -gt $maxWidth -or [int]$video.height -gt $maxHeight) { $reasons.Add("picture exceeds $maxWidth`x$maxHeight") }
        if ($fps -gt 30.05) { $reasons.Add(('frame rate is {0:N1} fps' -f $fps)) }
        if ($bitrate -gt $maxBitrate) { $reasons.Add(('bitrate is too high ({0})' -f (Format-Bytes ($bitrate / 8)))) }
        if (-not $fastStart) { $reasons.Add('MP4 is not prepared for immediate browser playback') }
        return [pscustomobject]@{
            Ready = $reasons.Count -eq 0; Reasons = $reasons; Duration = [double]$probe.format.duration
            Width = [int]$video.width; Height = [int]$video.height; Fps = $fps; Bitrate = $bitrate
            Summary = "${($video.codec_name.ToUpperInvariant())} · $($video.width)x$($video.height) · $([Math]::Round($fps, 2)) fps"
        }
    } catch { return [pscustomobject]@{ Ready = $false; Reasons = @($_.Exception.Message); Duration = 0; Width = 0; Height = 0; Fps = 0; Bitrate = 0; Summary = 'Could not inspect file' } }
}

function Get-OutputPath([string]$InputPath, [string]$Target, [string]$Folder) {
    $base = [IO.Path]::GetFileNameWithoutExtension($InputPath)
    $suffix = if ($Target -eq 'Mabel TV') { 'MabelTV' } else { 'AdultTV' }
    $candidate = Join-Path $Folder "$base - $suffix.mp4"
    $number = 2
    while (Test-Path -LiteralPath $candidate) { $candidate = Join-Path $Folder "$base - $suffix ($number).mp4"; $number++ }
    return $candidate
}

function Refresh-Queue {
    $list.Items.Clear()
    foreach ($job in $script:queue) {
        $item = [Windows.Forms.ListViewItem]::new([string]$job.Status)
        [void]$item.SubItems.Add([string]$job.Target)
        [void]$item.SubItems.Add([IO.Path]::GetFileName($job.Path))
        [void]$item.SubItems.Add((if ($job.Status -eq 'Converting') { "{0:N0}% · {1}" -f $job.Percent, $job.Detail } else { [string]$job.Detail }))
        $item.Tag = $job
        [void]$list.Items.Add($item)
    }
    $pending = @($script:queue | Where-Object { $_.Status -eq 'Queued' }).Count
    $ready = @($script:queue | Where-Object { $_.Status -eq 'Already ready' }).Count
    $queueLabel.Text = "$pending waiting · $ready already ready · $($script:queue.Count) total"
}

function Set-Controls {
    $hasQueued = @($script:queue | Where-Object { $_.Status -eq 'Queued' }).Count -gt 0
    $startButton.Enabled = $hasQueued -and -not $script:currentJob
    $cancelButton.Enabled = $null -ne $script:currentJob
    $clearButton.Enabled = -not $script:currentJob
}

function Add-Files([string]$Target, [string[]]$Paths) {
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
        if ($extension -notin @('.mp4', '.m4v', '.mov', '.mkv', '.avi', '.mpg', '.mpeg', '.webm')) { continue }
        $analysis = Inspect-Media $path $Target
        $job = [pscustomobject]@{
            Id = [guid]::NewGuid().ToString('N'); Path = $path; Target = $Target; Analysis = $analysis
            Status = if ($analysis.Ready) { 'Already ready' } else { 'Queued' }
            Detail = if ($analysis.Ready) { 'No action required' } else { ($analysis.Reasons -join '; ') }
            Duration = $analysis.Duration; Percent = 0; Output = $null; PartOutput = $null; Worker = $null; Started = $null
        }
        [void]$script:queue.Add($job)
    }
    Refresh-Queue; Set-Controls
}

function Start-Next {
    if ($script:currentJob) { return }
    $job = @($script:queue | Where-Object { $_.Status -eq 'Queued' }) | Select-Object -First 1
    if (-not $job) { $overall.Value = 100; $overallLabel.Text = 'Queue complete'; Set-Controls; return }
    $folder = $outputBox.Text.Trim()
    if (-not $folder) { [Windows.Forms.MessageBox]::Show('Choose an output folder first.', $script:appName, 'OK', 'Warning') | Out-Null; return }
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    Save-Settings $folder
    $job.Output = Get-OutputPath $job.Path $job.Target $folder
    $job.PartOutput = "$($job.Output).part.mp4"
    $job.Status = 'Converting'; $job.Detail = 'Starting FFmpeg…'; $job.Started = Get-Date
    $job.Percent = 0; $script:currentJob = $job
    $fps = if ($job.Analysis.Fps -gt 25.1) { '30' } else { '25' }
    $encoderArgs = if ($script:videoEncoder -eq 'h264_qsv') { @('-c:v','h264_qsv','-global_quality',$(if ($job.Target -eq 'Mabel TV') { '23' } else { '20' })) } else { @('-c:v','libx264','-preset','medium','-crf',$(if ($job.Target -eq 'Mabel TV') { '22' } else { '20' })) }
    if ($job.Target -eq 'Mabel TV') {
        $arguments = @('-hide_banner','-y','-i',$job.Path,'-map','0:v:0','-map','0:a:0?') + $encoderArgs + @('-maxrate','2500k','-bufsize','5000k','-profile:v','high','-level','3.1','-pix_fmt','yuv420p','-vf','scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2','-r',$fps,'-c:a','aac','-b:a','160k','-ac','2','-movflags','+faststart','-progress','pipe:1','-nostats',$job.PartOutput)
    } else {
        $arguments = @('-hide_banner','-y','-i',$job.Path,'-map','0:v:0','-map','0:a:0?') + $encoderArgs + @('-maxrate','6500k','-bufsize','13000k','-profile:v','high','-pix_fmt','yuv420p','-vf','scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2','-r',$fps,'-c:a','aac','-b:a','192k','-ac','2','-movflags','+faststart','-progress','pipe:1','-nostats',$job.PartOutput)
    }
    $job.Worker = Start-Job -ScriptBlock {
        param($Executable, $Arguments, $PartOutput, $Output)
        & $Executable @Arguments 2>&1 | ForEach-Object { [Console]::WriteLine($_.ToString()) }
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0 -and (Test-Path -LiteralPath $PartOutput)) { Move-Item -LiteralPath $PartOutput -Destination $Output -Force }
        "MABELTV_EXIT=$exitCode"
    } -ArgumentList $script:ffmpeg, $arguments, $job.PartOutput, $job.Output
    $overall.Value = 0; $overallLabel.Text = "Preparing $([IO.Path]::GetFileName($job.Path))…"
    Refresh-Queue; Set-Controls
}

function Cancel-Current {
    if (-not $script:currentJob) { return }
    $job = $script:currentJob
    Stop-Job -Job $job.Worker -ErrorAction SilentlyContinue
    Remove-Job -Job $job.Worker -Force -ErrorAction SilentlyContinue
    if ($job.PartOutput) { Remove-Item -LiteralPath $job.PartOutput -Force -ErrorAction SilentlyContinue }
    $job.Status = 'Cancelled'; $job.Detail = 'Conversion cancelled safely'; $job.Worker = $null
    $script:currentJob = $null; $overall.Value = 0; $overallLabel.Text = 'Cancelled'
    Refresh-Queue; Set-Controls
}

function Poll-Worker {
    if (-not $script:currentJob) { return }
    $job = $script:currentJob
    $lines = @(Receive-Job -Job $job.Worker -ErrorAction SilentlyContinue)
    $exit = $null
    foreach ($lineObject in $lines) {
        $line = [string]$lineObject
        if ($line -match '^out_time_ms=(\d+)$' -and $job.Duration -gt 0) {
            $job.Percent = [Math]::Min(99, [Math]::Floor(([double]$Matches[1] / 1000000 / $job.Duration) * 100))
            $elapsed = ((Get-Date) - $job.Started).TotalSeconds
            $remaining = if ($job.Percent -gt 0) { ($elapsed / $job.Percent) * (100 - $job.Percent) } else { -1 }
            $job.Detail = "about $(Format-Time $remaining) remaining"
        }
        if ($line -match '^MABELTV_EXIT=(\d+)$') { $exit = [int]$Matches[1] }
    }
    $overall.Value = [Math]::Max(0, [Math]::Min(100, [int]$job.Percent))
    $overallLabel.Text = if ($job.Percent -gt 0) { "$([IO.Path]::GetFileName($job.Path)) · $([int]$job.Percent)% · $($job.Detail)" } else { "Converting $([IO.Path]::GetFileName($job.Path))…" }
    if ($job.Worker.State -in @('Completed','Failed','Stopped')) {
        $rest = @(Receive-Job -Job $job.Worker -ErrorAction SilentlyContinue)
        foreach ($lineObject in $rest) { if (([string]$lineObject) -match '^MABELTV_EXIT=(\d+)$') { $exit = [int]$Matches[1] } }
        Remove-Job -Job $job.Worker -Force -ErrorAction SilentlyContinue
        if ($exit -eq 0 -and (Test-Path -LiteralPath $job.Output)) { $job.Status = 'Complete'; $job.Percent = 100; $job.Detail = "Ready · $(Format-Bytes (Get-Item -LiteralPath $job.Output).Length)" }
        else { $job.Status = 'Failed'; $job.Detail = 'FFmpeg could not prepare this file'; Remove-Item -LiteralPath $job.PartOutput -Force -ErrorAction SilentlyContinue }
        $job.Worker = $null; $script:currentJob = $null
        Refresh-Queue; Set-Controls; Start-Next
    } else { Refresh-Queue }
}

if (-not $script:ffmpeg -or -not $script:ffprobe) {
    [Windows.Forms.MessageBox]::Show('FFmpeg and FFprobe must be installed and available on this computer before Media Prep can run.', $script:appName, 'OK', 'Error') | Out-Null
    exit 1
}

# Prefer the laptop's real hardware encoder where it can produce H.264.
# This computer exposes Intel Quick Sync; libx264 remains the reliable fallback.
$script:videoEncoder = if (Test-H264Encoder 'h264_qsv') { 'h264_qsv' } else { 'libx264' }

$form = [Windows.Forms.Form]::new()
$form.Text = $script:appName; $form.StartPosition = 'CenterScreen'; $form.MinimumSize = [Drawing.Size]::new(940, 690); $form.Size = [Drawing.Size]::new(1100, 760)
$form.BackColor = [Drawing.Color]::FromArgb(19, 25, 23); $form.ForeColor = [Drawing.Color]::White; $form.Font = [Drawing.Font]::new('Segoe UI', 10)

$title = [Windows.Forms.Label]::new(); $title.Text = 'MabelTV Media Prep'; $title.Font = [Drawing.Font]::new('Segoe UI Semibold', 23); $title.Location = [Drawing.Point]::new(26, 20); $title.AutoSize = $true
$encoderName = if ($script:videoEncoder -eq 'h264_qsv') { 'Intel Quick Sync acceleration' } else { 'software H.264 encoding' }
$subtitle = [Windows.Forms.Label]::new(); $subtitle.Text = "Prepare files on this laptop. Nothing is uploaded or sent to the Pi. Using $encoderName."; $subtitle.ForeColor = [Drawing.Color]::FromArgb(171, 184, 178); $subtitle.Location = [Drawing.Point]::new(29, 61); $subtitle.AutoSize = $true

function New-DropZone([string]$Target, [int]$X, [string]$Heading, [string]$Description, [Drawing.Color]$Accent) {
    $panel = [Windows.Forms.Panel]::new(); $panel.Location = [Drawing.Point]::new($X, 102); $panel.Size = [Drawing.Size]::new(500, 130); $panel.BackColor = [Drawing.Color]::FromArgb(29, 39, 35); $panel.BorderStyle = 'FixedSingle'; $panel.AllowDrop = $true
    $head = [Windows.Forms.Label]::new(); $head.Text = $Heading; $head.Font = [Drawing.Font]::new('Segoe UI Semibold', 15); $head.ForeColor = $Accent; $head.Location = [Drawing.Point]::new(18, 16); $head.AutoSize = $true
    $copy = [Windows.Forms.Label]::new(); $copy.Text = $Description; $copy.ForeColor = [Drawing.Color]::FromArgb(207, 215, 210); $copy.Location = [Drawing.Point]::new(19, 48); $copy.Size = [Drawing.Size]::new(360, 38)
    $button = [Windows.Forms.Button]::new(); $button.Text = 'Choose files'; $button.Location = [Drawing.Point]::new(382, 45); $button.Size = [Drawing.Size]::new(98, 35); $button.BackColor = $Accent; $button.ForeColor = [Drawing.Color]::FromArgb(15, 20, 18); $button.FlatStyle = 'Flat'
    $hint = [Windows.Forms.Label]::new(); $hint.Text = 'Drop one or many video files here'; $hint.ForeColor = [Drawing.Color]::FromArgb(139, 153, 146); $hint.Location = [Drawing.Point]::new(19, 96); $hint.AutoSize = $true
    $panel.Controls.AddRange(@($head, $copy, $button, $hint))
    $drop = { param($sender, $event) $event.Effect = [Windows.Forms.DragDropEffects]::Copy }
    $receive = { param($sender, $event) if ($event.Data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) { Add-Files $Target @($event.Data.GetData([Windows.Forms.DataFormats]::FileDrop)) } }
    $panel.Add_DragEnter($drop); $panel.Add_DragDrop($receive)
    foreach ($control in @($head, $copy, $hint)) { $control.Add_DragEnter($drop); $control.Add_DragDrop($receive) }
    $button.Add_Click({ $dialog = [Windows.Forms.OpenFileDialog]::new(); $dialog.Multiselect = $true; $dialog.Filter = 'Video files|*.mp4;*.m4v;*.mov;*.mkv;*.avi;*.mpg;*.mpeg;*.webm|All files|*.*'; if ($dialog.ShowDialog() -eq 'OK') { Add-Files $Target $dialog.FileNames } })
    return $panel
}

$mabelDrop = New-DropZone 'Mabel TV' 26 'Mabel TV' '720p, efficient, safe for the Pi and browser streaming.' ([Drawing.Color]::FromArgb(130, 210, 167))
$adultDrop = New-DropZone 'Adult TV' 552 'Adult TV' 'Keep 1080p where available, while making it Pi and browser safe.' ([Drawing.Color]::FromArgb(255, 150, 126))

$outLabel = [Windows.Forms.Label]::new(); $outLabel.Text = 'Prepared files folder'; $outLabel.Location = [Drawing.Point]::new(28, 255); $outLabel.AutoSize = $true
$outputBox = [Windows.Forms.TextBox]::new(); $outputBox.Location = [Drawing.Point]::new(28, 279); $outputBox.Size = [Drawing.Size]::new(890, 30); $outputBox.Text = Get-Settings
$browse = [Windows.Forms.Button]::new(); $browse.Text = 'Choose folder'; $browse.Location = [Drawing.Point]::new(928, 277); $browse.Size = [Drawing.Size]::new(124, 34)
$browse.Add_Click({ $dialog = [Windows.Forms.FolderBrowserDialog]::new(); $dialog.SelectedPath = $outputBox.Text; if ($dialog.ShowDialog() -eq 'OK') { $outputBox.Text = $dialog.SelectedPath; Save-Settings $dialog.SelectedPath } })

$queueLabel = [Windows.Forms.Label]::new(); $queueLabel.Text = 'Drop files above to start a queue.'; $queueLabel.Location = [Drawing.Point]::new(28, 335); $queueLabel.AutoSize = $true; $queueLabel.ForeColor = [Drawing.Color]::FromArgb(171, 184, 178)
$list = [Windows.Forms.ListView]::new(); $list.Location = [Drawing.Point]::new(26, 360); $list.Size = [Drawing.Size]::new(1026, 250); $list.View = 'Details'; $list.FullRowSelect = $true; $list.GridLines = $true; $list.BackColor = [Drawing.Color]::FromArgb(25, 33, 30); $list.ForeColor = [Drawing.Color]::White
foreach ($column in @(@('Status',130), @('Target',110), @('File',315), @('Progress / details',445))) { [void]$list.Columns.Add($column[0], $column[1]) }

$overall = [Windows.Forms.ProgressBar]::new(); $overall.Location = [Drawing.Point]::new(28, 628); $overall.Size = [Drawing.Size]::new(720, 20); $overall.Style = 'Continuous'
$overallLabel = [Windows.Forms.Label]::new(); $overallLabel.Text = 'Ready to analyse files.'; $overallLabel.Location = [Drawing.Point]::new(28, 654); $overallLabel.Size = [Drawing.Size]::new(720, 24); $overallLabel.ForeColor = [Drawing.Color]::FromArgb(171, 184, 178)
$startButton = [Windows.Forms.Button]::new(); $startButton.Text = 'Start queue'; $startButton.Location = [Drawing.Point]::new(768, 622); $startButton.Size = [Drawing.Size]::new(136, 42); $startButton.BackColor = [Drawing.Color]::FromArgb(244, 244, 241); $startButton.ForeColor = [Drawing.Color]::FromArgb(17, 22, 20); $startButton.FlatStyle = 'Flat'
$cancelButton = [Windows.Forms.Button]::new(); $cancelButton.Text = 'Cancel current'; $cancelButton.Location = [Drawing.Point]::new(914, 622); $cancelButton.Size = [Drawing.Size]::new(138, 42); $cancelButton.FlatStyle = 'Flat'
$clearButton = [Windows.Forms.Button]::new(); $clearButton.Text = 'Clear finished'; $clearButton.Location = [Drawing.Point]::new(914, 670); $clearButton.Size = [Drawing.Size]::new(138, 28); $clearButton.FlatStyle = 'Flat'
$startButton.Add_Click({ Start-Next }); $cancelButton.Add_Click({ Cancel-Current }); $clearButton.Add_Click({ [void]$script:queue.RemoveAll([Predicate[object]]{ param($item) $item.Status -in @('Complete','Already ready','Cancelled','Failed') }); Refresh-Queue; Set-Controls })

$form.Controls.AddRange(@($title,$subtitle,$mabelDrop,$adultDrop,$outLabel,$outputBox,$browse,$queueLabel,$list,$overall,$overallLabel,$startButton,$cancelButton,$clearButton))
$timer = [Windows.Forms.Timer]::new(); $timer.Interval = 450; $timer.Add_Tick({ Poll-Worker }); $timer.Start()
$form.Add_FormClosing({ if ($script:currentJob) { $choice = [Windows.Forms.MessageBox]::Show('A conversion is still running. Cancel it and close?', $script:appName, 'YesNo', 'Warning'); if ($choice -eq 'Yes') { Cancel-Current } else { $_.Cancel = $true } } })
Refresh-Queue; Set-Controls
[void]$form.ShowDialog()
