"""Live TV HLS and screen-preview process ownership."""

from __future__ import annotations

import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Any


class LiveStream:
    """A private, low-latency HLS mirror of the programme currently on TV."""

    PREVIEW_IDLE_SECONDS = 12.0

    def __init__(self, library: "Library") -> None:
        self.library = library
        self.root = Path("/var/cache/mabeltv/live-stream")
        self.lock = threading.RLock()
        self.process: subprocess.Popen[bytes] | None = None
        self.signature: tuple[str] | None = None
        self.preview_process: subprocess.Popen[bytes] | None = None
        self.preview_signature: tuple[str, bool] | None = None
        self.preview_frame = b""
        self.preview_generation = 0
        self.preview_error = ""
        self.preview_updated = threading.Condition(self.lock)
        self.preview_last_request = 0.0
        self.preview_idle_timer: threading.Timer | None = None

    @staticmethod
    def _terminate_process(process: subprocess.Popen[bytes],
                           privileged: bool = False) -> None:
        if process.poll() is not None:
            return
        if privileged:
            # The preview encoder crosses a sudo boundary because kmsgrab
            # needs DRM capabilities. An unprivileged killpg can stop sudo
            # while leaving its root FFmpeg child orphaned and still capturing
            # at 10 fps. The fixed helper terminates only the validated PID
            # recorded by mabeltv-screen-capture.
            try:
                subprocess.run(
                    ["sudo", "-n", "/usr/local/libexec/mabeltv-screen-capture-stop"],
                    check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=5,
                )
            except (OSError, subprocess.TimeoutExpired):
                pass
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def _schedule_preview_idle_locked(self) -> None:
        if self.preview_idle_timer:
            self.preview_idle_timer.cancel()
        timer = threading.Timer(self.PREVIEW_IDLE_SECONDS, self._stop_idle_preview)
        timer.daemon = True
        self.preview_idle_timer = timer
        timer.start()

    def _touch_preview_locked(self) -> None:
        self.preview_last_request = time.monotonic()
        self._schedule_preview_idle_locked()

    def _stop_idle_preview(self) -> None:
        process: subprocess.Popen[bytes] | None = None
        with self.lock:
            remaining = self.PREVIEW_IDLE_SECONDS - (time.monotonic() - self.preview_last_request)
            if remaining > 0:
                timer = threading.Timer(remaining, self._stop_idle_preview)
                timer.daemon = True
                self.preview_idle_timer = timer
                timer.start()
                return
            process, self.preview_process = self.preview_process, None
            self.preview_signature = None
            self.preview_frame = b""
            self.preview_error = ""
            self.preview_generation += 1
            self.preview_idle_timer = None
            self.preview_updated.notify_all()
        if process:
            self._terminate_process(process, privileged=True)

    def source(self) -> dict[str, Any]:
        state = self.library.read_state("player")
        if not isinstance(state, dict) or state.get("standby"):
            return {"available": False, "reason": "The TV is off"}
        try:
            number = int(state.get("current_channel"))
            timeline = state.get("channel_timelines", {}).get(str(number), {})
            file_name = str(timeline.get("episode_name", ""))
            channel = self.library.channel(number)
            source = self.library.safe_media_path(channel, file_name)
            position = max(0.0, float(timeline.get("position_seconds", 0)))
            paused = state.get("playback_paused") is True
            if not paused:
                saved_at = float(state.get("saved_at_utc_ms", 0))
                if saved_at > 0:
                    position += max(0.0, (time.time() * 1000.0 - saved_at) / 1000.0)
        except (TypeError, ValueError):
            return {"available": False, "reason": "Waiting for the TV programme"}
        if not source.is_file():
            return {"available": False, "reason": "Waiting for the TV programme"}
        return {"available": True, "channel_number": number,
                "channel_name": str(channel.get("name", "Channel")),
                "file_name": file_name,
                "programme": self.library.channel_programme_title(number, file_name),
                "source": source, "position": position,
                "paused": paused,
                "volume": int(state.get("volume", 0)),
                "muted": state.get("muted") is True}

    def stop(self) -> None:
        with self.lock:
            process, self.process = self.process, None
            preview_process, self.preview_process = self.preview_process, None
            if self.preview_idle_timer:
                self.preview_idle_timer.cancel()
                self.preview_idle_timer = None
            self.preview_last_request = 0.0
            self.signature = None
            self.preview_signature = None
            self.preview_frame = b""
            self.preview_error = ""
            self.preview_generation += 1
            self.preview_updated.notify_all()
        if process:
            self._terminate_process(process)
        if preview_process:
            self._terminate_process(preview_process, privileged=True)

    @staticmethod
    def playable_position(source: Path, position: float) -> float:
        """Keep a stale player timeline from seeking beyond the media file."""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(source)],
                check=False, capture_output=True, text=True, timeout=3,
            )
            duration = float(result.stdout.strip()) if result.returncode == 0 else 0.0
        except (OSError, subprocess.TimeoutExpired, ValueError):
            duration = 0.0
        if duration > 1.0:
            return position % duration
        return position

    def ensure(self) -> dict[str, Any]:
        info = self.source()
        if not info["available"]:
            self.stop()
            return info
        # The encoder follows the programme in real time. Its source changes
        # only when the programme changes; restarting it as the saved player
        # position ticks over causes a visible interruption every few seconds.
        signature = (str(info["source"]),)
        manifest = self.root / "live.m3u8"
        with self.lock:
            if self.process and self.process.poll() is None \
                    and self.signature == signature and manifest.is_file():
                return info
            # A browser may request the playlist more than once while it is
            # opening. Keep stopping, clearing and launching in this one lock
            # so those requests share one encoder and one coherent playlist.
            self.stop()
            self.root.mkdir(parents=True, exist_ok=True)
            for path in self.root.glob("*"):
                if path.is_file():
                    path.unlink(missing_ok=True)
            command = [
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", f"{self.playable_position(info['source'], info['position']):.3f}",
                "-re", "-i", str(info["source"]),
                "-map", "0:v:0", "-map", "0:a:0?",
                "-vf", "scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
                # The Pi's V4L2 H.264 encoder can hang while the TV player is
                # active. This bounded software profile is reliable, broadly
                # compatible with iPhone playback, and leaves room for TV.
                "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
                "-profile:v", "baseline", "-level:v", "3.1", "-b:v", "1200k",
                "-maxrate", "1400k", "-bufsize", "700k", "-g", "30",
                "-keyint_min", "30", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k", "-ac", "2",
                "-f", "hls", "-hls_time", "1", "-hls_list_size", "4",
                "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
                "-hls_flags", "delete_segments+append_list+independent_segments",
                "-hls_segment_filename", str(self.root / "segment-%05d.m4s"), str(manifest),
            ]
            try:
                process = subprocess.Popen(command, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, start_new_session=True)
            except OSError as error:
                raise ValueError("The Pi could not start the live TV stream") from error
            self.process = process
            self.signature = signature
        return info

    def manifest(self) -> Path:
        info = self.ensure()
        if not info["available"]:
            raise ValueError(str(info["reason"]))
        path = self.root / "live.m3u8"
        deadline = time.monotonic() + 8
        while not path.is_file() and time.monotonic() < deadline:
            with self.lock:
                failed = self.process is None or self.process.poll() is not None
            if failed:
                raise ValueError("The Pi could not prepare the live TV stream")
            time.sleep(0.1)
        if not path.is_file():
            raise ValueError("The live TV stream is taking longer than expected")
        return path

    def segment(self, name: str) -> Path:
        if name == "init.mp4":
            path = self.root / name
        elif re.fullmatch(r"segment-\d{5}\.m4s", name):
            path = self.root / name
        else:
            raise ValueError("Invalid live TV segment")
        if not path.is_file():
            raise ValueError("That part of the live stream has expired")
        return path

    def _collect_preview_frames(self, process: subprocess.Popen[bytes]) -> None:
        assert process.stdout is not None
        buffered = bytearray()
        while chunk := process.stdout.read1(8192):
            buffered.extend(chunk)
            while True:
                start = buffered.find(b"\xff\xd8")
                end = buffered.find(b"\xff\xd9", start + 2)
                if start < 0 or end < 0:
                    if len(buffered) > 2 * 1024 * 1024:
                        buffered.clear()
                    break
                frame = bytes(buffered[start:end + 2])
                del buffered[:end + 2]
                with self.lock:
                    if process is not self.preview_process:
                        return
                    self.preview_frame = frame
                    self.preview_generation += 1
                    self.preview_updated.notify_all()
        details = ""
        if process.stderr:
            details = process.stderr.read(1024).decode("utf-8", "replace").strip()
        with self.lock:
            if process is self.preview_process:
                self.preview_error = details
                self.preview_updated.notify_all()

    def preview(self) -> bytes:
        """Return the current frame from one shared Pi-owned preview encoder."""
        # The frame encoder mirrors the DRM/KMS output itself, so it can show
        # Adult TV and overlays that have no children's-channel timeline.  A
        # channel lookup here used to reject that perfectly valid picture and
        # made the portal report the active television as offline.
        state = self.library.read_state("player")
        if not isinstance(state, dict) or state.get("standby"):
            raise ValueError("The TV is off")
        signature = ("tv-screen", False)
        with self.lock:
            if self.preview_signature == signature and self.preview_frame \
                    and self.preview_process and self.preview_process.poll() is None:
                self._touch_preview_locked()
                return self.preview_frame
            generation = self.preview_generation
            if not self.preview_process or self.preview_process.poll() is not None \
                    or self.preview_signature != signature:
                previous, self.preview_process = self.preview_process, None
                if previous:
                    self._terminate_process(previous, privileged=True)
                self.preview_frame = b""
                self.preview_error = ""
                command = ["sudo", "-n", "/usr/local/libexec/mabeltv-screen-capture"]
                try:
                    process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                               stderr=subprocess.PIPE, start_new_session=True)
                except OSError as error:
                    raise ValueError("The Pi could not start the live TV picture") from error
                self.preview_process = process
                self.preview_signature = signature
                threading.Thread(target=self._collect_preview_frames, args=(process,),
                                 name="mabeltv-live-preview", daemon=True).start()
            self._touch_preview_locked()
            deadline = time.monotonic() + 20
            while self.preview_generation <= generation and time.monotonic() < deadline:
                self.preview_updated.wait(timeout=deadline - time.monotonic())
            if self.preview_generation > generation and self.preview_frame:
                return self.preview_frame
        raise ValueError(self.preview_error or "The live TV picture is taking longer than expected")

    def status(self, allow_screen_without_programme: bool = False) -> dict[str, Any]:
        info = self.source()
        if not info["available"] and not allow_screen_without_programme:
            self.stop()
        with self.lock:
            running = ((self.process is not None and self.process.poll() is None)
                       or (self.preview_process is not None
                           and self.preview_process.poll() is None))
        return {key: value for key, value in info.items() if key != "source"} | {"streaming": running}
