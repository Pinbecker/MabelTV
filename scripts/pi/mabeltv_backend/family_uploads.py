"""Resumable family uploads and single-worker preparation for phone media."""
from __future__ import annotations

import datetime
import json
import os
import shutil
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path

from .constants import MAX_UPLOAD_BYTES, MAX_CONVERSION_TEMP_C, RESUME_CONVERSION_TEMP_C
from .story_audio import AUDIO_EXTENSIONS, prepare_story_audio

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".mkv", ".webm"}


class FamilyUploadsMixin:
    def family_upload_source_ready(self, metadata):
        try:
            source = self.family_path(self.state_database.family_asset(metadata["asset_id"])["source_path"])
            return source.is_file() and source.stat().st_size == int(metadata["size"])
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def family_cancel_upload(self, metadata):
        identity = str(metadata.get("asset_id", ""))
        self.state_database.family_asset_update(identity, status="error", error="Upload cancelled")
        self.family_action({"action": "remove", "id": identity}, cancelled_upload=True)

    def family_remove_preparation(self, item):
        """Stop a family worker before detaching its asset; keep original files."""
        upload_id = item["upload_id"]
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
            if upload_id in self.queued_conversions or lock.locked():
                self.cancelled_conversions.add(upload_id)
            self.deferred_retries.discard(upload_id)
        if not lock.acquire(timeout=8):
            raise ValueError("Preparation is stopping. Try removing this memory again in a moment.")
        try:
            with self.config_lock:
                self.family_cancel_upload({"asset_id": item["id"]})
                for suffix in (".part", ".json", ".result.json"):
                    self.unlink_with_retry(self.incoming / f"{upload_id}{suffix}")
                self.usb_transfer_wakeup.set()
        finally:
            lock.release()

    def family_upload_create(self, payload):
        with self.config_lock:
            name = str(payload.get("file_name", ""))
            extension = Path(name).suffix.lower()
            kind = str(payload.get("media_kind", ""))
            allowed = IMAGE_EXTENSIONS if kind in ("photo", "illustration") else AUDIO_EXTENSIONS \
                if kind in ("audio", "music") else VIDEO_EXTENSIONS if kind == "video" else set()
            if kind == "audio" and name.lower().endswith(".story.zip"):
                allowed = allowed | {".zip"}
            if not name or Path(name).name != name or extension not in allowed or len(name) > 240:
                raise ValueError("Choose a supported audio, photo or video file")
            size = int(payload.get("size", 0))
            if not 0 < size <= MAX_UPLOAD_BYTES:
                raise ValueError("That file size is not supported")
            title = str(payload.get("title") or Path(name).stem).strip()
            if not 1 <= len(title) <= 160:
                raise ValueError("Give this item a title, up to 160 characters")
            channel = int(payload["channel"]) if kind in ("photo", "video") else None
            story_id = str(payload.get("story_id", "")) if kind in ("audio", "illustration") else ""
            if kind in ("audio", "illustration") and not story_id:
                raise ValueError("Choose the story this file belongs to")
            for path in self.incoming.glob("*.json"):
                value = self.read_json(path, {})
                if (value.get("kind") == "family" and value.get("file_name") == name
                        and value.get("size") == size and value.get("channel") == channel
                        and value.get("story_id", "") == story_id and value.get("media_kind") == kind):
                    self.reconnect_upload_source(path, value, str(payload.get("source_id", "")))
                    return self.upload_status(value["id"])
            if shutil.disk_usage(self.media_root).free < size * 2 + 128 * 1024 * 1024:
                raise ValueError("There is not enough space to safely prepare this file")
            upload_id = uuid.uuid4().hex
            relative = f".family-media/originals/{upload_id}{extension}"
            asset_id = self.state_database.family_asset_create({"kind": kind, "title": title,
                "original_name": name, "source_path": relative, "channel": channel,
                "story_id": story_id, "upload_id": upload_id})
            metadata = {"id": upload_id, "kind": "family", "media_kind": kind, "asset_id": asset_id,
                "file_name": name, "size": size, "channel": channel, "story_id": story_id,
                "created": time.time(), "source_path": relative}
            self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            return {"id": upload_id, "offset": 0, "asset_id": asset_id, "transfer_state": metadata["transfer_state"]}

    def family_import_channel(self, number):
        channel = self.channel(number)
        if channel["content_type"] != "memories":
            raise ValueError("Choose a Photos & Videos channel")
        known = {value["source_path"] for value in self.state_database.family_catalogue()["assets"]}
        for path in sorted((self.media_root / channel["folder"]).iterdir()):
            if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
                continue
            relative = path.relative_to(self.media_root).as_posix()
            if relative in known:
                continue
            upload_id = uuid.uuid4().hex
            kind = "photo" if path.suffix.lower() in IMAGE_EXTENSIONS else "video"
            asset_id = self.state_database.family_asset_create({"kind": kind, "title": self.display_name(path.name),
                "original_name": path.name, "source_path": relative, "channel": number, "upload_id": upload_id})
            self.write_json(self.incoming / f"{upload_id}.json", {"id": upload_id, "kind": "family",
                "media_kind": kind, "asset_id": asset_id, "file_name": path.name, "size": path.stat().st_size,
                "channel": number, "created": time.time(), "source_path": relative,
                "status": "queued", "transfer_state": "complete", "source_kind": "channel-import"})
            self.queue_conversion(upload_id)

    def process_family_conversion(self, upload_id, metadata):
        if upload_id in self.cancelled_conversions:
            raise ValueError("Memory preparation cancelled")
        asset_id = metadata["asset_id"]
        asset = self.state_database.family_asset(asset_id)
        source = self.family_path(asset["source_path"])
        part = self.incoming / f"{upload_id}.part"
        if not source.is_file():
            if not part.is_file() or part.stat().st_size != int(metadata["size"]):
                raise ValueError("The uploaded file is incomplete")
            os.replace(part, source)
        metadata.update(status="processing", updated=time.time())
        self.write_json(self.incoming / f"{upload_id}.json", metadata)
        self.state_database.family_asset_update(asset_id, status="processing", error="")
        kind = asset["kind"]
        prepared = self.family_root / "prepared" / (asset_id + (".jpg" if kind in ("photo", "illustration")
                                                   else ".m4a" if kind in ("audio", "music") else ".mp4"))
        illustration_source = source
        intermediate = self.incoming / f"{upload_id}.heif.jpg"
        try:
            if source.suffix.lower() in {".heic", ".heif"}:
                if not shutil.which("heif-convert"):
                    raise ValueError("HEIC support is unavailable. Upload a JPEG or install libheif-examples.")
                self.family_run(["heif-convert", str(source), str(intermediate)], upload_id)
                illustration_source = intermediate
            if kind == "audio" and source.suffix.lower() == ".zip":
                prepare_story_audio(self, source, prepared, upload_id)
                illustration_source = prepared
            info = self.family_probe(illustration_source)
            stream = next((item for item in info.get("streams", []) if item.get("codec_type") ==
                           ("audio" if kind in ("audio", "music") else "video")), None)
            if not stream:
                raise ValueError("No supported picture or audio was found in this file")
            if kind in ("photo", "illustration"):
                self.family_ffmpeg(illustration_source, prepared, ["-frames:v", "1", "-vf",
                    "scale=1920:1080:force_original_aspect_ratio=decrease", "-q:v", "2", "-update", "1"], upload_id)
            elif kind in ("audio", "music"):
                if source.suffix.lower() != ".zip":
                    self.family_ffmpeg(source, prepared, ["-map", "0:a:0", "-vn", "-c:a", "aac",
                        "-b:a", "128k", "-ac", "2", "-movflags", "+faststart"], upload_id)
            else:
                tone_map = ""
                if stream.get("color_transfer") in {"smpte2084", "arib-std-b67"}:
                    tone_map = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
                                "tonemap=tonemap=hable,zscale=t=bt709:m=bt709:r=tv,")
                # Recent iPhone MOVs may contain an extra spatial-audio track
                # with no decodable codec. Preserve the ordinary soundtrack,
                # rather than asking FFmpeg to decode every audio stream.
                audio = next((item for item in info.get("streams", [])
                              if item.get("codec_type") == "audio"
                              and item.get("codec_name") not in (None, "none", "unknown")), None)
                audio_mapping = ["-map", f"0:{audio['index']}"] if audio else ["-an"]
                self.family_ffmpeg(source, prepared, ["-map", "0:v:0", *audio_mapping, "-vf",
                    tone_map + "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "main",
                    "-level", "3.1", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart"], upload_id)
            prepared_info = self.family_probe(prepared)
            video = next((item for item in prepared_info.get("streams", []) if item.get("codec_type") == "video"), {})
            duration = float(prepared_info.get("format", {}).get("duration", 0) or 0)
            artwork = self.family_root / "artwork" / f"{asset_id}.jpg"
            if kind in ("photo", "illustration", "video"):
                self.family_ffmpeg(prepared, artwork, ["-frames:v", "1", "-vf",
                    "scale=640:640:force_original_aspect_ratio=decrease", "-q:v", "3", "-update", "1"], upload_id)
            if upload_id in self.cancelled_conversions:
                raise ValueError("Memory preparation cancelled")
            captured = self.family_capture_time(info) or source.stat().st_mtime
            self.state_database.family_asset_update(asset_id, status="ready", error="",
                prepared_path=prepared.relative_to(self.media_root).as_posix(),
                artwork_path=artwork.relative_to(self.media_root).as_posix() if artwork.is_file() else "",
                width=int(video.get("width", 0)), height=int(video.get("height", 0)), duration=duration, captured=captured)
            self.write_json(self.incoming / f"{upload_id}.result.json", {"id": upload_id, "asset_id": asset_id,
                "kind": "family", "offset": int(metadata["size"]), "complete": True, "status": "complete",
                "refreshed": True, "optimised": True, "file_name": metadata["file_name"], "finished": time.time()})
            part.unlink(missing_ok=True)
            (self.incoming / f"{upload_id}.json").unlink(missing_ok=True)
        except Exception as error:
            self.state_database.family_asset_update(asset_id, status="error", error=str(error)[:250])
            if upload_id in self.cancelled_conversions:
                prepared.unlink(missing_ok=True)
                (self.family_root / "artwork" / f"{asset_id}.jpg").unlink(missing_ok=True)
            raise
        finally:
            intermediate.unlink(missing_ok=True)

    @staticmethod
    def family_capture_time(info):
        tags = [info.get("format", {}).get("tags", {})] + [item.get("tags", {}) for item in info.get("streams", [])]
        for tag in tags:
            try:
                value = str(tag.get("creation_time") or tag.get("com.apple.quicktime.creationdate") or "")
                if value:
                    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
        return 0

    @staticmethod
    def family_probe(path):
        result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise ValueError("This media file could not be read")
        return json.loads(result.stdout)

    def family_ffmpeg(self, source, destination, options, upload_id=""):
        temporary = destination.with_name(destination.stem + ".preparing" + destination.suffix)
        try:
            self.family_run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", str(source),
                *options, "-threads", "1", str(temporary)], upload_id)
            self.family_probe(temporary)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def family_run(self, command, upload_id=""):
        log = self.incoming / (uuid.uuid4().hex + ".family.log")
        paused = False
        process = None
        try:
            with log.open("wb") as errors:
                process = subprocess.Popen((["nice", "-n", "15"] if os.name == "posix" else []) + command,
                    stdout=subprocess.DEVNULL, stderr=errors, start_new_session=os.name == "posix")
                deadline = time.monotonic() + 45 * 60
                while process.poll() is None:
                    if upload_id in self.cancelled_conversions:
                        raise ValueError("Memory preparation cancelled")
                    if self.conversion_closed.is_set() or time.monotonic() > deadline:
                        raise ValueError("Media preparation was stopped; you can retry it")
                    temperature = self.cpu_temperature_c()
                    if os.name == "posix" and not paused and temperature >= MAX_CONVERSION_TEMP_C:
                        os.killpg(process.pid, signal.SIGSTOP)
                        paused = True
                    elif os.name == "posix" and paused and temperature <= RESUME_CONVERSION_TEMP_C:
                        os.killpg(process.pid, signal.SIGCONT)
                        paused = False
                    time.sleep(0.5)
            if process.returncode:
                raise ValueError("Media preparation failed: " + log.read_text(errors="replace")[-180:])
        finally:
            if process and process.poll() is None:
                if paused:
                    os.killpg(process.pid, signal.SIGCONT)
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            log.unlink(missing_ok=True)
