"""UploadConversion behaviour for the local library service."""

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


class UploadConversionMixin:
    def cleanup_stale_temporary_files(self) -> None:
        """Remove abandoned encoder outputs, never active or recent work."""
        result_cutoff = time.time() - 7 * 24 * 60 * 60
        upload_cutoff = result_cutoff
        # No encoder exists yet while Library is starting. Every temporary
        # encoder output in .incoming is therefore an orphan from a crash and
        # can be removed immediately before a resumed job reserves space again.
        # Restrict this to .incoming so a customer video with a similar name is
        # never mistaken for our private temporary file.
        for candidate in self.incoming.glob("*.optimising.mp4"):
            try:
                if candidate.is_file():
                    candidate.unlink()
                    print(f"Removed interrupted conversion file: {candidate}",
                          file=sys.stderr, flush=True)
            except OSError as error:
                print(f"Could not remove interrupted conversion file {candidate}: {error}",
                      file=sys.stderr, flush=True)
        for candidate in self.incoming.glob("*.ffmpeg.log"):
            try:
                candidate.unlink()
            except OSError:
                pass
        for batch in self.usb_import_root.glob("*.json"):
            try:
                if batch.stat().st_mtime < result_cutoff:
                    batch.unlink()
            except OSError:
                pass
        for candidate in self.incoming.glob("usb-*.part"):
            try:
                candidate.unlink()
            except OSError:
                pass
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                try:
                    if manifest.stat().st_mtime < result_cutoff:
                        manifest.unlink()
                except OSError:
                    pass
                continue
            metadata = self.read_json(manifest, {})
            try:
                status = str(metadata.get("status", "uploading"))
                part = self.incoming / f"{manifest.stem}.part"
                activity = max(
                    float(metadata.get("created", 0)),
                    float(metadata.get("updated", 0)),
                    manifest.stat().st_mtime,
                    part.stat().st_mtime if part.is_file() else 0,
                )
            except (OSError, TypeError, ValueError):
                activity = time.time()
                status = "uploading"
            # Once all source bytes have entered validation/preparation, never
            # discard the owner's only copy based on its original creation
            # date. It remains visible for explicit retry/cancel and recovery.
            if status != "uploading" or activity >= upload_cutoff:
                continue
            upload_id = manifest.stem
            (self.incoming / f"{upload_id}.part").unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
            print(f"Removed abandoned upload: {upload_id}", file=sys.stderr, flush=True)

    def resume_conversion_jobs(self) -> None:
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            metadata = self.read_json(manifest, {})
            upload_id = manifest.stem
            part = self.incoming / f"{upload_id}.part"
            result = self.read_json(self.incoming / f"{upload_id}.result.json", None)
            if isinstance(result, dict) and result.get("complete"):
                part.unlink(missing_ok=True)
                manifest.unlink(missing_ok=True)
                continue
            try:
                ready = part.is_file() and part.stat().st_size == int(metadata.get("size", -1))
            except (OSError, TypeError, ValueError):
                ready = False
            destination_ready = False
            try:
                destination = self.upload_destination(metadata)
                if metadata.get("conversion_required"):
                    destination = destination.with_suffix(".mp4")
                destination_ready = destination.is_file()
            except (TypeError, ValueError):
                pass
            resumable_statuses = {
                "uploading", "validating", "queued", "processing", "publishing",
                "finalising", "error"
            }
            if (ready or destination_ready) and metadata.get("status") in resumable_statuses:
                metadata["resume_from_status"] = metadata.get("status")
                metadata["status"] = "queued"
                metadata.pop("error", None)
                self.write_json(manifest, metadata)
                self.queue_conversion(upload_id)

    def cleanup_offline_prepared_cache(self) -> None:
        """Discard old phone-only conversions without touching customer media."""
        cutoff = time.time() - OFFLINE_PREPARED_CACHE_SECONDS
        for candidate in self.offline_cache.iterdir():
            try:
                if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                    candidate.unlink()
            except OSError as error:
                print(f"Could not remove offline cache file {candidate}: {error}",
                      file=sys.stderr, flush=True)

    def recover_final_results(self) -> None:
        """Promote a publication interrupted only during final bookkeeping."""
        for result_path in self.incoming.glob("*.result.json"):
            result = self.read_json(result_path, {})
            if not isinstance(result, dict) or result.get("complete") \
                or result.get("status") != "finalising":
                continue
            try:
                destination = self.upload_destination(result)
                if result.get("optimised"):
                    destination = destination.with_suffix(".mp4")
            except (TypeError, ValueError):
                continue
            if destination.is_file():
                result["complete"] = True
                result["refreshed"] = self.refresh_tv()
                result["status"] = "complete" if result["refreshed"] else "refresh-error"
                self.write_json(result_path, result)

    def queue_conversion(self, upload_id: str) -> None:
        with self.config_lock:
            if self.conversion_closed.is_set():
                raise RuntimeError("The media worker is stopping")
            if upload_id in self.queued_conversions:
                return
            self.queued_conversions.add(upload_id)
            self.conversion_queue.put(upload_id)

    def run_conversion_worker(self) -> None:
        while True:
            upload_id = self.conversion_queue.get()
            if upload_id is None:
                self.conversion_queue.task_done()
                return
            try:
                self.process_conversion(upload_id)
            except Exception as error:
                with self.config_lock:
                    was_cancelled = upload_id in self.cancelled_conversions
                if not was_cancelled:
                    try:
                        self.unexpected_conversion_error(upload_id, error)
                    except Exception as report_error:
                        # ENOSPC/read-only media can make both the job and its
                        # status write fail. Never let that kill the only worker.
                        print(f"Could not persist conversion failure {upload_id}: {report_error}",
                              file=sys.stderr, flush=True)
            finally:
                self.finish_conversion_job(upload_id)
                self.conversion_queue.task_done()

    def finish_conversion_job(self, upload_id: str) -> None:
        """Release the queue slot and honour a retry requested during teardown."""
        with self.config_lock:
            self.queued_conversions.discard(upload_id)
            retry = upload_id in self.deferred_retries
            self.deferred_retries.discard(upload_id)
            self.cancelled_conversions.discard(upload_id)
        if retry and not self.conversion_closed.is_set():
            self.queue_conversion(upload_id)

    def unexpected_conversion_error(self, upload_id: str, error: Exception) -> None:
        print(f"Conversion {upload_id} failed: {error}", file=sys.stderr, flush=True)
        manifest = self.incoming / f"{upload_id}.json"
        metadata = self.read_json(manifest, {})
        if isinstance(metadata, dict) and metadata:
            if metadata.get("status") == "validating":
                # A fully received but unreadable file cannot become valid by
                # retrying the same bytes. Free its reserved space but retain a
                # result record so the waiting browser sees the real error.
                (self.incoming / f"{upload_id}.part").unlink(missing_ok=True)
                result = {
                    "id": upload_id,
                    "file_name": str(metadata.get("file_name", "Video")),
                    "channel": metadata.get("channel"),
                    "kind": metadata.get("kind", "channel"),
                    "series_id": metadata.get("series_id"),
                    "season": metadata.get("season"),
                    "source_kind": metadata.get("source_kind", "browser"),
                    "source_label": metadata.get("source_label"),
                    "source_volume": metadata.get("source_volume"),
                    "batch_id": metadata.get("batch_id"),
                    "offset": int(metadata.get("size", 0)),
                    "complete": False,
                    "processing": False,
                    "status": "error",
                    "error": str(error) if isinstance(error, ValueError)
                    else "Mabel TV could not check this video",
                    "finished": time.time(),
                }
                self.write_json(self.incoming / f"{upload_id}.result.json", result)
                manifest.unlink(missing_ok=True)
                return
            metadata["status"] = "error"
            metadata["error"] = str(error) if isinstance(error, ValueError) \
                else "Mabel TV could not prepare this video"
            metadata["updated"] = time.time()
            self.write_json(manifest, metadata)

    def process_conversion(self, upload_id: str) -> None:
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
        with lock:
            metadata = self.upload_meta(upload_id)
            part = self.incoming / f"{upload_id}.part"
            adult_film_upload = metadata.get("kind") == "adult"
            adult_series_upload = metadata.get("kind") == "adult-series"
            source_name = str(metadata["file_name"])
            original_destination = self.upload_destination(metadata)
            previous_status = str(metadata.pop(
                "resume_from_status", metadata.get("status", "queued")))

            part_ready = part.is_file() and part.stat().st_size == int(metadata["size"])
            conversion_required = metadata.get("conversion_required")
            if conversion_required is None:
                if not part_ready:
                    raise ValueError("The uploaded file is incomplete")
                metadata["status"] = "validating"
                metadata["updated"] = time.time()
                metadata.pop("error", None)
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                self.video_info(part)
                # Channel uploads are published exactly as supplied. Automatic
                # optimisation made successful uploads look stuck and delayed
                # films and episodes appearing in their chosen channel.
                conversion_required = False
                metadata["conversion_required"] = False
                previous_status = "validated"

            destination = original_destination.with_suffix(".mp4") \
                if conversion_required else original_destination
            published_recovery = (destination.is_file()
                                  and previous_status in {
                                      "processing", "publishing", "finalising", "error"
                                  })
            if destination.exists() and not published_recovery:
                raise ValueError("A file with that name already exists in this library")

            if published_recovery:
                # The process may have died after the atomic media rename but
                # before recording completion. Validate and finish, rather
                # than rejecting a file this very job already published.
                self.video_info(destination)
            elif conversion_required:
                metadata["status"] = "processing"
                metadata["updated"] = time.time()
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                if adult_film_upload:
                    self.optimise_adult_for_playback(part, destination)
                else:
                    self.optimise_for_playback(part, destination)
            else:
                metadata["status"] = "publishing"
                metadata["updated"] = time.time()
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                os.replace(part, destination)

            metadata["status"] = "finalising"
            metadata["updated"] = time.time()
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            if adult_film_upload:
                with self.config_lock:
                    states = self.adult_media_states()
                    relative = self.adult_relative_path(destination)
                    current = states.get(relative, {})
                    if not isinstance(current, dict):
                        current = {}
                    current.setdefault("library_id", uuid.uuid4().hex)
                    current.setdefault("state", "original")
                    current.setdefault("message", "")
                    states[relative] = current
                    self.write_adult_media_states(states)
            elif adult_series_upload:
                with self.config_lock:
                    states = self.adult_series_states()
                    series_id = str(metadata.get("series_id", ""))
                    relative = destination.relative_to(
                        self.adult_series_root / series_id).as_posix()
                    key = f"{series_id}/{relative}"
                    current = states["episodes"].get(key, {})
                    if not isinstance(current, dict):
                        current = {}
                    current.setdefault("library_id", uuid.uuid4().hex)
                    states["episodes"][key] = current
                    self.write_adult_series_states(states)
            refreshed = True if adult_series_upload else self.refresh_tv()
            result = {
                "id": upload_id,
                "offset": int(metadata["size"]),
                "complete": False,
                "optimised": bool(conversion_required),
                "refreshed": refreshed,
                "status": "finalising",
                "file_name": source_name,
                "channel": metadata.get("channel"),
                "kind": "adult-series" if adult_series_upload
                else "adult" if adult_film_upload else "channel",
                "series_id": metadata.get("series_id"),
                "season": metadata.get("season"),
                "source_kind": metadata.get("source_kind", "browser"),
                "source_label": metadata.get("source_label"),
                "source_volume": metadata.get("source_volume"),
                "batch_id": metadata.get("batch_id"),
                "finished": time.time(),
            }
            result_path = self.incoming / f"{upload_id}.result.json"
            self.write_json(result_path, result)
            self.unlink_with_retry(part)
            result["complete"] = True
            result["status"] = "complete" if refreshed else "refresh-error"
            self.write_json(result_path, result)
            # Keep the manifest until the complete result is durably visible.
            # A status request can otherwise land between the manifest unlink
            # and result replacement and incorrectly report "Upload not found".
            self.unlink_with_retry(self.incoming / f"{upload_id}.json")
            with self.config_lock:
                self.upload_locks.pop(upload_id, None)

    def upload_jobs(self) -> list[dict[str, Any]]:
        """Return durable, non-complete work for the owner dashboard."""
        jobs: list[dict[str, Any]] = []
        channel_names = {int(value.get("number", -1)): str(value.get("name", "Channel"))
                         for value in self.channels()}
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            value = self.read_json(manifest, {})
            if not isinstance(value, dict) or not value.get("id"):
                continue
            part = self.incoming / f"{value['id']}.part"
            try:
                size = int(value.get("size", 0))
                status = str(value.get("status", "uploading"))
                # A create request is durable before its first chunk arrives.
                # No .part therefore means 0% while uploading, not 100%.
                # In publishing/finalising the source may already have been
                # atomically moved, so those later states legitimately count
                # the upload bytes as fully received.
                offset = part.stat().st_size if part.exists() \
                    else (0 if status == "uploading" else size)
                upload_kind = str(value.get("kind") or "channel")
                adult = upload_kind == "adult"
                adult_series = upload_kind == "adult-series"
                number = -1 if adult or adult_series else int(value.get("channel", -1))
            except (OSError, TypeError, ValueError):
                continue
            transfer_state = str(value.get("transfer_state", "active" if status == "uploading" else "complete"))
            source_seen = float(value.get("source_seen", 0) or 0)
            source_kind = str(value.get("source_kind") or "browser")
            source_available = self.usb_source_available(value) if source_kind == "usb" \
                else bool(source_seen and time.time() - source_seen <= UPLOAD_SOURCE_GRACE_SECONDS)
            jobs.append({
                "id": value["id"],
                "file_name": str(value.get("file_name", "Video")),
                "channel": number,
                "channel_name": "Adult TV series" if adult_series else
                (f"Adult TV · {value.get('folder')}" if value.get("folder")
                 else "Adult TV · All films") if adult else
                channel_names.get(number, f"CH {number}"),
                "kind": "adult-series" if adult_series else "adult" if adult else "channel",
                "size": size,
                "offset": offset,
                "status": status,
                "error": value.get("error"),
                "created": float(value.get("created", 0)),
                "queue_order": int(value.get("queue_order", 0) or 0),
                "transfer_state": transfer_state,
                "source_kind": source_kind,
                "source_label": value.get("source_label"),
                "source_volume": value.get("source_volume"),
                "batch_id": value.get("batch_id"),
                "source_available": source_available,
                "cancelable": status in {
                    "uploading", "queued", "paused", "error"
                },
                "retryable": (status == "error"
                              and part.is_file() and offset == size),
            })
        for result_path in self.incoming.glob("*.result.json"):
            value = self.read_json(result_path, {})
            if not isinstance(value, dict) or value.get("status") not in {
                    "error", "refresh-error"}:
                continue
            upload_kind = str(value.get("kind") or "channel")
            adult = upload_kind == "adult"
            adult_series = upload_kind == "adult-series"
            number = -1 if adult or adult_series else int(value.get("channel", -1))
            source_kind = str(value.get("source_kind") or "browser")
            jobs.append({
                "id": value.get("id", result_path.name.removesuffix(".result.json")),
                "file_name": str(value.get("file_name", "Video")),
                "channel": number,
                "channel_name": "Adult TV series" if adult_series else
                (f"Adult TV · {value.get('folder')}" if value.get("folder")
                 else "Adult TV · All films") if adult else
                channel_names.get(number, f"CH {number}"),
                "kind": "adult-series" if adult_series else "adult" if adult else "channel",
                "size": int(value.get("offset", 0)),
                "offset": int(value.get("offset", 0)),
                "status": str(value.get("status")),
                "error": value.get("error"),
                "source_kind": source_kind,
                "source_label": value.get("source_label"),
                "source_volume": value.get("source_volume"),
                "batch_id": value.get("batch_id"),
                "created": float(value.get("finished", 0)),
                "cancelable": value.get("status") == "error",
                "retryable": False,
                "refreshable": value.get("status") == "refresh-error",
            })
        return sorted(jobs, key=lambda value: (value.get("queue_order", 0), value["created"]))

    def next_upload_queue_order(self) -> int:
        orders = []
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            value = self.read_json(manifest, {})
            if isinstance(value, dict):
                try: orders.append(int(value.get("queue_order", 0)))
                except (TypeError, ValueError): pass
        return max(orders, default=0) + 1

    def initialise_upload_queue(self, metadata: dict[str, Any], source_id: str) -> None:
        """Give every browser-selected file a durable, Pi-owned place in line."""
        if not re.fullmatch(r"[a-f0-9]{32}", source_id):
            source_id = ""
        has_active = any(item.get("status") == "uploading" and
                         item.get("transfer_state") == "active"
                         for item in self.upload_jobs())
        metadata["queue_order"] = self.next_upload_queue_order()
        metadata["transfer_state"] = "waiting" if has_active else "active"
        if source_id:
            metadata["source_id"] = source_id
            metadata["source_seen"] = time.time()

    def reconnect_upload_source(self, manifest: Path, metadata: dict[str, Any],
                                source_id: str) -> None:
        """Reconnect a reselected local file to its durable upload reservation."""
        if re.fullmatch(r"[a-f0-9]{32}", source_id):
            metadata["source_id"] = source_id
            metadata["source_seen"] = time.time()
        if metadata.get("status") == "paused":
            active_exists = any(
                item.get("id") != metadata.get("id")
                and item.get("status") == "uploading"
                and item.get("transfer_state") == "active"
                for item in self.upload_jobs()
            )
            metadata["status"] = "uploading"
            metadata["transfer_state"] = "waiting" if active_exists else "active"
        metadata["updated"] = time.time()
        self.write_json(manifest, metadata)

    def promote_next_upload(self) -> None:
        """Hand the one transfer slot to the earliest waiting, incomplete job."""
        candidates: list[tuple[int, Path, dict[str, Any]]] = []
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            value = self.read_json(manifest, {})
            if not isinstance(value, dict) or value.get("status", "uploading") != "uploading":
                continue
            if value.get("transfer_state") != "waiting":
                continue
            try: order = int(value.get("queue_order", 0) or 0)
            except (TypeError, ValueError): order = 0
            candidates.append((order, manifest, value))
        if candidates:
            _, manifest, value = min(candidates, key=lambda item: item[0])
            value["transfer_state"] = "active"
            value["updated"] = time.time()
            self.write_json(manifest, value)

    def upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        # The HTTP server is threaded. Serialising lookup and creation prevents
        # two simultaneous requests from reserving duplicate jobs for one file.
        with self.config_lock:
            return self._upload_create(payload)

    def adult_upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Reserve a resumable upload prepared for reliable Pi playback."""
        with self.config_lock:
            file_name = str(payload.get("file_name", ""))
            requested_folder = str(payload.get("folder", "")).strip()
            folder = self.normalise_adult_folder(requested_folder) if requested_folder else ""
            size = int(payload.get("size", 0))
            relative = f"{folder}/{file_name}" if folder else file_name
            destination = self.safe_adult_path(relative, create_folder=bool(folder))
            if size <= 0 or size > MAX_UPLOAD_BYTES:
                raise ValueError("That file size is not supported")

            for manifest in self.incoming.glob("*.json"):
                if manifest.name.endswith(".result.json"):
                    continue
                value = self.read_json(manifest, {})
                if (value.get("kind") != "adult" or value.get("file_name") != file_name
                        or str(value.get("folder", "")) != folder):
                    continue
                if value.get("size") != size:
                    raise ValueError(
                        "A film with that name is already uploading. Resume it with the same file")
                part = self.incoming / f"{value['id']}.part"
                result = self.read_json(self.incoming / f"{value['id']}.result.json", None)
                if isinstance(result, dict) and result.get("complete"):
                    return result
                self.reconnect_upload_source(
                    manifest, value, str(payload.get("source_id", "")))
                offset = part.stat().st_size if part.is_file() else 0
                if offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(manifest, value)
                    self.queue_conversion(str(value["id"]))
                return {"id": value["id"], "offset": offset,
                        "transfer_state": value.get("transfer_state", "active"),
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        }, "status": value.get("status", "uploading")}

            if destination.exists() or destination.with_suffix(".mp4").exists():
                raise ValueError("A film with that name already exists in Adult mode")
            # Adult films arrive untouched. A later owner-approved conversion
            # reserves source-and-output space only if it is actually needed.
            reserve = size + 512 * 1024 * 1024
            if shutil.disk_usage(self.media_root).free < reserve:
                raise ValueError("There is not enough free space to upload that film")
            upload_id = uuid.uuid4().hex
            metadata = {
                "id": upload_id,
                "kind": "adult",
                "file_name": file_name,
                "folder": folder,
                "size": size,
                "created": time.time(),
            }
            self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            return {"id": upload_id, "offset": 0, "transfer_state": metadata["transfer_state"]}

    def adult_series_upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Reserve a resumable episode upload into one explicit series season."""
        with self.config_lock:
            series_id = str(payload.get("series", ""))
            series_root = self.adult_series_path(series_id)
            try:
                season = int(payload.get("season"))
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a series number") from error
            if season < 1 or season > 99:
                raise ValueError("Choose a series number from 1 to 99")
            file_name = str(payload.get("file_name", ""))
            if Path(file_name).name != file_name or Path(file_name).suffix.lower() \
                    not in SUPPORTED_EXTENSIONS:
                raise ValueError("Choose a supported episode video")
            size = int(payload.get("size", 0))
            if size <= 0 or size > MAX_UPLOAD_BYTES:
                raise ValueError("That file size is not supported")
            season_name = f"Season {season}"
            destination = self.adult_series_path(series_id, f"{season_name}/{file_name}")

            for manifest in self.incoming.glob("*.json"):
                if manifest.name.endswith(".result.json"):
                    continue
                value = self.read_json(manifest, {})
                if (value.get("kind") != "adult-series"
                        or value.get("series_id") != series_id
                        or int(value.get("season", 0) or 0) != season
                        or value.get("file_name") != file_name):
                    continue
                if value.get("size") != size:
                    raise ValueError(
                        "An episode with that name is already uploading. "
                        "Resume it with the same file")
                part = self.incoming / f"{value['id']}.part"
                result = self.read_json(
                    self.incoming / f"{value['id']}.result.json", None)
                if isinstance(result, dict) and result.get("complete"):
                    return result
                self.reconnect_upload_source(
                    manifest, value, str(payload.get("source_id", "")))
                offset = part.stat().st_size if part.is_file() else 0
                if offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(manifest, value)
                    self.queue_conversion(str(value["id"]))
                return {"id": value["id"], "offset": offset,
                        "transfer_state": value.get("transfer_state", "active"),
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        }, "status": value.get("status", "uploading")}

            if destination.exists():
                raise ValueError("That series already contains an episode with this file name")
            reserve = size + 512 * 1024 * 1024
            if shutil.disk_usage(self.media_root).free < reserve:
                raise ValueError("There is not enough free space to upload that episode")
            (series_root / season_name).mkdir(mode=0o750, exist_ok=True)
            upload_id = uuid.uuid4().hex
            metadata = {
                "id": upload_id,
                "kind": "adult-series",
                "series_id": series_id,
                "season": season,
                "file_name": file_name,
                "size": size,
                "created": time.time(),
            }
            self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            return {"id": upload_id, "offset": 0, "transfer_state": metadata["transfer_state"]}

    def _upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        number, file_name, size = int(payload.get("channel")), str(payload.get("file_name", "")), int(payload.get("size", 0))
        channel = self.channel(number)
        destination = self.safe_media_path(channel, file_name)
        if size <= 0 or size > MAX_UPLOAD_BYTES:
            raise ValueError("That file size is not supported")

        # Find resumable work before applying the fresh-upload reservation. The
        # existing .part has already consumed disk space, so reserving the full
        # source twice again would reject a perfectly safe interrupted upload.
        requested_targets = {destination, destination.with_suffix(".mp4")}
        for meta in self.incoming.glob("*.json"):
            if meta.name.endswith(".result.json"):
                continue
            value = self.read_json(meta, {})
            try:
                existing_channel = self.channel(int(value.get("channel")))
                existing_destination = self.safe_media_path(
                    existing_channel, str(value.get("file_name", "")))
                existing_targets = {
                    existing_destination, existing_destination.with_suffix(".mp4")
                }
            except (TypeError, ValueError):
                continue
            if not requested_targets.isdisjoint(existing_targets):
                if value.get("channel") != number or value.get("file_name") != file_name \
                    or value.get("size") != size:
                    raise ValueError(
                        "A video with that name is already uploading. "
                        "Resume it with the same original file or cancel it first")
                part = self.incoming / (value["id"] + ".part")
                saved_result = self.read_json(
                    self.incoming / f"{value['id']}.result.json", None)
                if isinstance(saved_result, dict) and saved_result.get("complete"):
                    return saved_result
                self.reconnect_upload_source(
                    meta, value, str(payload.get("source_id", "")))
                offset = part.stat().st_size if part.exists() else 0
                reserve = max(0, size - offset) + 512 * 1024 * 1024
                if shutil.disk_usage(self.media_root).free < reserve:
                    raise ValueError("There is not enough free space to safely resume that video")
                if value.get("status") == "error" and offset == size \
                    and value.get("conversion_required") is not None:
                    value["resume_from_status"] = "error"
                    value["status"] = "queued"
                    value.pop("error", None)
                    value["updated"] = time.time()
                    self.write_json(meta, value)
                    self.queue_conversion(str(value["id"]))
                elif offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(meta, value)
                    self.queue_conversion(str(value["id"]))
                else:
                    value["updated"] = time.time()
                    self.write_json(meta, value)
                return {"id": value["id"], "offset": offset,
                        "transfer_state": value.get("transfer_state", "active"),
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        },
                        "status": value.get("status", "uploading")}

        if destination.exists() or destination.with_suffix(".mp4").exists():
            raise ValueError("A file with that name already exists in this channel")
        reserve = size + 512 * 1024 * 1024
        if shutil.disk_usage(self.media_root).free < reserve:
            raise ValueError("There is not enough free space to upload that video")
        self.clear_superseded_upload_errors(number, file_name)
        upload_id = uuid.uuid4().hex
        metadata = {"id": upload_id, "channel": number, "file_name": file_name,
                    "size": size, "created": time.time()}
        self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
        self.write_json(self.incoming / (upload_id + ".json"), metadata)
        return {"id": upload_id, "offset": 0, "transfer_state": metadata["transfer_state"]}

    def upload_action(self, upload_id: str, action: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        if action not in {"cancel", "retry", "refresh", "pause", "resume", "start", "heartbeat"}:
            raise ValueError("Unknown upload action")
        if action == "refresh":
            result_path = self.incoming / f"{upload_id}.result.json"
            result = self.read_json(result_path, None)
            if not isinstance(result, dict) or result.get("status") != "refresh-error":
                raise ValueError("This video is not waiting for a TV refresh")
            if not self.refresh_tv():
                raise ValueError(
                    "The video is safe, but the TV still could not refresh. Restart the TV player or try again")
            with self.config_lock:
                result = self.read_json(result_path, result)
                result["refreshed"] = True
                result["status"] = "complete"
                result["complete"] = True
                self.write_json(result_path, result)
            return {"ok": True, "message": "The TV library was refreshed."}
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
            if not lock.acquire(blocking=False):
                raise ValueError(
                    "This video is already being prepared. Let it finish, then remove it from its channel if needed")
            try:
                manifest = self.incoming / f"{upload_id}.json"
                result_path = self.incoming / f"{upload_id}.result.json"
                metadata = self.read_json(manifest, None)
                result = self.read_json(result_path, None)
                if action == "heartbeat":
                    if not isinstance(metadata, dict):
                        raise ValueError("Upload not found")
                    metadata["source_seen"] = time.time()
                    self.write_json(manifest, metadata)
                    return {"ok": True, "transfer_state": metadata.get("transfer_state", "active")}
                if action == "start":
                    if not isinstance(metadata, dict) or metadata.get("status", "uploading") not in {"uploading", "paused"}:
                        raise ValueError("This upload cannot be started now")
                    for other_path in self.incoming.glob("*.json"):
                        if other_path == manifest or other_path.name.endswith(".result.json"):
                            continue
                        other = self.read_json(other_path, {})
                        if isinstance(other, dict) and other.get("status", "uploading") == "uploading" and other.get("transfer_state") == "active":
                            other["status"] = "paused"
                            other["transfer_state"] = "paused"
                            other["updated"] = time.time()
                            self.write_json(other_path, other)
                    metadata["status"] = "uploading"
                    metadata["transfer_state"] = "active"
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    self.usb_transfer_wakeup.set()
                    return {"ok": True, "message": "This USB transfer will start now."
                            if metadata.get("source_kind") == "usb" else
                            "This upload will start next on its source laptop."}
                if action == "retry":
                    if not isinstance(metadata, dict) or metadata.get("status") != "error":
                        raise ValueError("This upload is not waiting to be retried")
                    part = self.incoming / f"{upload_id}.part"
                    try:
                        ready = part.is_file() and part.stat().st_size == int(metadata["size"])
                    except (OSError, KeyError, TypeError, ValueError):
                        ready = False
                    if not ready:
                        raise ValueError("Choose the original file above to retry this upload")
                    metadata["resume_from_status"] = "error"
                    metadata["status"] = "queued"
                    metadata.pop("error", None)
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    # An error becomes visible just before the worker removes
                    # this ID from its dedupe set. Remember an owner retry in
                    # that narrow window so the worker requeues it on teardown.
                    if upload_id in self.queued_conversions:
                        self.deferred_retries.add(upload_id)
                    else:
                        self.queue_conversion(upload_id)
                    return {"ok": True, "message": "The video is back in the preparation queue."}

                if action == "pause":
                    if not isinstance(metadata, dict) or metadata.get("status", "uploading") not in {"uploading", "queued"}:
                        raise ValueError("This upload cannot be paused now")
                    metadata["status"] = "paused"
                    metadata["transfer_state"] = "paused"
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    self.promote_next_upload()
                    self.usb_transfer_wakeup.set()
                    return {"ok": True, "message": "Transfer paused. It will keep its received files."}

                if action == "resume":
                    if not isinstance(metadata, dict) or metadata.get("status") != "paused":
                        raise ValueError("This upload is not paused")
                    part = self.incoming / f"{upload_id}.part"
                    complete = part.is_file() and part.stat().st_size == int(metadata.get("size", 0))
                    metadata["status"] = "queued" if complete else "uploading"
                    if not complete:
                        active_exists = any(item.get("status") == "uploading" and
                                            item.get("transfer_state") == "active"
                                            for item in self.upload_jobs())
                        metadata["transfer_state"] = "waiting" if active_exists else "active"
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    if complete:
                        self.queue_conversion(upload_id)
                    self.usb_transfer_wakeup.set()
                    return {"ok": True, "message": "Transfer resumed."}

                status = str(metadata.get("status", "uploading")) \
                    if isinstance(metadata, dict) else str(
                        result.get("status", "") if isinstance(result, dict) else "")
                if status not in {"uploading", "queued", "paused", "error"}:
                    raise ValueError("This upload is already being prepared and can no longer be cancelled")
                self.unlink_with_retry(self.incoming / f"{upload_id}.part")
                self.unlink_with_retry(manifest)
                self.unlink_with_retry(result_path)
                self.deferred_retries.discard(upload_id)
                if upload_id in self.queued_conversions:
                    self.cancelled_conversions.add(upload_id)
                self.upload_locks.pop(upload_id, None)
                if metadata and metadata.get("transfer_state") == "active":
                    self.promote_next_upload()
                self.usb_transfer_wakeup.set()
                return {"ok": True, "message": "The transfer was removed and its space was freed."}
            finally:
                lock.release()

    def upload_meta(self, upload_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        meta = self.read_json(self.incoming / (upload_id + ".json"), None)
        if not isinstance(meta, dict):
            raise ValueError("Upload not found")
        return meta

    def upload_status(self, upload_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        result_path = self.incoming / f"{upload_id}.result.json"
        manifest = self.incoming / f"{upload_id}.json"
        metadata = None
        # Atomic replacement can briefly make a file unreadable on Windows,
        # and the worker may remove the manifest during that same request.
        # Re-check both durable records together to close that reader TOCTOU.
        for attempt in range(10):
            result = self.read_json(result_path, None)
            if isinstance(result, dict):
                return result
            metadata = self.read_json(manifest, None)
            if isinstance(metadata, dict):
                break
            if attempt < 9:
                time.sleep(0.01 * (attempt + 1))
        if not isinstance(metadata, dict):
            raise ValueError("Upload not found")
        part = self.incoming / f"{upload_id}.part"
        status = str(metadata.get("status", "uploading"))
        processing_statuses = {
            "validating", "queued", "processing", "publishing", "finalising"
        }
        try:
            offset = part.stat().st_size if part.is_file() \
                else (int(metadata.get("size", 0)) if status in processing_statuses else 0)
        except (OSError, TypeError, ValueError):
            offset = 0
        return {
            "id": upload_id,
            "file_name": str(metadata.get("file_name", "Video")),
            "channel": metadata.get("channel"),
            "kind": metadata.get("kind", "channel"),
            "series_id": metadata.get("series_id"),
            "season": metadata.get("season"),
            "offset": offset,
            "complete": False,
            "processing": status in processing_statuses,
            "status": status,
            "transfer_state": str(metadata.get("transfer_state", "active")),
            "source_kind": metadata.get("source_kind", "browser"),
            "source_label": metadata.get("source_label"),
            "source_volume": metadata.get("source_volume"),
            "batch_id": metadata.get("batch_id"),
            "error": metadata.get("error"),
        }

    def append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
        with lock:
            return self._append_upload(upload_id, offset, content)

    def _append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        meta = self.upload_meta(upload_id)
        if meta.get("status") == "paused":
            raise ValueError("This upload is paused")
        if meta.get("transfer_state", "active") != "active":
            raise ValueError("This upload is waiting in the queue")
        part = self.incoming / (upload_id + ".part")
        current = part.stat().st_size if part.exists() else 0
        if offset != current:
            return {"offset": current, "resumable": True}
        if len(content) == 0 or len(content) > CHUNK_LIMIT or current + len(content) > int(meta["size"]):
            raise ValueError("Invalid upload chunk")
        with part.open("ab") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        current += len(content)
        result = {"offset": current, "complete": current == int(meta["size"])}
        meta["updated"] = time.time()
        meta["source_seen"] = time.time()
        if result["complete"]:
            # Persist receipt before any potentially slow probe. The one media
            # worker validates, converts if necessary, publishes, then refreshes
            # the TV. A lost final PATCH response can therefore be polled safely.
            meta["status"] = "validating"
            meta["transfer_state"] = "complete"
            meta["updated"] = time.time()
            self.write_json(self.incoming / (upload_id + ".json"), meta)
            self.queue_conversion(upload_id)
            self.promote_next_upload()
            result["complete"] = False
            result["processing"] = True
            result["status"] = "validating"
            result["id"] = upload_id
        else:
            # One small atomic manifest update per 8 MiB chunk makes recent
            # activity survive a watchdog/service restart and resets the
            # seven-day abandonment clock.
            self.write_json(self.incoming / (upload_id + ".json"), meta)
        return result
