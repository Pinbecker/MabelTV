"""Media probing and playback-transcoding behaviour for the local library service."""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from .compression import compression_profile
from pathlib import Path
from typing import Any

from .constants import (
    CHUNK_LIMIT,
    MAX_CONVERSION_TEMP_C,
    MAX_UPLOAD_BYTES,
    OFFLINE_PREPARED_CACHE_SECONDS,
    PLAYBACK_FPS,
    PLAYBACK_HEIGHT,
    PLAYBACK_WIDTH,
    RESUME_CONVERSION_TEMP_C,
    SUPPORTED_EXTENSIONS,
    UPLOAD_SOURCE_GRACE_SECONDS,
)


class TranscodingMixin:
    def video_info(self, path: Path) -> dict[str, Any]:
        try:
            result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate,channels,field_order,level", "-of", "json", str(path)], check=False, capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError(f"{self.tv_identity()[1]} could not finish checking that video") from error
        try:
            streams = json.loads(result.stdout).get("streams", [])
        except (TypeError, ValueError):
            streams = []
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        if result.returncode != 0 or video is None:
            raise ValueError(f"{self.tv_identity()[1]} could not find a video stream in that file")
        return {**video, "audio_streams": [stream for stream in streams if stream.get("codec_type") == "audio"]}

    @staticmethod
    def frame_rate(stream: dict[str, Any]) -> float:
        try:
            numerator, denominator = str(stream.get("avg_frame_rate", "0/1")).split("/", 1)
            return float(numerator) / float(denominator)
        except (TypeError, ValueError, ZeroDivisionError):
            return 0.0

    def needs_playback_optimisation(self, source: Path, stream: dict[str, Any]) -> bool:
        # Preserve ordinary prepared programmes. High-frame-rate footage is an
        # exception irrespective of container: this Pi software-decodes it and
        # cannot sustain 50/60fps playback safely. MOV uploads are also
        # normalised when they exceed the supported playback dimensions.
        frame_rate = self.frame_rate(stream)
        return (frame_rate > PLAYBACK_FPS + 0.1
                or (source.suffix.lower() == ".mov"
                    and (int(stream.get("width", 0)) > PLAYBACK_WIDTH
                         or int(stream.get("height", 0)) > PLAYBACK_HEIGHT)))

    def optimise_for_playback(self, source: Path, destination: Path) -> None:
        self._optimise_for_playback(
            source, destination,
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
            "2500k", "3000k", "5000k")

    def optimise_my_tv_for_playback(self, source: Path, destination: Path,
                                    progress_callback: Any = None) -> None:
        # Films are normally 23.976/24/25 fps. Preserve that cadence instead
        # of manufacturing duplicate 30 fps frames, while capping the stream
        # at a level the Pi can decode smoothly in hardware.
        self._optimise_for_playback(
            source, destination,
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "1800k", "2000k", "4000k", progress_callback
            or self.my_tv_optimisation_progress_callback)

    def request_my_tv_optimisation(self, file_name: str, compression=None) -> None:
        profile = compression_profile(compression)
        source = self.safe_my_tv_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        relative = self.my_tv_relative_path(source)
        job = self.studio_pi_queue({"kind": "my_tv", "file": relative},
                                   {"kind": "film"}, profile["id"], replace=True)
        self.set_my_tv_media_state(relative, "queued", progress=0, compression=profile["id"],
                                   compressionOperation=job["id"], message="Waiting for laptop")

    def my_tv_optimisation_action(self, file_name: str, action: str) -> None:
        if action not in {"pause", "resume", "cancel"}:
            raise ValueError("Unknown optimisation action")
        source = self.safe_my_tv_path(file_name)
        relative = self.my_tv_relative_path(source)
        stored = self.my_tv_media_states().get(relative, {})
        operation = stored.get("compressionOperation")
        pending = next((job for job in self.state_database.studio_records("job") if job["id"] == operation), None)
        if pending:
            self.studio_job_action({"id": operation, "action": action})
        with self.config_lock:
            state = self.my_tv_media_states().get(relative, {})
            current = str(state.get("state", "")) if isinstance(state, dict) else ""
            if action == "pause":
                if current not in {"queued", "processing"}:
                    raise ValueError("This optimisation cannot be paused now")
                self.set_my_tv_media_state(relative, "paused", "Paused by you",
                                           progress=int(state.get("progress", 0) or 0))
            elif action == "resume":
                if current != "paused":
                    raise ValueError("This optimisation is not paused")
                self.set_my_tv_media_state(relative, "processing", "",
                                           progress=int(state.get("progress", 0) or 0))
            else:
                if current not in {"queued", "processing", "paused"}:
                    raise ValueError("This optimisation cannot be cancelled now")
                self.set_my_tv_media_state(relative, "error", "Optimisation cancelled",
                                           progress=int(state.get("progress", 0) or 0))

    def optimise_my_tv_file(self, file_name: str) -> None:
        state = self.my_tv_media_states().get(file_name, {})
        self.request_my_tv_optimisation(file_name, state.get("compression"))

    def _optimise_for_playback(self, source: Path, destination: Path, *args, **kwargs) -> None:
        raise ValueError("Video preparation requires the Windows Studio laptop")

    @staticmethod
    def cpu_temperature_c() -> float:
        try:
            return int(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000
        except (OSError, ValueError):
            return 0.0
