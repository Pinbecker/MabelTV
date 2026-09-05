"""Remote playback behaviour for the local library service."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

from .constants import (
    EXTERNAL_DOWNLOAD_SESSION_SECONDS,
    EXTERNAL_VLC_SESSION_SECONDS,
    NETFLIX_TV_APP_ID,
    REMOTE_BROWSER_EXTENSIONS,
    REMOTE_COMPLETION_FRACTION,
    REMOTE_COMPLETION_MIN_SECONDS,
    REMOTE_RESUME_MIN_SECONDS,
    REMOTE_SESSION_SECONDS,
    SAFE_NAME,
    SUPPORTED_EXTENSIONS,
)
from .lg import (
    LG_TV_APP_SHORTCUTS,
    LG_TV_BUTTONS,
    LG_TV_CATALOG_SECONDS,
    LG_TV_MEDIA_ACTIONS,
    LG_WEBOS_REGISTRATION,
    LgWebOsError,
    LgWebOsSocket,
    RemoteTvActiveError,
    lg_webos_log,
)


class RemotePlaybackMixin:
    def remote_resume_position(self, library_id: str, media_state: dict[str, Any]) -> float:
        """Use the position from the most recently active film session.

        An already-running TV and browser player never read this value again,
        so neither session can make the other one jump.  This choice is only
        applied the next time the film is opened.
        """
        candidates: list[tuple[float, float]] = []
        try:
            candidates.append((
                float(media_state.get("remote_last_watched", 0) or 0),
                float(media_state.get("remote_position", 0) or 0),
            ))
        except (TypeError, ValueError):
            pass
        player_state = self.read_json(self.player_state_path, {})
        if isinstance(player_state, dict):
            positions = player_state.get("adult_positions", {})
            if isinstance(positions, dict):
                try:
                    player_position = float(positions.get(library_id, 0) or 0)
                    ignored = float(media_state.get("ignored_player_position", -1) or -1)
                    # Starting over in a browser must also suppress the older
                    # on-TV bookmark.  Accept that TV bookmark again as soon
                    # as the television genuinely moves to a different point.
                    if ignored < 0 or abs(player_position - ignored) > 5:
                        updates = player_state.get("adult_position_updated_utc_ms", {})
                        updated = float(updates.get(library_id, 0) or 0) / 1000.0 \
                            if isinstance(updates, dict) else 0.0
                        candidates.append((updated, player_position))
                except (TypeError, ValueError):
                    pass
        valid = [(updated, position) for updated, position in candidates if position >= 0]
        timestamped = [item for item in valid if item[0] > 0]
        # State written by an older player has no per-film timestamp. Preserve
        # the established furthest-position fallback until that player next
        # receives this additive state field.
        position = max(timestamped, key=lambda item: item[0])[1] \
            if timestamped and len(timestamped) == len(valid) \
            else max([item[1] for item in valid] or [0])
        duration = self.remote_resume_duration(library_id, media_state)
        return self.normalise_resume_position(position, duration)

    def remote_last_watched(self, library_id: str,
                            media_state: dict[str, Any]) -> float:
        """Return the newest activity timestamp across TV and browser players."""
        try:
            browser_updated = max(
                0.0, float(media_state.get("remote_last_watched", 0) or 0))
        except (TypeError, ValueError):
            browser_updated = 0.0
        player_state = self.read_json(self.player_state_path, {})
        updates = player_state.get("adult_position_updated_utc_ms", {}) \
            if isinstance(player_state, dict) else {}
        try:
            tv_updated = max(0.0, float(updates.get(library_id, 0) or 0) / 1000.0) \
                if isinstance(updates, dict) else 0.0
        except (TypeError, ValueError):
            tv_updated = 0.0
        return max(browser_updated, tv_updated)

    def remote_resume_duration(self, library_id: str,
                               media_state: dict[str, Any]) -> float:
        """Use duration learned from either the television or the browser."""
        candidates: list[float] = []
        try:
            candidates.append(float(media_state.get("remote_duration", 0) or 0))
        except (TypeError, ValueError):
            pass
        player_state = self.read_json(self.player_state_path, {})
        durations = player_state.get("adult_durations", {}) \
            if isinstance(player_state, dict) else {}
        if isinstance(durations, dict):
            try:
                candidates.append(float(durations.get(library_id, 0) or 0))
            except (TypeError, ValueError):
                pass
        return max([value for value in candidates if value >= 0] or [0])

    @staticmethod
    def normalise_resume_position(position: float, duration: float) -> float:
        """Keep only meaningful in-progress positions.

        The start threshold lets a deliberate restart clear Continue Watching.
        At the other end, the final five percent (at least three minutes) is
        treated as credits/completion because TMDB does not publish a reliable
        per-film credits timestamp.
        """
        if position < REMOTE_RESUME_MIN_SECONDS:
            return 0.0
        if duration > 0:
            completion_window = max(
                REMOTE_COMPLETION_MIN_SECONDS,
                duration * REMOTE_COMPLETION_FRACTION,
            )
            completion_window = min(completion_window, duration * 0.20)
            if position >= max(0.0, duration - completion_window):
                return 0.0
        return position

    @staticmethod
    def remote_browser_ready(source: Path) -> bool:
        return source.suffix.lower() in REMOTE_BROWSER_EXTENSIONS

    def remote_tv_running(self) -> bool:
        state = self.read_json(self.player_state_path, {})
        return isinstance(state, dict) and state.get("standby") is not True

    def remote_settings(self) -> dict[str, Any]:
        settings = self.settings()
        return {"allow_simultaneous": settings.get("remote_allow_simultaneous") is True,
                "tv_running": self.remote_tv_running(),
                "active": self.remote_stream_status()}

    def remote_stream_status(self) -> dict[str, Any] | None:
        with self.remote_stream_lock:
            if not self.remote_stream:
                return None
            if float(self.remote_stream.get("expires", 0)) <= time.time():
                self.remote_stream = None
                return None
            return {"kind": self.remote_stream["kind"],
                    "title": self.remote_stream["title"]}

    def remote_source(self, payload: dict[str, Any]) -> tuple[str, Path, str, str | None, float]:
        kind = str(payload.get("kind", ""))
        if kind == "adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Adult film is no longer in the library")
            relative = self.adult_relative_path(source)
            state = self.adult_media_states().get(relative, {})
            library_id = state.get("library_id") if isinstance(state, dict) else None
            if not isinstance(library_id, str):
                # Give old libraries a stable ID before opening a browser stream.
                self.adult_library()
                state = self.adult_media_states().get(relative, {})
                library_id = state.get("library_id") if isinstance(state, dict) else None
            resume = self.remote_resume_position(str(library_id or ""), state if isinstance(state, dict) else {})
            return kind, source, self.display_name(source.name), str(library_id or ""), resume
        if kind == "adult-series":
            series_id = str(payload.get("series", ""))
            source = self.adult_series_path(series_id, str(payload.get("file", "")))
            if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError("That Adult TV episode is no longer in the library")
            relative = source.relative_to(self.adult_series_root / series_id).as_posix()
            key = f"{series_id}/{relative}"
            state = self.adult_series_states()["episodes"].get(key, {})
            if not isinstance(state, dict):
                state = {}
            library_id = str(state.get("library_id") or "")
            resume = self.normalise_resume_position(
                float(state.get("remote_position", 0) or 0),
                float(state.get("remote_duration", 0) or 0))
            parsed = self.adult_episode_identity(source)
            metadata = state.get("metadata", {})
            title = str(metadata.get("title") or parsed["title"]) \
                if isinstance(metadata, dict) else parsed["title"]
            return kind, source, title, library_id, resume
        if kind == "channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV programme") from None
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Mabel TV programme is no longer in the library")
            if self.channel_content_type(channel) == "films":
                channel_number = int(channel["number"])
                resume = self.channel_film_resume_state(channel_number, source.name)
                return (kind, source,
                        self.channel_programme_title(channel_number, source.name),
                        self.channel_programme_key(channel_number, source.name),
                        resume["position"])
            return (kind, source, self.channel_programme_title(
                int(channel["number"]), source.name), None, 0)
        if kind == "usb":
            source = self.usb_resolve(
                str(payload.get("volume", "")), str(payload.get("file", "")))
            if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError("That USB video is no longer available")
            return kind, source, self.display_name(source.name), None, 0
        raise ValueError("Choose an Adult film, Mabel TV programme or USB video")

    @staticmethod
    def _source_fingerprint(source: Path) -> str:
        stat = source.stat()
        identity = f"{source.resolve()}\0{stat.st_size}\0{stat.st_mtime_ns}"
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()

    def _cleanup_external_streams_locked(self) -> None:
        now = time.time()
        self.external_streams = {
            token: stream for token, stream in self.external_streams.items()
            if float(stream.get("expires", 0)) > now or int(stream.get("active", 0)) > 0
        }

    def _issue_external_stream(self, kind: str, source: Path, title: str,
                               purpose: str, subtitle_source: Path | None = None,
                               content_id: str | None = None) -> dict[str, Any]:
        if not source.is_file():
            raise ValueError("That video is no longer available")
        lifetime = (EXTERNAL_DOWNLOAD_SESSION_SECONDS
                    if purpose == "offline" else EXTERNAL_VLC_SESSION_SECONDS)
        token = secrets.token_urlsafe(32)
        stream = {
            "token": token, "kind": kind, "source": source, "title": title,
            "purpose": purpose, "lifetime": lifetime,
            "expires": time.time() + lifetime, "active": 0,
        }
        with self.external_stream_lock:
            self._cleanup_external_streams_locked()
            self.external_streams[token] = stream
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        display_stem = SAFE_NAME.sub("", Path(title).stem).strip(". ") or "MabelTV video"
        display_file_name = f"{display_stem}{source.suffix.lower()}"
        subtitle_url = None
        subtitles = None
        if kind in {"adult", "adult-series"}:
            try:
                caption_source = subtitle_source or source
                if purpose == "vlc":
                    self.browser_subtitles_for_source(caption_source)
                    subtitle_url = f"/api/external/subtitles?{urlencode({'stream': token})}"
                elif purpose == "offline":
                    subtitles = self.browser_subtitles_for_source(caption_source).decode("utf-8")
            except ValueError:
                pass
        return {
            "ok": True, "status": "ready", "title": title,
            "file_name": display_file_name, "size": source.stat().st_size,
            "mime_type": content_type,
            "content_id": content_id or self._source_fingerprint(source),
            "stream": token,
            "stream_url": f"/api/{'offline' if purpose == 'offline' else 'external'}/media?"
                          + urlencode({"stream": token}),
            "subtitle_url": subtitle_url,
            "subtitles": subtitles,
        }

    def start_external_stream(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, _library_id, _resume = self.remote_source(payload)
        return self._issue_external_stream(kind, source, title, "vlc")

    def external_stream_session(self, token: str, begin: bool = False) -> dict[str, Any]:
        with self.external_stream_lock:
            self._cleanup_external_streams_locked()
            stream = self.external_streams.get(token)
            if not stream or not secrets.compare_digest(str(stream.get("token", "")), token):
                raise ValueError("That external playback link has expired")
            source = Path(stream.get("source", ""))
            usb_identity = self._usb_identity_for_source(source)
            if usb_identity:
                self.usb_ensure_awake(usb_identity)
            if not source.is_file():
                self.external_streams.pop(token, None)
                raise ValueError("That video is no longer available")
            stream["expires"] = time.time() + int(stream.get("lifetime", 0))
            if begin:
                stream["active"] = int(stream.get("active", 0)) + 1
            return stream.copy()

    def finish_external_request(self, token: str) -> None:
        with self.external_stream_lock:
            stream = self.external_streams.get(token)
            if stream:
                stream["active"] = max(0, int(stream.get("active", 0)) - 1)
                usb_identity = self._usb_identity_for_source(Path(stream.get("source", "")))
                if usb_identity:
                    self.usb_touch(usb_identity)

    def release_external_stream(self, token: str) -> dict[str, Any]:
        with self.external_stream_lock:
            stream = self.external_streams.pop(token, None)
        if stream:
            usb_identity = self._usb_identity_for_source(Path(stream.get("source", "")))
            if usb_identity:
                self.usb_touch(usb_identity)
        return {"ok": True}

    def external_subtitles(self, token: str) -> bytes:
        stream = self.external_stream_session(token)
        if stream.get("kind") not in {"adult", "adult-series"}:
            raise ValueError("That video has no external subtitle track")
        return self.browser_subtitles_for_source(Path(stream["source"]))

    def offline_media_profile(self, source: Path) -> str:
        """Return direct, repack, audio, or convert for dependable iPhone playback."""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries",
                 "stream=codec_type,codec_name", "-of", "json", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            streams = json.loads(result.stdout).get("streams", [])
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError) as error:
            raise ValueError("MabelTV could not inspect that video for offline playback") from error
        video = next((item for item in streams if item.get("codec_type") == "video"), None)
        audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
        if result.returncode != 0 or not video:
            raise ValueError("MabelTV could not find a playable picture in that file")
        video_codec = str(video.get("codec_name", "")).lower()
        audio_codec = str(audio.get("codec_name", "")).lower() if audio else ""
        suffix = source.suffix.lower()
        apple_container = suffix in {".mp4", ".m4v", ".mov"}
        apple_video = video_codec in {"h264", "hevc"}
        apple_audio = not audio_codec or audio_codec == "aac"
        if apple_container and apple_video and apple_audio:
            return "direct"
        if apple_video and apple_audio:
            return "repack"
        if apple_video:
            return "audio"
        return "convert"

    def _offline_prepared_path(self, job_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{64}", job_id):
            raise ValueError("That offline preparation is not valid")
        return self.offline_cache / f"{job_id}.mp4"

    def _offline_job_response(self, job: dict[str, Any]) -> dict[str, Any]:
        return {key: job[key] for key in
                ("id", "status", "title", "preparation", "message") if key in job}

    def start_offline_download(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, _library_id, _resume = self.remote_source(payload)
        preparation = self.offline_media_profile(source)
        if preparation == "direct":
            return self._issue_external_stream(kind, source, title, "offline")
        job_id = self._source_fingerprint(source)
        destination = self._offline_prepared_path(job_id)
        if destination.is_file():
            destination.touch()
            return self._issue_external_stream(
                kind, destination, title, "offline", source, job_id)
        with self.offline_preparation_lock:
            existing = self.offline_preparations.get(job_id)
            if existing and existing.get("status") in {"preparing", "queued"}:
                return self._offline_job_response(existing)
            reserve = min(source.stat().st_size, 8 * 1024 * 1024 * 1024) + 512 * 1024 * 1024
            if shutil.disk_usage(self.media_root).free < reserve:
                raise ValueError("There is not enough Pi storage to prepare this video for offline viewing")
            descriptions = {
                "repack": "Quickly repackaging this video for iPhone",
                "audio": "Preparing iPhone-compatible sound without changing the picture",
                "convert": "Converting this video for dependable offline playback",
            }
            job = {
                "id": job_id, "status": "queued", "kind": kind,
                "source": source, "destination": destination, "title": title,
                "preparation": preparation, "message": descriptions[preparation],
            }
            self.offline_preparations[job_id] = job
        threading.Thread(target=self._run_offline_preparation, args=(job_id,),
                         name=f"mabeltv-offline-{job_id[:8]}", daemon=True).start()
        return self._offline_job_response(job)

    def _run_offline_preparation(self, job_id: str) -> None:
        with self.offline_preparation_lock:
            job = self.offline_preparations[job_id]
            job["status"] = "preparing"
            source = Path(job["source"])
            destination = Path(job["destination"])
            preparation = str(job["preparation"])
        temporary = self.offline_cache / f".{job_id}.part.mp4"
        log_path = self.offline_cache / f".{job_id}.ffmpeg.log"
        try:
            with self.adult_optimisation_serial:
                if not source.is_file():
                    raise ValueError("The original video is no longer available")
                if preparation == "convert":
                    self._convert_for_offline_playback(source, destination, job_id)
                else:
                    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                               "-y", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
                               "-sn", "-c:v", "copy", "-c:a",
                               "copy" if preparation == "repack" else "aac"]
                    if preparation == "audio":
                        command += ["-b:a", "160k"]
                    command += ["-movflags", "+faststart", str(temporary)]
                    with log_path.open("wb") as errors:
                        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=errors,
                                                timeout=45 * 60, check=False)
                    if result.returncode != 0:
                        raise ValueError("MabelTV could not prepare that video for iPhone")
                    if self.offline_media_profile(temporary) != "direct":
                        raise ValueError("The prepared video did not pass its iPhone playback check")
                    os.replace(temporary, destination)
            with self.offline_preparation_lock:
                job["status"] = "ready"
                job["message"] = "Ready to download"
        except Exception as error:
            with self.offline_preparation_lock:
                job["status"] = "error"
                job["message"] = (str(error) if isinstance(error, ValueError)
                                  else "MabelTV could not prepare that video")
        finally:
            temporary.unlink(missing_ok=True)
            log_path.unlink(missing_ok=True)

    def _convert_for_offline_playback(self, source: Path, destination: Path,
                                      job_id: str) -> None:
        """Create an iPhone-safe copy quickly, without upscaling small USB videos."""
        temporary = self.offline_cache / f".{job_id}.part.mp4"
        error_log = self.offline_cache / f".{job_id}.ffmpeg.log"
        try:
            duration_result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            duration = max(0.0, float(duration_result.stdout.strip()))
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            duration = 0.0
        command = [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-threads", "2", "-filter_threads", "2", "-i", str(source),
            "-map", "0:v:0", "-map", "0:a:0?", "-sn",
            "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':"
                   "force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "main",
            "-level:v", "3.1", "-crf", "23", "-maxrate", "2500k",
            "-bufsize", "5000k", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-b:a", "128k", "-movflags", "+faststart", "-progress", "pipe:1",
            "-nostats", str(temporary),
        ]
        process: subprocess.Popen[str] | None = None
        deadline = time.monotonic() + 45 * 60
        last_percent = -1
        try:
            with error_log.open("wb") as errors:
                process = subprocess.Popen(
                    command, stdout=subprocess.PIPE, stderr=errors, text=True,
                    start_new_session=True)
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("MabelTV stopped this conversion because it took too long")
                    line = process.stdout.readline() if process.stdout else ""
                    if not line.startswith(("out_time_us=", "out_time_ms=")) or duration <= 0:
                        continue
                    try:
                        completed = float(line.split("=", 1)[1].strip()) / 1_000_000
                    except (TypeError, ValueError):
                        continue
                    percent = min(99, max(0, int(completed * 100 / duration)))
                    if percent < last_percent + 2:
                        continue
                    last_percent = percent
                    with self.offline_preparation_lock:
                        job = self.offline_preparations.get(job_id)
                        if job:
                            job["message"] = f"Converting for offline playback · {percent}%"
                if process.returncode != 0:
                    details = error_log.read_text(encoding="utf-8", errors="replace").strip()
                    if details:
                        print(details[-4000:], file=sys.stderr, flush=True)
                    raise ValueError("MabelTV could not convert that video for offline playback")
            if self.offline_media_profile(temporary) != "direct":
                raise ValueError("The converted video did not pass its iPhone playback check")
            os.replace(temporary, destination)
        finally:
            if process is not None and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            temporary.unlink(missing_ok=True)
            error_log.unlink(missing_ok=True)

    def offline_preparation_status(self, job_id: str) -> dict[str, Any]:
        with self.offline_preparation_lock:
            job = self.offline_preparations.get(job_id)
            if not job:
                destination = self._offline_prepared_path(job_id)
                if destination.is_file():
                    raise ValueError("Open the video again to resume its download")
                raise ValueError("That offline preparation is no longer available")
            snapshot = job.copy()
        if snapshot.get("status") == "ready":
            destination = Path(snapshot["destination"])
            destination.touch()
            return self._issue_external_stream(
                str(snapshot["kind"]), destination, str(snapshot["title"]), "offline",
                Path(snapshot["source"]), job_id)
        return self._offline_job_response(snapshot)

    def start_remote_stream(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, library_id, resume = self.remote_source(payload)
        if "position" in payload:
            try:
                resume = max(0.0, float(payload.get("position", 0)))
            except (TypeError, ValueError) as error:
                raise ValueError("That playback position is not valid") from error
        if not self.remote_browser_ready(source):
            raise ValueError("This file is not browser-ready. Use an MP4 or M4V version for remote viewing.")
        settings = self.remote_settings()
        if settings["tv_running"] and not settings["allow_simultaneous"]:
            raise RemoteTvActiveError("Mabel TV is playing. Stop it first, or allow simultaneous playback in Settings.")
        with self.remote_stream_lock:
            # The portal deliberately supports one remote viewer. Selecting a
            # different title in that viewer must replace its previous stream;
            # otherwise a missed pagehide/sendBeacon leaves the entire Watch
            # section locked until the session timeout expires.
            token = secrets.token_urlsafe(24)
            self.remote_stream = {"token": token, "kind": kind, "source": source,
                                  "title": title, "library_id": library_id,
                                  "expires": time.time() + REMOTE_SESSION_SECONDS}
            if kind == "channel":
                channel_number = int(payload.get("channel", 0))
                channel = self.channel(channel_number)
                self.remote_stream.update({
                    "channel": channel_number, "file": source.name,
                    "content_kind": "film" if self.channel_content_type(channel) == "films"
                    else "episode",
                })
        base = urlencode({"stream": token})
        subtitle_url = None
        if kind in {"adult", "adult-series"}:
            browser_sidecars = [path for path in self.subtitle_sidecars(source)
                                if path.suffix.lower() in {".vtt", ".srt"}]
            if browser_sidecars:
                subtitle_url = f"/api/remote/subtitles?{base}"
        return {"ok": True, "title": title, "kind": kind,
                "resume_enabled": bool(library_id) or "position" in payload,
                "resume_position": resume,
                "stream_url": f"/api/remote/media?{base}",
                # The browser attaches this only after the video itself has
                # reached canplay. That keeps iOS source negotiation isolated
                # from the external text track while still exposing native CC.
                "subtitle_url": subtitle_url}

    def remote_session(self, token: str) -> dict[str, Any]:
        with self.remote_stream_lock:
            current = self.remote_stream
            if not current:
                raise ValueError("That remote viewing session has expired")
            if float(current.get("expires", 0)) <= time.time():
                self.remote_stream = None
                raise ValueError("That remote viewing session has expired")
            # A late media/range/heartbeat request from the previous page must
            # never erase the replacement stream that is now active.
            if not secrets.compare_digest(str(current.get("token", "")), token):
                raise ValueError("That remote viewing session has expired")
            current["expires"] = time.time() + REMOTE_SESSION_SECONDS
            return current.copy()

    def remote_stop_tv(self) -> dict[str, Any]:
        if not self.remote_tv_running():
            return {"ok": True, "message": "Mabel TV is already off"}
        self.live_tv_control({"command": "turn-off"})
        return {"ok": True, "message": "Mabel TV has been stopped for remote viewing"}

    def remote_release(self, token: str) -> dict[str, Any]:
        with self.remote_stream_lock:
            if self.remote_stream and secrets.compare_digest(
                    str(self.remote_stream.get("token", "")), token):
                usb_identity = self._usb_identity_for_source(
                    Path(self.remote_stream.get("source", "")))
                self.remote_stream = None
                if usb_identity:
                    self.usb_touch(usb_identity)
        with self.viewing_lock:
            self.viewing_remote_samples.pop(token, None)
        return {"ok": True}

    def remote_save_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        token = str(payload.get("stream", ""))
        session = self.remote_session(token)
        try:
            position = max(0.0, float(payload.get("position", 0)))
            duration = max(0.0, float(payload.get("duration", 0)))
        except (TypeError, ValueError) as error:
            raise ValueError("That playback position is not valid") from error
        self.record_remote_viewing(session, token, position, duration)
        if not session.get("library_id"):
            return {"ok": True}
        if session["kind"] == "channel":
            command = {
                "command": "save-channel-film-position",
                "channel": int(session["channel"]),
                "file": str(session["file"]),
                "position": self.normalise_resume_position(position, duration),
                "duration": duration,
            }
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2)
                    client.connect("/run/mabeltv/portal-control.sock")
                    client.sendall((json.dumps(command, separators=(",", ":"))
                                    + "\n").encode())
                    reply = client.recv(32).decode(errors="replace").strip()
            except OSError as error:
                raise ValueError("Mabel TV could not save that film position") from error
            if reply != "ok":
                raise ValueError("Mabel TV could not save that film position")
            return {"ok": True}
        if session["kind"] == "adult-series":
            with self.config_lock:
                states = self.adult_series_states()
                source = Path(session["source"])
                relative = source.relative_to(self.adult_series_root).as_posix()
                state = states["episodes"].get(relative, {})
                if not isinstance(state, dict):
                    state = {}
                saved_position = self.normalise_resume_position(position, duration)
                state.update({
                    "remote_position": saved_position,
                    "remote_duration": duration,
                    "remote_last_watched": time.time(),
                })
                if duration > 0 and position >= duration * .92:
                    state["watched"] = True
                states["episodes"][relative] = state
                self.write_adult_series_states(states)
            return {"ok": True}
        if session["kind"] != "adult":
            return {"ok": True}
        with self.config_lock:
            states = self.adult_media_states()
            relative = self.adult_relative_path(session["source"])
            state = states.get(relative, {})
            if not isinstance(state, dict): state = {}
            saved_position = self.normalise_resume_position(position, duration)
            state["remote_position"] = saved_position
            state["remote_duration"] = duration
            state["remote_last_watched"] = time.time()
            if saved_position == 0:
                player_state = self.read_json(self.player_state_path, {})
                positions = player_state.get("adult_positions", {}) \
                    if isinstance(player_state, dict) else {}
                try:
                    state["ignored_player_position"] = float(
                        positions.get(session["library_id"], 0) or 0)
                except (AttributeError, TypeError, ValueError):
                    state["ignored_player_position"] = 0.0
            else:
                state.pop("ignored_player_position", None)
            states[relative] = state
            self.write_adult_media_states(states)
        return {"ok": True}

    def remote_clear_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Explicitly remove a film from Continue Watching.

        This does not depend on a browser player having opened or managed to
        send its final time update.  The current on-TV bookmark is remembered
        as ignored as well, so an older television position cannot immediately
        put the film back into Continue Watching.
        """
        kind, source, _title, library_id, _resume = self.remote_source(payload)
        if kind != "adult" or not library_id:
            raise ValueError("Choose an Adult film to clear")
        with self.config_lock:
            states = self.adult_media_states()
            relative = self.adult_relative_path(source)
            state = states.get(relative, {})
            if not isinstance(state, dict):
                state = {}
            state["remote_position"] = 0.0
            state["remote_last_watched"] = 0.0
            player_state = self.read_json(self.player_state_path, {})
            positions = player_state.get("adult_positions", {}) \
                if isinstance(player_state, dict) else {}
            try:
                state["ignored_player_position"] = float(
                    positions.get(library_id, 0) or 0)
            except (AttributeError, TypeError, ValueError):
                state["ignored_player_position"] = 0.0
            states[relative] = state
            self.write_adult_media_states(states)
        return {"ok": True}

    def set_favourite(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Persist a portal-only film or series-channel favourite."""
        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError("Choose whether this film is a favourite")
        kind = str(payload.get("kind", ""))
        if kind == "adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Adult film is no longer in the library")
            relative = self.adult_relative_path(source)
            with self.config_lock:
                states = self.adult_media_states()
                state = states.get(relative, {})
                if not isinstance(state, dict):
                    state = {}
                if not state.get("library_id"):
                    state["library_id"] = uuid.uuid4().hex
                state["favourite"] = enabled
                states[relative] = state
                self.write_adult_media_states(states)
            return {"ok": True, "kind": kind, "file": relative,
                    "favourite": enabled}
        if kind == "channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV film") from None
            if self.channel_content_type(channel) != "films":
                raise ValueError("Only Mabel TV films can be favourites")
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Mabel TV film is no longer in the library")
            key = self.channel_programme_key(int(channel["number"]), source.name)
            with self.config_lock:
                states = self.channel_media_states()
                stored_favourites = states.get("favourites", [])
                favourites = set(stored_favourites) \
                    if isinstance(stored_favourites, list) else set()
                if enabled:
                    favourites.add(key)
                else:
                    favourites.discard(key)
                states.update({"favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
            return {"ok": True, "kind": kind,
                    "channel": int(channel["number"]), "file": source.name,
                    "favourite": enabled}
        if kind == "series-channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV channel") from None
            if self.channel_content_type(channel) != "shows":
                raise ValueError("Only Mabel TV episode channels can be favourites")
            number = int(channel["number"])
            with self.config_lock:
                states = self.channel_media_states()
                stored = states.get("favourite_channels", [])
                favourites = {
                    int(value) for value in stored
                    if isinstance(value, int)
                    or (isinstance(value, str) and value.isdigit())
                } if isinstance(stored, list) else set()
                if enabled:
                    favourites.add(number)
                else:
                    favourites.discard(number)
                states.update({"favourite_channels": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
            return {"ok": True, "kind": kind, "channel": number,
                    "favourite": enabled}
        if kind == "adult-series":
            series_id = str(payload.get("series", ""))
            self.adult_series_path(series_id)
            with self.config_lock:
                states = self.adult_series_states()
                series = states["series"].get(series_id)
                if not isinstance(series, dict):
                    raise ValueError("That Adult TV series is no longer available")
                series["favourite"] = enabled
                states["series"][series_id] = series
                self.write_adult_series_states(states)
            return {"ok": True, "kind": kind, "series": series_id,
                    "favourite": enabled}
        raise ValueError(
            "Choose an Adult TV film, Adult TV series, Mabel TV film, or episode channel")

    def remote_subtitles(self, token: str) -> bytes:
        session = self.remote_session(token)
        if session["kind"] not in {"adult", "adult-series"}:
            raise ValueError("This Mabel TV programme has no browser subtitle track")
        return self.browser_subtitles_for_source(session["source"])

    def browser_subtitles_for_source(self, source: Path) -> bytes:
        sidecars = self.subtitle_sidecars(source)
        preferred = next((path for path in sidecars if path.suffix.lower() == ".vtt"), None)
        preferred = preferred or next((path for path in sidecars if path.suffix.lower() == ".srt"), None)
        if not preferred:
            raise ValueError("No browser subtitle track is available for this film")
        text = preferred.read_text(encoding="utf-8-sig", errors="replace")
        if not text.lstrip().startswith("WEBVTT"):
            text = "WEBVTT\n\n" + re.sub(r"(\d\d:\d\d:\d\d),(\d{3})", r"\1.\2", text)
        return text.encode("utf-8")

    def lg_tv_client_key(self) -> str:
        try:
            return self.lg_tv_client_key_path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def save_lg_tv_client_key(self, key: str) -> None:
        if not key or len(key) > 512:
            raise LgWebOsError("The connected LG TV returned an invalid pairing key")
        self.lg_tv_client_key_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.lg_tv_client_key_path.with_name(
            f".{self.lg_tv_client_key_path.name}.{secrets.token_hex(6)}")
        try:
            temporary.write_text(key + "\n", encoding="utf-8")
            temporary.chmod(0o600)
            os.replace(temporary, self.lg_tv_client_key_path)
        finally:
            temporary.unlink(missing_ok=True)

    def lg_tv_session(self) -> LgWebOsSocket:
        if not self.lg_tv_host:
            raise ValueError("Connected TV control has not been configured for this MabelTV yet")
        session = LgWebOsSocket(self.lg_tv_host, self.lg_tv_client_key())
        session.connect()
        registration = json.loads(json.dumps(LG_WEBOS_REGISTRATION))
        if session.client_key:
            registration["payload"]["client-key"] = session.client_key
        lg_webos_log(f"registration JSON sent; stored_client_key={'YES' if session.client_key else 'NO'}")
        session.send(registration)
        first = session.receive()
        if first.get("type") == "response" and \
                first.get("payload", {}).get("pairingType") == "PROMPT":
            lg_webos_log("pairing prompt response received; waiting for user approval")
            first = session.receive()
        if first.get("type") != "registered":
            lg_webos_log("registration did not reach registered state")
            session.close()
            raise LgWebOsError("Approve MabelTV's control request on the LG TV, then try Netflix again")
        key = str(first.get("payload", {}).get("client-key") or "")
        lg_webos_log(f"registered message received; client_key={'YES' if key else 'NO'}")
        if key and key != session.client_key:
            self.save_lg_tv_client_key(key)
            session.client_key = key
        if not session.client_key:
            session.close()
            raise LgWebOsError("Approve MabelTV's control request on the LG TV, then try Netflix again")
        return session

    @staticmethod
    def lg_response_ok(response: dict[str, Any]) -> bool:
        return response.get("type") == "response" and response.get("payload", {}).get("returnValue") is not False

    def lg_tv_session_request(self, session: LgWebOsSocket, uri: str,
                              payload: dict[str, Any] | None = None,
                              request_id: str = "lg-remote") -> dict[str, Any]:
        request: dict[str, Any] = {"id": request_id, "type": "request", "uri": uri}
        if payload is not None:
            request["payload"] = payload
        session.send(request)
        response = session.receive()
        if not self.lg_response_ok(response):
            raise LgWebOsError("The connected LG TV could not complete that command")
        return response.get("payload", {})

    def lg_tv_request(self, uri: str, payload: dict[str, Any] | None = None, request_id: str = "lg-remote") -> dict[str, Any]:
        """Make one authenticated SSAP request, keeping the pairing secret on the Pi."""
        with self.lg_tv_lock:
            session: LgWebOsSocket | None = None
            try:
                session = self.lg_tv_session()
                return self.lg_tv_session_request(session, uri, payload, request_id)
            except LgWebOsError:
                raise
            except (OSError, ssl.SSLError) as error:
                lg_webos_log(f"command connection failed: {type(error).__name__}")
                raise LgWebOsError("Connected TV unavailable") from error
            finally:
                if session is not None:
                    session.close()

    @staticmethod
    def lg_normalised_name(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()

    def lg_tv_catalog(self, session: LgWebOsSocket,
                      force: bool = False) -> dict[str, Any]:
        if self.lg_tv_catalog_cache and not force and \
                time.monotonic() - self.lg_tv_catalog_updated < LG_TV_CATALOG_SECONDS:
            return self.lg_tv_catalog_cache

        cached = self.lg_tv_catalog_cache or {}
        apps = list(cached.get("apps", []))
        inputs = list(cached.get("inputs", []))
        apps_known = bool(cached.get("apps_known", apps))
        inputs_known = bool(cached.get("inputs_known", inputs))
        errors: list[LgWebOsError] = []
        try:
            apps_payload = self.lg_tv_session_request(
                session, "ssap://com.webos.applicationManager/listLaunchPoints",
                request_id="lg-app-catalog")
            apps = [item for item in apps_payload.get("launchPoints", [])
                    if isinstance(item, dict) and item.get("id")]
            apps_known = True
        except LgWebOsError as error:
            errors.append(error)
        try:
            inputs_payload = self.lg_tv_session_request(
                session, "ssap://tv/getExternalInputList", request_id="lg-input-catalog")
            inputs = [item for item in inputs_payload.get("devices", [])
                      if isinstance(item, dict)]
            inputs_known = True
        except LgWebOsError as error:
            errors.append(error)
        if not apps_known and not inputs_known and errors:
            raise errors[0]
        resolved: dict[str, str] = {}
        by_id = {str(item.get("id")): item for item in apps}
        for key, definition in LG_TV_APP_SHORTCUTS.items():
            app_id = next((candidate for candidate in definition["ids"]
                           if candidate in by_id), "")
            if not app_id:
                wanted = {self.lg_normalised_name(title)
                          for title in definition["titles"]}
                for item in apps:
                    title = self.lg_normalised_name(
                        item.get("title") or item.get("name") or item.get("appDescription"))
                    if title in wanted or any(value and value in title for value in wanted):
                        app_id = str(item["id"])
                        break
            if app_id:
                resolved[key] = app_id
        catalog = {
            "apps": apps, "inputs": inputs, "shortcuts": resolved,
            "apps_known": apps_known, "inputs_known": inputs_known,
        }
        self.lg_tv_catalog_cache = catalog
        self.lg_tv_catalog_updated = time.monotonic()
        return catalog

    def lg_tv_app_label(self, app_id: str, catalog: dict[str, Any]) -> tuple[str, str]:
        for item in catalog.get("inputs", []):
            if str(item.get("appId") or "") == app_id:
                label = str(item.get("label") or item.get("inputId") or "HDMI")
                return label, label
        for item in catalog.get("apps", []):
            if str(item.get("id") or "") == app_id:
                return str(item.get("title") or item.get("name") or app_id), ""
        for definition in LG_TV_APP_SHORTCUTS.values():
            if app_id in definition["ids"]:
                return str(definition["label"]), ""
        if app_id == "com.webos.app.livetv":
            return "Live TV", "Live TV"
        return app_id, ""

    def lg_tv_status(self) -> dict[str, Any]:
        status = {
            "configured": bool(self.lg_tv_host), "connected": False,
            "power": "off", "app": "", "app_id": "", "input": "",
            "volume": None, "muted": False, "catalog_known": False,
            "available_apps": [],
        }
        if not self.lg_tv_host:
            return status
        try:
            with self.lg_tv_lock:
                session = self.lg_tv_session()
                try:
                    app = self.lg_tv_session_request(
                        session,
                        "ssap://com.webos.applicationManager/getForegroundAppInfo",
                        request_id="lg-status-app")
                    volume = self.lg_tv_session_request(
                        session, "ssap://audio/getVolume",
                        request_id="lg-status-volume")
                    try:
                        catalog = self.lg_tv_catalog(session)
                        catalog_known = bool(catalog.get(
                            "apps_known", catalog.get("apps")))
                    except LgWebOsError:
                        catalog = self.lg_tv_catalog_cache
                        catalog_known = bool(catalog)
                finally:
                    session.close()
            app_id = str(app.get("appId") or app.get("appName") or "")
            app_label, input_label = self.lg_tv_app_label(app_id, catalog)
            volume_status = volume.get("volumeStatus", volume)
            status.update({
                "connected": True, "power": "on", "app": app_label,
                "app_id": app_id, "input": input_label,
                "volume": volume_status.get("volume"),
                "muted": bool(volume_status.get(
                    "muteStatus", volume_status.get("mute", False))),
                "catalog_known": catalog_known,
                "available_apps": sorted(catalog.get("shortcuts", {})),
            })
        except (LgWebOsError, OSError, ssl.SSLError):
            pass
        return status

    def close_lg_tv_pointer(self) -> None:
        if self.lg_tv_pointer_socket is not None:
            self.lg_tv_pointer_socket.close()
            self.lg_tv_pointer_socket = None

    def open_lg_tv_pointer(self) -> LgWebOsSocket:
        if self.lg_tv_pointer_socket is not None and \
                self.lg_tv_pointer_socket.connection is not None:
            return self.lg_tv_pointer_socket
        control: LgWebOsSocket | None = None
        try:
            control = self.lg_tv_session()
            response = self.lg_tv_session_request(
                control, "ssap://com.webos.service.networkinput/getPointerInputSocket",
                request_id="lg-pointer-socket")
            socket_path = str(response.get("socketPath") or "")
            parsed = urlsplit(socket_path)
            if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
                raise LgWebOsError("The connected LG TV did not provide pointer control")
            pointer = LgWebOsSocket(parsed.hostname)
            path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            pointer.connect(path, parsed.port or (443 if parsed.scheme == "wss" else 3000),
                            parsed.scheme == "wss")
            self.lg_tv_pointer_socket = pointer
            return pointer
        finally:
            if control is not None:
                control.close()

    def lg_tv_pointer(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send one command through LG's reusable pointer-input socket."""
        if action == "pointer-click":
            message = "type:click\n\n"
        elif action == "pointer-scroll":
            message = (f"type:scroll\ndx:{int(payload.get('dx', 0))}"
                       f"\ndy:{int(payload.get('dy', 0))}\n\n")
        elif action == "pointer-move":
            message = (f"type:move\ndx:{int(payload.get('dx', 0))}"
                       f"\ndy:{int(payload.get('dy', 0))}\ndown:0\n\n")
        elif action == "button":
            name = str(payload.get("name") or "")
            if name not in {*LG_TV_BUTTONS.values(), "CHANNELUP", "CHANNELDOWN",
                            "PLAY", "PAUSE", "REWIND", "FASTFORWARD"}:
                raise ValueError("That connected TV button is not available")
            message = f"type:button\nname:{name}\n\n"
        else:
            raise ValueError("That pointer command is not available")

        with self.lg_tv_lock:
            error: Exception | None = None
            for attempt in range(2):
                try:
                    self.open_lg_tv_pointer().send_text(message)
                    return {"ok": True, "message": "Command sent to connected TV"}
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                    self.close_lg_tv_pointer()
                    if attempt == 0:
                        lg_webos_log("pointer session lost; reconnecting")
            raise LgWebOsError("TV control session lost. Please try again.") from error

    def lg_tv_launch_shortcut(self, shortcut: str) -> dict[str, Any]:
        definition = LG_TV_APP_SHORTCUTS.get(shortcut)
        if not definition:
            raise ValueError("That TV app is not available in MabelTV")
        mode = self.player_mode_status()
        waking = str(mode.get("connected_tv_power") or "").lower() not in {"on", "active"}
        if waking:
            self.wake_connected_tv_only()
        deadline = time.monotonic() + (20 if waking else 5)
        error: Exception | None = None
        with self.lg_tv_lock:
            while time.monotonic() < deadline:
                session: LgWebOsSocket | None = None
                try:
                    session = self.lg_tv_session()
                    catalog = self.lg_tv_catalog(session, force=True)
                    app_id = str(catalog.get("shortcuts", {}).get(shortcut) or "")
                    if not app_id:
                        raise LgWebOsError(f"{definition['label']} is not installed on the connected TV")
                    self.lg_tv_session_request(
                        session, "ssap://system.launcher/launch", {"id": app_id},
                        request_id="lg-launch")
                    return {"ok": True, "message": f"Opening {definition['label']} on TV…",
                            "waking": waking}
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                    if isinstance(caught, LgWebOsError) and "not installed" in str(caught):
                        break
                finally:
                    if session is not None:
                        session.close()
                time.sleep(1)
        raise LgWebOsError(str(error or "Connected TV unavailable"))

    def lg_tv_switch_to_mabeltv(self) -> dict[str, Any]:
        preferred = os.environ.get("MABELTV_LG_TV_INPUT_ID", "HDMI_1").strip() or "HDMI_1"
        with self.lg_tv_lock:
            session: LgWebOsSocket | None = None
            try:
                session = self.lg_tv_session()
                catalog = self.lg_tv_catalog(session, force=True)
                inputs = catalog.get("inputs", [])
                selected = next((item for item in inputs
                                 if "mabeltv" in self.lg_normalised_name(item.get("label"))), None)
                selected = selected or next((item for item in inputs
                                             if str(item.get("inputId") or "").casefold()
                                             == preferred.casefold()), None)
                input_id = str((selected or {}).get("inputId") or preferred)
                self.lg_tv_session_request(
                    session, "ssap://tv/switchInput", {"inputId": input_id},
                    request_id="lg-mabeltv-input")
                return {"ok": True, "message": "Switching to MabelTV…"}
            finally:
                if session is not None:
                    session.close()

    def lg_tv_open_input_picker(self) -> dict[str, Any]:
        error: Exception | None = None
        for app_id in ("com.webos.app.inputpicker", "com.webos.app.inputmgr"):
            try:
                self.lg_tv_request(
                    "ssap://system.launcher/launch", {"id": app_id},
                    request_id="lg-input-picker")
                return {"ok": True, "message": "Opening TV inputs…"}
            except LgWebOsError as caught:
                error = caught
        raise LgWebOsError("The connected TV could not open its input picker") from error

    def lg_tv_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = str(payload.get("action") or "").strip().lower()
        if action == "power-on":
            self.wake_connected_tv_only()
            return {"ok": True, "message": "Turning on connected TV…", "waking": True}
        if action == "power-off":
            self.lg_tv_request("ssap://system/turnOff", request_id="lg-power-off")
            self.close_lg_tv_pointer()
            return {"ok": True, "message": "Turning off connected TV…"}
        if action == "launch":
            shortcut = str(payload.get("app") or "").strip().lower()
            if shortcut == "live-tv":
                self.lg_tv_request(
                    "ssap://system.launcher/launch", {"id": "com.webos.app.livetv"},
                    request_id="lg-live-tv")
                return {"ok": True, "message": "Opening Live TV…"}
            if shortcut == "mabeltv":
                return self.lg_tv_switch_to_mabeltv()
            return self.lg_tv_launch_shortcut(shortcut)
        if action == "input":
            return self.lg_tv_open_input_picker()
        if action in {"pointer-move", "pointer-click", "pointer-scroll"}:
            return self.lg_tv_pointer(action, payload)
        if action in LG_TV_BUTTONS:
            return self.lg_tv_pointer("button", {"name": LG_TV_BUTTONS[action]})
        if action in LG_TV_MEDIA_ACTIONS:
            self.lg_tv_request(LG_TV_MEDIA_ACTIONS[action], request_id=f"lg-{action}")
            return {"ok": True, "message": "Command sent to connected TV"}
        if action == "volume-up":
            uri, command = "ssap://audio/volumeUp", None
        elif action == "volume-down":
            uri, command = "ssap://audio/volumeDown", None
        elif action == "mute":
            uri, command = "ssap://audio/setMute", {"mute": bool(payload.get("mute", True))}
        else:
            raise ValueError("That connected TV command is not available")
        self.lg_tv_request(uri, command, f"lg-{action}")
        return {"ok": True, "message": "Command sent to connected TV"}

    def play_netflix_on_tv(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Wake the connected display when necessary, then launch one Netflix title."""
        self.adult_title_key(str(payload.get("media_type", "")), payload.get("tmdb_id"))
        content_id = self.netflix_content_id(payload.get("destination"))
        title = str(payload.get("title") or "this Netflix title").strip()[:180]
        mode = self.player_mode_status()
        waking = str(mode.get("connected_tv_power") or "").lower() not in {"on", "active"}
        lg_webos_log(f"Netflix Play on TV request received; waking={waking}")
        if waking:
            self.wake_connected_tv_only()
        # Queue the wake and immediately begin the bounded SSAP retry loop.
        # This preserves the proven wake-and-launch timing while deliberately
        # avoiding CEC Active Source, which would switch the TV to HDMI 1.
        deadline = time.monotonic() + (20 if waking else 5)
        error: Exception | None = None
        with self.lg_tv_lock:
            while time.monotonic() < deadline:
                session: LgWebOsSocket | None = None
                try:
                    session = self.lg_tv_session()
                    lg_webos_log("Netflix launch request sent")
                    session.send({"id": "netflix-launch", "type": "request",
                                  "uri": "ssap://system.launcher/launch",
                                  "payload": {"id": NETFLIX_TV_APP_ID,
                                              "contentId": content_id}})
                    response = session.receive()
                    lg_webos_log(
                        "Netflix launch response received; "
                        f"returnValue={response.get('payload', {}).get('returnValue')!r}")
                    if response.get("type") == "response" and \
                            response.get("payload", {}).get("returnValue") is True:
                        return {"ok": True, "message": f"Opening {title} on Netflix",
                                "waking": waking}
                    error = LgWebOsError("The LG TV could not open that Netflix title")
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                finally:
                    if session is not None:
                        session.close()
                time.sleep(1)
        raise ValueError(str(error or "The connected LG TV could not open Netflix"))

    def live_tv_status(self) -> dict[str, Any]:
        mode = self.player_mode_status()
        adult_mode = mode.get("mode") == "adult"
        status = self.live_stream.status(allow_screen_without_programme=adult_mode)
        for field in ("volume", "muted", "remote_locked", "standby", "subtitles_available",
                      "subtitles_visible", "widescreen_available", "widescreen_enabled",
                      "adult_handoff_available",
                      "connected_tv_available", "connected_tv_power"):
            if field in mode:
                status[field] = mode[field]
        if adult_mode:
            playing = mode.get("playing") is True
            status.update({
                "available": mode.get("standby") is not True,
                "adult_mode": True,
                "adult_playing": playing,
                "programme": str(mode.get("programme") or "Film library")
                             if playing else "Film library",
                "paused": mode.get("paused") is True,
            })
            try:
                status["playback_position"] = round(max(
                    0.0, float(mode.get("playback_position", 0) or 0)))
                status["playback_duration"] = round(max(
                    0.0, float(mode.get("playback_duration", 0) or 0)))
            except (TypeError, ValueError):
                status["playback_position"] = 0
                status["playback_duration"] = 0
            status.pop("reason", None)
        else:
            activity = self.current_tv_viewing(mode)
            if activity:
                status["playback_position"] = round(max(
                    0.0, float(activity.get("position", 0) or 0)))
                status["playback_duration"] = round(max(
                    0.0, float(activity.get("media_duration", 0) or 0)))
        return status

    def player_mode_status(self) -> dict[str, Any]:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(1)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall(b"status\n")
                response = json.loads(client.recv(4096).decode())
        except (AttributeError, OSError, TimeoutError, UnicodeDecodeError,
                json.JSONDecodeError):
            return {}
        return response if isinstance(response, dict) else {}

    def live_tv_manifest(self) -> Path:
        return self.live_stream.manifest()

    def live_tv_segment(self, name: str) -> Path:
        return self.live_stream.segment(name)

    def live_tv_frame(self) -> bytes:
        return self.live_stream.preview()

    def stop_live_tv(self) -> dict[str, Any]:
        # Older portal pages still send this when their view closes. The
        # current live preview is shared, so one stale page must not be able
        # to tear down the picture another portal is watching.
        return {"ok": True}

    def live_tv_control(self, payload: dict[str, Any]) -> dict[str, Any]:
        command = str(payload.get("command", ""))
        allowed = {"channel-up", "channel-down", "previous-programme", "next-programme",
                   "toggle-pause", "toggle-subtitles", "toggle-widescreen-mode",
                   "volume-up", "volume-down", "toggle-mute",
                   "turn-on", "turn-off", "turn-on-mabel-only", "turn-off-mabel-only",
                   "toggle-power",
                   "open-parent-menu", "open-tv-guide", "open-channel-menu", "close-overlay", "restart-programme",
                   "enter-adult-mode", "continue-in-adult-mode",
                   "navigate-up", "navigate-down", "navigate-left",
                   "navigate-right", "select", "return-to-mabeltv", "toggle-remote-lock",
                   "tune-channel"}
        if command not in allowed:
            raise ValueError("Unknown live TV control")
        wire_command = command
        if command == "tune-channel":
            try:
                channel_number = int(payload.get("channel"))
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a channel") from error
            channel = self.channel(channel_number)
            if not channel.get("enabled", True):
                raise ValueError("That channel is hidden from the television")
            wire_command = json.dumps({"command": command, "channel": channel_number},
                                      separators=(",", ":"))
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((wire_command + "\n").encode())
                reply = client.recv(32).decode(errors="replace").strip()
        except OSError as error:
            raise ValueError("The TV player is not ready for portal controls") from error
        if reply != "ok":
            raise ValueError("The TV could not accept that control")
        return {"ok": True, "message": "Command sent"}

    def play_on_tv(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Start a known library item through the private player socket."""
        kind = str(payload.get("kind", ""))
        if kind == "channel":
            _kind, source, title, library_id, resume = self.remote_source(payload)
            if "position" in payload:
                try:
                    resume = max(0.0, float(payload.get("position", 0)))
                except (TypeError, ValueError) as error:
                    raise ValueError("That playback position is not valid") from error
            channel = self.channel(int(payload.get("channel", 0)))
            command = {"command": "play-programme", "channel": int(channel["number"]),
                       "file": source.name}
            if library_id or "position" in payload:
                command["position"] = resume
            skip_film_countdown = self.channel_content_type(channel) == "films"
        elif kind == "adult":
            _kind, source, title, _library_id, resume = self.remote_source(payload)
            if "position" in payload:
                try:
                    resume = max(0.0, float(payload.get("position", 0)))
                except (TypeError, ValueError) as error:
                    raise ValueError("That playback position is not valid") from error
            command = {"command": "play-adult-film",
                       "file": self.adult_relative_path(source),
                       "position": resume}
            skip_film_countdown = False
        elif kind == "adult-series":
            _kind, source, title, _library_id, _resume = self.remote_source(payload)
            command = {"command": "play-external", "path": str(source),
                       "title": title}
            skip_film_countdown = False
        else:
            raise ValueError("Choose a programme, Adult film, or episode to play")
        if not source.is_file():
            raise ValueError("That video is no longer in the Mabel TV library")
        state = self.read_json(self.player_state_path, {})
        woke_tv = False
        if isinstance(state, dict) and state.get("standby"):
            self.live_tv_control({"command": "turn-on"})
            woke_tv = True
        sent_to_player = False
        accepted_without_reply = False
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((json.dumps(command, separators=(",", ":")) + "\n").encode())
                sent_to_player = True
                reply = client.recv(32).decode(errors="replace").strip()
        except socket.timeout as error:
            # A busy renderer transition can delay the socket acknowledgement
            # even though the complete command is already queued in the local
            # player.  Do not turn that accepted request into the false failure
            # the portal previously showed while the film started on screen.
            if not sent_to_player:
                raise ValueError("The TV player is not ready to start that video") from error
            accepted_without_reply = True
            reply = "ok"
        except OSError as error:
            raise ValueError("The TV player is not ready to start that video") from error
        if reply != "ok":
            raise ValueError("The TV could not start that video")
        if skip_film_countdown:
            # Film channels normally show the child-friendly 10-second leader.
            # A parent has already confirmed this explicit portal replacement,
            # so use the existing Select action once tuning has opened the
            # leader. This makes Play on TV immediate without adding a second
            # playback path or weakening the player's validation.
            time.sleep(0.8)
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2)
                    client.connect("/run/mabeltv/portal-control.sock")
                    client.sendall(b"select\n")
                    skip_reply = client.recv(32).decode(errors="replace").strip()
            except OSError as error:
                raise ValueError("The film was selected, but Mabel TV could not start it immediately") from error
            if skip_reply != "ok":
                raise ValueError("The film was selected, but Mabel TV could not start it immediately")
        verb = "Starting" if accepted_without_reply else "Playing"
        return {"ok": True,
                "message": (f"Turned on Mabel TV and {verb.lower()} "
                            f"{title}"
                            if woke_tv else
                            f"{verb} {title} on Mabel TV")}

    def support_bundle(self) -> Path:
        self.admin_action("diagnostics")
        bundle = Path("/var/lib/mabeltv/support/mabeltv-support.tar.gz")
        if not bundle.is_file():
            raise ValueError("The support bundle could not be created")
        return bundle
