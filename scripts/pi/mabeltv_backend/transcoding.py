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
            result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate", "-of", "json", str(path)], check=False, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Mabel TV could not finish checking that video") from error
        try:
            streams = json.loads(result.stdout).get("streams", [])
        except (TypeError, ValueError):
            streams = []
        if result.returncode != 0 or not streams or streams[0].get("codec_type") != "video":
            raise ValueError("Mabel TV could not find a video stream in that file")
        return streams[0]

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

    def optimise_adult_for_playback(self, source: Path, destination: Path,
                                    progress_callback: Any = None) -> None:
        # Films are normally 23.976/24/25 fps. Preserve that cadence instead
        # of manufacturing duplicate 30 fps frames, while capping the stream
        # at a level the Pi can decode smoothly in hardware.
        self._optimise_for_playback(
            source, destination,
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "1800k", "2000k", "4000k", progress_callback
            or self.adult_optimisation_progress_callback)

    def request_adult_optimisation(self, file_name: str) -> None:
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        relative = self.adult_relative_path(source)
        state = self.adult_media_states().get(relative, {})
        if isinstance(state, dict) and state.get("state") in {"queued", "processing"}:
            raise ValueError("This film is already being optimised")
        # Keep the original until the new copy has passed validation and has
        # been atomically published. Only then is the original removed.
        reserve = source.stat().st_size + 512 * 1024 * 1024
        if shutil.disk_usage(self.media_root).free < reserve:
            raise ValueError("There is not enough free space to safely optimise this film")
        with self.adult_optimisation_lock:
            if relative in self.adult_optimisation_active:
                raise ValueError("This film is already being optimised")
            self.adult_optimisation_active.add(relative)
        with self.config_lock:
            self.set_adult_media_state(relative, "queued", progress=0)
        threading.Thread(target=self.optimise_adult_file, args=(relative,),
                         name="mabeltv-adult-optimise", daemon=True).start()

    def adult_optimisation_action(self, file_name: str, action: str) -> None:
        if action not in {"pause", "resume", "cancel"}:
            raise ValueError("Unknown optimisation action")
        source = self.safe_adult_path(file_name)
        relative = self.adult_relative_path(source)
        with self.config_lock:
            state = self.adult_media_states().get(relative, {})
            current = str(state.get("state", "")) if isinstance(state, dict) else ""
            if action == "pause":
                if current not in {"queued", "processing"}:
                    raise ValueError("This optimisation cannot be paused now")
                self.set_adult_media_state(relative, "paused", "Paused by you",
                                           progress=int(state.get("progress", 0) or 0))
            elif action == "resume":
                if current != "paused":
                    raise ValueError("This optimisation is not paused")
                self.set_adult_media_state(relative, "processing", "",
                                           progress=int(state.get("progress", 0) or 0))
            else:
                if current not in {"queued", "processing", "paused"}:
                    raise ValueError("This optimisation cannot be cancelled now")
                self.set_adult_media_state(relative, "error", "Optimisation cancelled",
                                           progress=int(state.get("progress", 0) or 0))

    def optimise_adult_file(self, file_name: str) -> None:
        source = self.safe_adult_path(file_name)
        try:
            # One encoder at a time keeps temperature and memory use inside a
            # predictable envelope even if two portal buttons are pressed.
            with self.adult_optimisation_serial:
                if not source.is_file():
                    raise ValueError("Film not found")
                destination = source.with_suffix(".mp4")
                if destination != source and destination.exists():
                    raise ValueError("An MP4 with this film name already exists")
                with self.config_lock:
                    started = time.time()
                    self.set_adult_media_state(file_name, "processing", progress=0,
                                               started=started, eta_seconds=None)

                def save_progress(percent: int, message: str = "") -> None:
                    elapsed = max(0.0, time.time() - started)
                    eta = int(elapsed * (100 - percent) / percent) if percent > 0 else 0
                    with self.config_lock:
                        current = self.adult_media_states().get(file_name, {})
                        saved_state = "paused" if isinstance(current, dict) \
                            and current.get("state") == "paused" else "processing"
                        self.set_adult_media_state(
                            file_name, saved_state, message, progress=percent,
                            started=started, eta_seconds=eta or None)

                self.adult_optimisation_progress_callback = save_progress
                self.optimise_adult_for_playback(source, destination)
                if destination != source:
                    source.unlink()
                destination_relative = self.adult_relative_path(destination)
                with self.config_lock:
                    states = self.adult_media_states()
                    current = states.pop(file_name, {})
                    if not isinstance(current, dict):
                        current = {}
                    current.update({"state": "optimised", "message": "",
                                    "progress": 100, "updated": time.time()})
                    states[destination_relative] = current
                    self.write_adult_media_states(states)
                self.refresh_tv()
        except Exception as error:
            with self.config_lock:
                self.set_adult_media_state(
                    file_name, "error",
                    str(error) if isinstance(error, ValueError)
                    else "MabelTV could not optimise this film")
        finally:
            self.adult_optimisation_progress_callback = None
            with self.adult_optimisation_lock:
                self.adult_optimisation_active.discard(file_name)

    def _optimise_for_playback(self, source: Path, destination: Path,
                               video_filter: str, bitrate: str,
                               maximum_bitrate: str, buffer_size: str,
                               progress_callback: Any = None) -> None:
        token = uuid.uuid4().hex
        temporary = self.incoming / f"{token}.optimising.mp4"
        error_log = self.incoming / f"{token}.ffmpeg.log"
        try:
            duration_result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            duration = max(0.0, float(duration_result.stdout.strip()))
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            duration = 0.0
        command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                   "-threads", "2", "-filter_threads", "2", "-i", str(source),
                   "-map", "0:v:0", "-map", "0:a:0?", "-vf", video_filter,
                   # Debian 13 exposes Pi hardware decode but no usable V4L2
                   # H.264 encoder node. A bounded two-thread software encode
                   # is slower, but reliable; the resulting file is then
                   # hardware-decoded during every actual TV playback.
                   "-c:v", "libx264", "-preset", "veryfast", "-threads:v", "2",
                   "-profile:v", "main", "-level:v", "3.1", "-b:v", bitrate,
                   "-maxrate", maximum_bitrate, "-bufsize", buffer_size,
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                   "-progress", "pipe:1", "-nostats", str(temporary)]
        process: subprocess.Popen[str] | None = None
        paused = False
        deadline = time.monotonic() + 45 * 60
        last_percent = -1
        try:
            with error_log.open("wb") as errors:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors,
                                           text=True, start_new_session=True)
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("Mabel TV stopped this optimisation because it took too long")
                    saved = self.adult_media_states().get(self.adult_relative_path(source), {})
                    requested_state = str(saved.get("state", "")) if isinstance(saved, dict) else ""
                    if requested_state == "error" and str(saved.get("message", "")) == "Optimisation cancelled":
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("Optimisation cancelled")
                    user_paused = requested_state == "paused"
                    temperature = self.cpu_temperature_c()
                    if not paused and (user_paused or temperature >= MAX_CONVERSION_TEMP_C):
                        os.killpg(process.pid, signal.SIGSTOP)
                        paused = True
                        if progress_callback:
                            progress_callback(max(0, last_percent),
                                              "Paused by you" if user_paused else f"Paused to cool at {temperature:.0f}°C")
                        print(f"Paused video optimisation at {temperature:.1f}C", file=sys.stderr,
                              flush=True)
                    elif paused and not user_paused and temperature <= RESUME_CONVERSION_TEMP_C:
                        os.killpg(process.pid, signal.SIGCONT)
                        paused = False
                        if progress_callback:
                            progress_callback(max(0, last_percent), "")
                        print(f"Resumed video optimisation at {temperature:.1f}C", file=sys.stderr,
                              flush=True)
                    if paused:
                        time.sleep(2)
                        continue
                    line = process.stdout.readline() if process.stdout else ""
                    if duration <= 0 or not line.startswith(
                            ("out_time_us=", "out_time_ms=")):
                        continue
                    try:
                        completed = float(line.split("=", 1)[1].strip()) / 1_000_000
                    except (TypeError, ValueError):
                        continue
                    percent = min(99, max(0, int(completed * 100 / duration)))
                    if percent <= last_percent:
                        continue
                    last_percent = percent
                    if progress_callback:
                        progress_callback(percent, "")
                if process.returncode != 0:
                    details = error_log.read_text(encoding="utf-8", errors="replace").strip()
                    if details:
                        print(details[-4000:], file=sys.stderr, flush=True)
                    raise ValueError("Mabel TV could not optimise this video for smooth playback")
            self.video_info(temporary)
            os.replace(temporary, destination)
        finally:
            if process is not None and process.poll() is None:
                if paused:
                    os.killpg(process.pid, signal.SIGCONT)
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            temporary.unlink(missing_ok=True)
            error_log.unlink(missing_ok=True)

    @staticmethod
    def cpu_temperature_c() -> float:
        try:
            return int(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000
        except (OSError, ValueError):
            return 0.0
