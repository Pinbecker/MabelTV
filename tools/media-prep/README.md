# MabelTV Media Prep

Local Windows preparation app for MabelTV media. It never uploads files or connects to the Raspberry Pi.

Double-click `Start-MabelTVMediaPrep.cmd`.

Requirements already present on this laptop:

- Windows PowerShell
- FFmpeg and FFprobe available on `PATH`

Use the **Mabel TV** drop zone for a Pi-friendly 720p H.264/AAC MP4. Use **Adult TV** to preserve 1080p when the source has it, while producing a browser-safe H.264/AAC MP4.

The app analyses every file first. Files that already meet their target profile are marked **Already ready - no action required** and are neither copied nor modified.

Files that need preparation move straight into the working queue and begin automatically. Finished, ready, cancelled, and failed jobs leave the working queue, while the last six outcomes remain visible under **Recent results**.
