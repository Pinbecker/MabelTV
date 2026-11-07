"""Version-checked Pi sources and resumable returns; video encoding stays on Windows."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import uuid
from .compression import POLICY


class StudioPiMixin:
    def studio_pi_sync_progress(self):
        """Mirror the Windows job without creating a second processing owner."""
        with self.config_lock:
            states = self.my_tv_media_states()
            changed = False
            for job in self.state_database.studio_records("job"):
                if job.get("source", {}).get("type") != "pi" or job["status"] == "complete":
                    continue
                if job["destination"].get("replacePi"):
                    reference = job["source"]["reference"]
                    relative = reference.get("file")
                    state = states.get(relative, {})
                    if state.get("compressionOperation") != job["id"]:
                        continue
                    status = job["status"]
                    if status == "cancelled":
                        baseline = state.pop("compressionBaseline", {})
                        restored = baseline.get("state", "original")
                        published = job.get("replacementReceipt") or job.get("result", {}).get("complete")
                        compression = state.get("compression") if published else baseline.get("compression")
                        if published:
                            restored = "optimised"
                        if restored not in {"original", "optimised"}:
                            restored = "original"
                        state.update(state=restored, message="", progress=100 if restored == "optimised" else 0)
                        state.pop("compressionOperation", None)
                        state.pop("compression", None)
                        if restored == "optimised" and compression:
                            state["compression"] = compression
                        states[relative] = state
                        changed = True
                        continue
                    patch = {"state": {"queued": "queued", "active": "processing", "paused": "paused"}.get(status, "error"),
                             "message": job.get("message") or ("Waiting for laptop" if status == "queued" else job.get("stage", "")),
                             "progress": job.get("percent") or 0}
                    if any(state.get(key) != value for key, value in patch.items()):
                        state.update(patch)
                        states[relative] = state
                        changed = True
                original = job["source"]["reference"].get("upload")
                if original:
                    manifest = self.incoming / (original + ".json")
                    metadata = self.read_json(manifest, {})
                    if metadata.get("studioPreparationJob") == job["id"]:
                        patch = {"processing_percent": job.get("percent") or 0, "error": job.get("message", "") if job["status"] == "failed" else None}
                        if any(metadata.get(key) != value for key, value in patch.items()):
                            metadata.update(patch)
                            self.write_json(manifest, metadata)
            if changed:
                self.write_my_tv_media_states(states)

    def studio_pi_source_path(self, source):
        reference = source["reference"]
        if "upload" in reference:
            identity = reference["upload"]
            if not re.fullmatch(r"[a-f0-9]{32}", identity):
                raise ValueError("Invalid upload source")
            path = self.incoming / (identity + ".part")
        else:
            _, path, _, _, _ = self.remote_source(reference)
        if not path.is_file():
            raise ValueError("The Pi source is no longer available")
        stat = path.stat()
        if [stat.st_size, stat.st_mtime_ns, stat.st_ino] != source["fingerprint"]:
            raise ValueError("The Pi source changed. Refresh and queue its current version")
        return path

    def studio_pi_queue(self, reference, destination, compression=None, replace=False):
        if "upload" in reference:
            path = self.incoming / (reference["upload"] + ".part")
        else:
            _, path, _, _, _ = self.remote_source(reference)
        stat = path.stat()
        source = {"type": "pi", "reference": reference, "bytes": stat.st_size,
                  "name": path.name, "fingerprint": [stat.st_size, stat.st_mtime_ns, stat.st_ino]}
        if "upload" in reference:
            source["name"] = self.upload_meta(reference["upload"])["file_name"]
        else:
            _, _, _, library_id, _ = self.remote_source(reference)
            ancestor = next((value for value in self.state_database.studio_records("delivery") if library_id and
                             (value.get("provenance", {}).get("pi") or {}).get("library_id") == library_id), None)
            if ancestor:
                source["acquisitionId"] = ancestor["acquisitionId"]
        destination = self.studio_destination({**destination, "compression": compression or "compact", "cloudCopies": "optimised"})
        destination.update(saveCloud=False, piReturn=True, replacePi=replace, temporaryWork=True)
        now = time.time()
        identity = hashlib.sha256(json.dumps([source, destination], sort_keys=True).encode()).hexdigest()
        job = {"id": uuid.uuid4().hex, "title": Path(source["name"]).stem, "source": source, "destination": destination,
               "fingerprint": identity, "status": "queued", "stage": "queued", "percent": 0, "created": now, "updated": now, "policyVersion": 2}
        return self.state_database.studio_add_jobs([job])[0]

    def studio_pi_job(self, identity, claim=None):
        job = next((value for value in self.state_database.studio_records("job") if value["id"] == identity), None)
        if not job or job["source"].get("type") != "pi":
            raise ValueError("Pi preparation job not found")
        if claim is not None and (not claim or job.get("claim") != claim or job["status"] != "active"):
            raise ValueError("This Studio claim is no longer active")
        return job

    def studio_pi_download(self, identity):
        job = self.studio_pi_job(identity)
        return self.studio_pi_source_path(job["source"])

    def studio_pi_unchanged(self, payload):
        job = self.studio_pi_job(str(payload.get("job", "")), str(payload.get("claim", "")))
        if not job["destination"].get("replacePi"):
            raise ValueError("This source still requires a prepared return")
        source = self.studio_pi_source_path(job["source"])
        relative = self.my_tv_relative_path(source)
        self.set_my_tv_media_state(relative, "optimised", "Existing copy kept", progress=100, compressionCompleted=time.time())
        return {"complete": True, "unchanged": True, "file_name": source.name, "kind": "my_tv", "folder": relative.rsplit("/", 1)[0] if "/" in relative else "", "bytes": source.stat().st_size}

    def studio_pi_return(self, payload):
        with self.config_lock:
            job = self.studio_pi_job(str(payload.get("job", "")), str(payload.get("claim", "")))
            if job.get("returnUpload"):
                return self.upload_status(job["returnUpload"])
            path = self.studio_pi_source_path(job["source"])
            size = payload.get("size")
            if type(size) is not int or size <= 0 or size > 64 * 1024 ** 3:
                raise ValueError("Invalid prepared size")
            if shutil.disk_usage(self.media_root).free < size + 512 * 1024 ** 2:
                raise ValueError("There is not enough Pi space for a safe replacement")
            reference = job["source"]["reference"]
            original_upload = reference.get("upload")
            if original_upload:
                metadata = deepcopy(self.upload_meta(original_upload))
                metadata["file_name"] = str(Path(metadata["file_name"]).with_suffix(".mp4"))
                metadata.update(studioOriginalUpload=original_upload)
                metadata.pop("source_kind", None)
            else:
                relative = self.my_tv_relative_path(path)
                metadata = {"kind": "my_tv", "file_name": path.with_suffix(".mp4").name,
                            "folder": relative.rsplit("/", 1)[0] if "/" in relative else "",
                            "studioReplace": job["id"]}
            identity = uuid.uuid4().hex
            for key in ("compression", "conversion_required", "resume_from_status", "error"):
                metadata.pop(key, None)
            metadata.update(id=identity, size=size, status="uploading", created=time.time(), updated=time.time(),
                            source_kind="studio", studioReturnJob=job["id"])
            self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
            self.write_json(self.incoming / (identity + ".json"), metadata)
            job["returnUpload"] = identity
            self.state_database.studio_add("job", job)
            return {"id": identity, "offset": 0, "status": "uploading", "transfer_state": metadata["transfer_state"]}

    def studio_pi_publish_replacement(self, upload_id, metadata):
        with self.config_lock:
            return self._studio_pi_publish_replacement(upload_id, metadata)

    def _studio_pi_publish_replacement(self, upload_id, metadata):
        job = self.studio_pi_job(metadata["studioReplace"])
        part = self.incoming / (upload_id + ".part")
        destination = self.upload_destination(metadata)
        rollback = self.incoming / (upload_id + ".previous")
        receipt = job.get("replacementReceipt")
        candidate = job.get("replacementCandidate")
        if receipt:
            if not destination.is_file() or destination.stat().st_size != receipt["bytes"]:
                raise ValueError("The published replacement changed")
            self.write_json(self.incoming / (upload_id + ".result.json"), receipt)
            rollback.unlink(missing_ok=True)
            return receipt
        if not part.is_file():
            if not candidate or not destination.is_file() or not rollback.is_file():
                raise ValueError("The prepared return is missing; existing files were kept")
            stat = destination.stat()
            if [stat.st_size, stat.st_mtime_ns, stat.st_ino] != candidate["fingerprint"]:
                raise ValueError("The interrupted replacement changed; existing files were kept")
            source = self.safe_my_tv_path(candidate["original"])
            relative = candidate["original"]
            result = candidate["receipt"]
        else:
            source = self.studio_pi_source_path(job["source"])
            stream = self.video_info(part)
            if (stream.get("codec_name") != "h264" or stream.get("pix_fmt") != "yuv420p"
                    or int(stream.get("width", 0)) > 1920 or int(stream.get("height", 0)) > 1080
                    or not 0 < self.frame_rate(stream) <= POLICY["maximumFrameRate"] + .001
                    or int(stream.get("level", 0)) > POLICY["maximumH264Level"]
                    or stream.get("field_order") not in {None, "unknown", "progressive"}
                    or any(audio.get("codec_name") != "aac" or int(audio.get("channels", 0)) > 2 for audio in stream.get("audio_streams", []))):
                raise ValueError("The laptop return is not Pi compatible")
            if part.stat().st_size >= source.stat().st_size:
                raise ValueError("The replacement would not save space. The original was kept")
            if destination != source and destination.exists():
                raise ValueError("A different MP4 already uses this film name")
            relative = self.my_tv_relative_path(source)
            result = {"id": upload_id, "complete": True, "status": "complete", "kind": "my_tv", "file_name": destination.name,
                      "folder": metadata.get("folder", ""), "file": self.my_tv_relative_path(destination), "bytes": part.stat().st_size,
                      "offset": metadata["size"], "refreshed": True, "finished": time.time(), "optimised": True, "suppressReadyNotice": True}
            stat = part.stat()
            job["replacementCandidate"] = {"original": relative, "fingerprint": [stat.st_size, stat.st_mtime_ns, stat.st_ino], "receipt": result}
            self.state_database.studio_add("job", job)
            if not rollback.exists():
                os.link(source, rollback)
            os.replace(part, destination)
        states = self.my_tv_media_states()
        state = states.pop(relative, {})
        state.update(state="optimised", message="", progress=100, compressionCompleted=time.time())
        states[result["file"]] = state
        self.write_my_tv_media_states(states)
        job["replacementReceipt"] = result
        self.state_database.studio_add("job", job)
        self.write_json(self.incoming / (upload_id + ".result.json"), result)
        if destination != source:
            source.unlink(missing_ok=True)
        rollback.unlink(missing_ok=True)
        metadata.update(status="complete", updated=time.time())
        self.write_json(self.incoming / (upload_id + ".json"), metadata)
        self.refresh_tv()
        return result

    def studio_prepare_upload(self, upload_id, metadata):
        if metadata.get("studioPreparationJob"):
            return
        kind = metadata.get("kind")
        destination = ({"kind": "film", "collection": metadata.get("folder", "")} if kind == "my_tv" else
                       {"kind": "series", "series": metadata["series_id"], "season": metadata["season"]} if kind == "my-tv-series" else
                       {"kind": "mabel", "folder": self.channel(int(metadata["channel"]))["folder"]})
        job = self.studio_pi_queue({"upload": upload_id}, destination, metadata.get("compression"))
        if not metadata.get("compression"):
            job["destination"]["preparationIntent"] = "compatible"
            self.state_database.studio_add("job", job)
        metadata.update(status="waiting-laptop", studioPreparationJob=job["id"], updated=time.time())
        self.write_json(self.incoming / (upload_id + ".json"), metadata)

    def studio_finish_original_upload(self, metadata, result, destination):
        original_id = metadata.get("studioOriginalUpload")
        if not original_id:
            return
        original = self.upload_meta(original_id)
        if original.get("source_kind") == "my-tv-copy":
            self.finish_mabel_copy(original, destination)
        self.write_json(self.incoming / (original_id + ".result.json"), {**result, "id": original_id, "offset": original["size"], "noticeAlias": result["id"]})
        self.unlink_with_retry(self.incoming / (original_id + ".part"))
        self.unlink_with_retry(self.incoming / (original_id + ".json"))
