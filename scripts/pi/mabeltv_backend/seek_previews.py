"""Bounded, disposable scrub thumbnails; never command the television player."""
import hashlib
import logging
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
        self.seek_preview_warm_token = ""
        self.seek_preview_warm_pending = []
        self.seek_preview_closed = threading.Event()
        self.seek_preview_urgent = threading.Event()
        self.seek_preview_watcher = None

    def seek_preview_context(self, token, position, mode=None):
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise ValueError("Reopen Scrub for the current programme")
        try:
            position = float(position)
        except (ValueError, TypeError):
            raise ValueError("Choose a position") from None
        if not math.isfinite(position) or position < 0:
            raise ValueError("Choose a position")
        mode = self.player_mode_status() if mode is None else mode
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
        return {"key": key, "identity": identity, "token": token, "path": path, "duration": duration,
                "playback_position": mode.get("playback_position", 0),
                "start": bucket * STEP * FRAMES, "output": self.seek_preview_root / (key + ".jpg")}

    def start_seek_preview_warmer(self):
        """Prepare the playing programme before a phone asks for Scrub."""
        if self.seek_preview_watcher and self.seek_preview_watcher.is_alive():
            return
        self.seek_preview_watcher = threading.Thread(target=self.run_seek_preview_warmer,
                                                     daemon=True, name="mabeltv-preview-warmup")
        self.seek_preview_watcher.start()

    def run_seek_preview_warmer(self):
        while not self.seek_preview_closed.is_set():
            try:
                mode = self.player_mode_status()
                self.warm_seek_previews(mode)
            except (OSError, ValueError, TypeError):
                pass
            self.seek_preview_closed.wait(5)

    def warm_seek_previews(self, mode):
        token = mode.get("seek_token", "") if mode.get("seek_available") is True else ""
        if not token:
            with self.seek_preview_lock:
                self.seek_preview_warm_token = ""
                self.seek_preview_warm_pending = []
            return
        context = self.seek_preview_context(token, mode.get("playback_position", 0), mode)
        with self.seek_preview_lock:
            current = context["start"] // (STEP * FRAMES)
            if self.seek_preview_warm_token != token:
                count = min(360, math.ceil(context["duration"] / (STEP * FRAMES)))
                order = sorted(range(count), key=lambda bucket: abs(bucket - current))
                self.seek_preview_warm_pending = []
                for bucket in order:
                    key = f"{context['identity']}-{bucket}"
                    output = self.seek_preview_root / (key + ".jpg")
                    if not output.is_file():
                        self.seek_preview_warm_pending.append({**context, "key": key, "output": output,
                            "start": bucket * STEP * FRAMES, "background": True})
                self.seek_preview_warm_token = token
            self.seek_preview_warm_pending.sort(key=lambda item: abs(item["start"] // (STEP * FRAMES) - current))
            if self.seek_preview_warm_pending:
                self.start_seek_preview_worker()

    def start_seek_preview_worker(self):
        # Called with the queue lock held. Foreground requests and warmup share
        # this one decoder so opening another phone cannot multiply the work.
        if not self.seek_preview_closed.is_set() and (not self.seek_preview_worker or not self.seek_preview_worker.is_alive()):
            self.seek_preview_worker = threading.Thread(target=self.run_seek_previews, daemon=True,
                                                        name="mabeltv-seek-previews")
            self.seek_preview_worker.start()

    @staticmethod
    def seek_preview_too_warm():
        try:
            return int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) >= 75000
        except (OSError, ValueError):
            return False

    def close_seek_previews(self, timeout=10):
        self.seek_preview_closed.set()
        self.seek_preview_urgent.set()
        for worker in (self.seek_preview_watcher, self.seek_preview_worker):
            if worker:
                worker.join(timeout=timeout)

    def seek_preview(self, token, position, *, background=False):
        context = self.seek_preview_context(token, position)
        output = context["output"]
        if output.is_file():
            output.touch()
            return output.read_bytes()
        if background:
            self.warm_seek_previews({"seek_available": True, "seek_token": token,
                "seek_file": str(context["path"]), "playback_duration": context["duration"],
                "playback_position": context["playback_position"]})
            return None
        with self.seek_preview_lock:
            if self.seek_preview_failures.get(context["key"], 0) > time.monotonic():
                raise ValueError("Preview unavailable for this part")
            if self.seek_preview_current != context["key"]:
                self.seek_preview_pending = context
                self.seek_preview_urgent.set()
            self.start_seek_preview_worker()
        return None

    def run_seek_previews(self):
        while not self.seek_preview_closed.is_set():
            with self.seek_preview_lock:
                self.seek_preview_urgent.clear()
                context = self.seek_preview_pending
                self.seek_preview_pending = None
                if context is None and not self.seek_preview_too_warm():
                    for _ in range(len(self.seek_preview_warm_pending)):
                        candidate = self.seek_preview_warm_pending.pop(0)
                        if candidate["output"].is_file():
                            continue
                        if self.seek_preview_failures.get(candidate["key"], 0) > time.monotonic():
                            self.seek_preview_warm_pending.append(candidate)
                            continue
                        context = candidate
                        break
                if context is None:
                    self.seek_preview_current = None
                    self.seek_preview_worker = None
                    return
                self.seek_preview_current = context["key"]
            started = time.monotonic()
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
                    if context.get("background") and context["token"] == self.seek_preview_warm_token:
                        self.seek_preview_warm_pending.append(context)
            if context.get("background"):
                # Leave CPU time for TV playback; warming never runs at full tilt.
                self.seek_preview_urgent.wait(min(2, max(.2, (time.monotonic() - started) * 2)))

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
            result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                    text=True, timeout=15, check=False)
            if result.returncode or not temporary.is_file() or not 0 < temporary.stat().st_size <= 1024 * 1024:
                logging.getLogger(__name__).warning("Scrub preview failed at %ss: %s", context["start"], (result.stderr or "No image produced")[-600:])
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
