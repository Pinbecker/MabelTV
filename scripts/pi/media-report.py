#!/usr/bin/env python3
"""Report media that may make a Raspberry Pi work harder than necessary."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


EXTENSIONS = {".mp4", ".m4v", ".mkv", ".mov", ".webm", ".avi", ".mpg", ".mpeg"}


def frame_rate(value: Any) -> float:
    try:
        numerator, denominator = str(value or "0/1").split("/", 1)
        return float(numerator) / float(denominator)
    except (ValueError, TypeError, ZeroDivisionError):
        return 0.0


def inspect(path: Path) -> dict[str, Any]:
    command = [
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,profile",
        "-show_entries", "format=duration,bit_rate", "-of", "json", str(path),
    ]
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=12)
    except subprocess.TimeoutExpired:
        return {"path": str(path), "status": "ERROR", "reasons": ["ffprobe timed out"]}
    try:
        data = json.loads(result.stdout)
    except (TypeError, ValueError):
        data = {}
    streams = data.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if result.returncode != 0 or not video:
        reason = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "no video stream"
        return {"path": str(path), "status": "ERROR", "reasons": [reason]}

    codec = str(video.get("codec_name") or "unknown")
    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    fps = frame_rate(video.get("avg_frame_rate"))
    pixel_format = str(video.get("pix_fmt") or "unknown")
    reasons: list[str] = []
    if codec != "h264":
        reasons.append(f"{codec} video may software-decode")
    if width > 1280 or height > 720:
        reasons.append(f"{width}x{height} exceeds the 720p appliance target")
    if fps > 30.1:
        reasons.append(f"{fps:.2f}fps exceeds the 30fps target")
    if pixel_format not in {"yuv420p", "nv12", "unknown"}:
        reasons.append(f"{pixel_format} may need an extra conversion step")

    return {
        "path": str(path),
        "status": "REVIEW" if reasons else "READY",
        "reasons": reasons,
        "video_codec": codec,
        "resolution": f"{width}x{height}",
        "fps": round(fps, 3),
        "pixel_format": pixel_format,
        "audio_codec": str(audio.get("codec_name") or "none") if audio else "none",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-root", default="/srv/mabeltv/media")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()
    root = Path(args.media_root).resolve()
    files = sorted(
        (path for path in root.rglob("*")
         if path.is_file() and path.suffix.lower() in EXTENSIONS
         and not any(part.startswith(".") for part in path.relative_to(root).parts)),
        key=lambda path: str(path).lower(),
    )
    records = [inspect(path) for path in files]
    totals = {status: sum(record["status"] == status for record in records)
              for status in ("READY", "REVIEW", "ERROR")}
    if args.as_json:
        print(json.dumps({"media_root": str(root), "totals": totals, "files": records}, indent=2))
    else:
        print(f"Mabel TV media compatibility: {totals['READY']} ready, "
              f"{totals['REVIEW']} to review, {totals['ERROR']} invalid")
        if not args.summary:
            for record in records:
                relative = Path(record["path"]).relative_to(root)
                detail = "; ".join(record["reasons"]) or "Pi-friendly H.264/720p/30fps"
                print(f"{record['status']:6}  {relative}  - {detail}")
    return 1 if totals["ERROR"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
