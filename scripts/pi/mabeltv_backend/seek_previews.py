"""Bounded, disposable scrub thumbnails; never command the television player."""
import hashlib
import math
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

STEP, FRAMES, WIDTH, HEIGHT = 10, 8, 256, 144


class SeekPreviewsMixin:
    def initialise_seek_previews(self):
        self.seek_preview_root = self.media_root / ".seek-previews"
        self.seek_preview_lock = threading.Lock()
        self.seek_preview_pending = None
        self.seek_preview_current = None
        self.seek_preview_worker = None
        self.seek_preview_failures = {}

    def seek_preview_context(self, token, position):
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise ValueError("Reopen Scrub for the current programme")
        try:
            position = float(position)
        except (ValueError, TypeError):
            raise ValueError("Choose a position") from None
        if not math.isfinite(position) or position < 0:
            raise ValueError("Choose a position")
        mode = self.player_mode_status()
        if mode.get("seek_available") is not True or mode.get("seek_token") != token:
            raise ValueError("The programme changed. Reopen Scrub")
        path = Path(str(mode.get("seek_file", ""))).resolve()
        if not path.is_relative_to(self.media_root.resolve()) or not path.is_file():
            raise ValueError("No preview available for this source")
        duration = float(mode.get("playback_duration", 0))
        if not math.isfinite(duration) or not 0 < duration <= 604800:
            raise ValueError("No preview available for this source")
        bucket = int(min(position, max(0, duration - 1)) // (STEP * FRAMES))
        stat = path.stat()
        identity = hashlib.sha256(f"{stat.st_dev}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()
        key = f"{identity}-{bucket}"
        return {"key": key, "token": token, "path": path, "duration": duration,
                "start": bucket * STEP * FRAMES, "output": self.seek_preview_root / (key + ".jpg")}

    def seek_preview(self, token, position):
        context = self.seek_preview_context(token, position)
        output = context["output"]
        if output.is_file():
            output.touch()
            return output.read_bytes()
        with self.seek_preview_lock:
            if self.seek_preview_failures.get(context["key"], 0) > time.monotonic():
                raise ValueError("Preview unavailable for this part")
            if self.seek_preview_current != context["key"]:
                self.seek_preview_pending = context
            if not self.seek_preview_worker or not self.seek_preview_worker.is_alive():
                self.seek_preview_worker = threading.Thread(target=self.run_seek_previews, daemon=True,
                                                            name="mabeltv-seek-previews")
                self.seek_preview_worker.start()
        return None

    def run_seek_previews(self):
        while True:
            with self.seek_preview_lock:
                context = self.seek_preview_pending
                self.seek_preview_pending = None
                if context is None:
                    self.seek_preview_current = None
                    self.seek_preview_worker = None
                    return
                self.seek_preview_current = context["key"]
            try:
                fresh = self.seek_preview_context(context["token"], context["start"])
                if fresh["key"] != context["key"]:
                    continue
                self.prepare_seek_preview(context)
                self.prune_seek_previews()
            except (OSError, ValueError, subprocess.SubprocessError):
                with self.seek_preview_lock:
                    now = time.monotonic()
                    self.seek_preview_failures = {key: until for key, until in self.seek_preview_failures.items() if until > now}
                    self.seek_preview_failures[context["key"]] = now + 30

    def prepare_seek_preview(self, context):
        self.seek_preview_root.mkdir(mode=0o750, parents=True, exist_ok=True)
        temporary = context["output"].with_suffix(".part.jpg")
        # A single low-priority worker decodes keyframes into an 80-second strip.
        command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                   "-threads", "1", "-filter_threads", "1", "-skip_frame", "nokey",
                   "-ss", str(context["start"]), "-i", str(context["path"]),
                   "-t", str(STEP * FRAMES), "-an", "-sn", "-vf",
                   f"fps=1/{STEP}:start_time=0,scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
                   f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,tile={FRAMES}x1:nb_frames={FRAMES}",
                   "-frames:v", "1", "-threads", "1", "-q:v", "5", "-update", "1", str(temporary)]
        if shutil.which("nice") and shutil.which("ionice"):
            command = ["nice", "-n", "19", "ionice", "-c", "3", *command]
        try:
            result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=15, check=False)
            if result.returncode or not temporary.is_file() or not 0 < temporary.stat().st_size <= 1024 * 1024:
                raise ValueError("Preview could not be prepared")
            if self.seek_preview_context(context["token"], context["start"])["key"] != context["key"]:
                raise ValueError("The programme changed")
            temporary.replace(context["output"])
        finally:
            temporary.unlink(missing_ok=True)

    def prune_seek_previews(self):
        files = sorted((path for path in self.seek_preview_root.glob("*.jpg")
                        if not path.is_symlink() and re.fullmatch(r"[a-f0-9]{64}-\d+\.jpg", path.name)),
                       key=lambda path: path.stat().st_mtime, reverse=True)
        total = 0
        for path in files:
            total += path.stat().st_size
            if total > 256 * 1024 * 1024:
                path.unlink(missing_ok=True)
