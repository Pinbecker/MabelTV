"""Confirmed deletion of selected cloud films/episodes and their subtitle sidecars."""
from __future__ import annotations
import json
import hashlib
from pathlib import PurePosixPath
import subprocess
import time
import uuid
from .subtitle_files import belongs_to_video

class StudioCloudManagerMixin:
    def studio_cloud_replace_original(self, payload):
        job = next((value for value in self.state_database.studio_records("job") if value["id"] == payload.get("job")), None)
        if not job or job["source"]["type"] != "cloud" or job["status"] != "active" or not job.get("claim") or job["claim"] != payload.get("claim"):
            raise ValueError("This Studio task no longer owns the replacement")
        if not job["destination"].get("replaceCloudOriginal") or job["destination"].get("cloudCopies") != "optimised":
            raise ValueError("Choose Both to keep the original, or confirm its replacement first")
        output_id = str(payload.get("output", ""))
        previous = next((value for value in self.state_database.studio_records("cloudop") if value.get("archiveJob") == job["id"] and value.get("archiveOutput") == output_id), None)
        if previous:
            return {"id": previous["id"], "complete": previous["status"] == "complete", "status": previous["status"], "error": previous.get("error", "")}
        if job["destination"]["kind"] in {"film", "series", "mabel"}:
            result = self.upload_status(str(payload.get("upload", "")))
            if not result.get("complete") or not self.upload_destination(result).is_file():
                raise ValueError("Wait until the TV copy has been published")
        with self.studio_cloud_lock:
            files = {value["id"]: dict(value) for value in self.studio_cloud_files}
        records = self.state_database.studio_cloud_metadata_records()
        output, record = files.get(output_id), records.get(output_id, {})
        if not output or record.get("publicationJob") != job["id"] or "optimised" not in record.get("variants", []):
            raise ValueError("Wait for iCloud to confirm this task's optimised copy")
        current = self._studio_cloud_stat("Media/" + output["path"])
        if current.get("IsDir") or current.get("ID") != output.get("remoteId") or current.get("Size") != output["bytes"] or current.get("ModTime", "") != output.get("modified", ""):
            raise ValueError("The optimised cloud copy changed. The original was kept.")
        if output_id == job["source"]["id"]:
            return {"complete": True, "retainedExisting": True}
        if any(other["id"] != job["id"] and other["status"] in {"queued", "active", "paused"} and
               other["source"].get("id") == job["source"]["id"] for other in self.state_database.studio_records("job")):
            raise ValueError("Another transfer still needs the original. It was kept; finish that transfer before retrying.")
        original = files.get(job["source"]["id"])
        if not original or any(original.get(key, "") != job["source"].get(key, "") for key in ("bytes", "modified", "remoteId")):
            raise ValueError("The original changed. Refresh and confirm its replacement again.")
        if job["destination"].get("optimiseCloud") and output["bytes"] >= original["bytes"]:
            raise ValueError("The replacement would not save space. The original was kept.")
        current = self._studio_cloud_stat("Media/" + original["path"])
        if current.get("IsDir") or any(current.get(key, "") != original.get(field, "") for key, field in (("ID", "remoteId"), ("Size", "bytes"), ("ModTime", "modified"))):
            raise ValueError("The original changed. It was kept for a fresh confirmation.")
        identity = hashlib.sha256((job["id"] + output_id).encode()).hexdigest()[:32]
        operation = self.state_database.studio_add("cloudop", {"id": identity, "action": "delete",
            "archiveJob": job["id"], "archiveOutput": output_id, "status": "queued", "completed": 0,
            "created": time.time(), "updated": time.time(), "items": [{"path": "Media/" + original["path"],
                "bytes": original["bytes"], "modified": original.get("modified", ""), "remoteId": original.get("remoteId", "")}]})
        self.studio_cloud_wake.set()
        return {"id": operation["id"], "complete": operation["status"] == "complete", "status": operation["status"]}

    def studio_cloud_operation(self, payload):
        if payload.get("action") != "delete":
            raise ValueError("Only deletion of films and TV episodes is available")
        if payload.get("confirmed") is not True:
            raise ValueError("Confirm deletion from iCloud first")
        selected = payload.get("items")
        if not isinstance(selected, list) or not 1 <= len(selected) <= 500:
            raise ValueError("Choose between 1 and 500 films or episodes")
        with self.studio_cloud_lock:
            files = {item["id"]: dict(item) for item in self.studio_cloud_files}
        frozen = {}
        for selection in selected:
            item = files.get(str(selection.get("id", "")))
            if not item or not self._studio_media_file(item):
                raise ValueError("Choose a current film or TV episode, then confirm again")
            if any(selection.get(key) != item.get(key, "") for key in ("bytes", "modified", "remoteId")):
                raise ValueError("A selected video changed. Refresh and confirm deletion again.")
            stem = str(PurePosixPath(item["path"]).with_suffix(""))
            shared = any(other["id"] not in {value.get("id") for value in selected}
                         and self._studio_media_file(other) and str(PurePosixPath(other["path"]).with_suffix("")) == stem
                         for other in files.values())
            related = [item] + [sidecar for sidecar in files.values()
                if sidecar.get("extension") in {".srt", ".vtt", ".ass", ".mks"}
                and belongs_to_video(item["path"], sidecar["path"])
                and (not shared or sidecar["path"].startswith(item["path"] + "."))]
            for value in related:
                frozen[value["id"]] = {"path": "Media/" + value["path"], "bytes": value["bytes"],
                    "modified": value.get("modified", ""), "remoteId": value.get("remoteId", "")}
        value = {"id": uuid.uuid4().hex, "action": "delete", "items": list(frozen.values()),
                 "status": "queued", "completed": 0, "created": time.time(), "updated": time.time()}
        self.state_database.studio_add("cloudop", value)
        self.studio_cloud_wake.set()
        return {"ok": True, "id": value["id"]}

    def _studio_cloud_command(self, args):
        try:
            response = subprocess.run(["rclone", "--config", str(self.studio_cloud_config),
                "--contimeout", "20s", "--timeout", "60s", "--retries", "1", *args],
                capture_output=True, timeout=120, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError("iCloud did not confirm the change. Refresh before trying again.") from None
        if response.returncode:
            raise ValueError("iCloud could not complete this change. Refresh and check the connection.")

    def _studio_cloud_stat(self, path):
        result = self._studio_cloud_stat_optional(path)
        if result is None:
            raise ValueError("That cloud item is no longer available. Refresh before changing it.")
        return result

    def _studio_cloud_stat_optional(self, path):
        try:
            response = subprocess.run(["rclone", "--config", str(self.studio_cloud_config), "lsjson",
                "mabeltv_icloud:" + path, "--stat", "--no-mimetype", "--contimeout", "20s", "--timeout", "60s", "--retries", "1"],
                capture_output=True, timeout=90, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError("iCloud could not check the destination. No change was made.") from None
        if response.returncode in {3, 4}:
            return None
        if response.returncode:
            raise ValueError("iCloud could not check this item. Reconnect before trying again.")
        return json.loads(response.stdout)

    def studio_cloud_operations_step(self):
        operations = self.state_database.studio_records("cloudop")
        operation = next((item for item in sorted(operations, key=lambda value: value["created"]) if item["status"] == "queued"), None)
        if not operation:
            return
        operation.update(status="active", updated=time.time())
        self.state_database.studio_add("cloudop", operation)
        try:
            if operation["action"] != "delete":
                raise ValueError("Folder management was removed. No files were changed.")
            for item in operation["items"]:
                if item.get("directory") or not item["path"].startswith("Media/"):
                    raise ValueError("Only selected media files can be deleted")
                current = self._studio_cloud_stat(item["path"])
                if (current.get("IsDir") or int(current.get("Size", -1)) != item["bytes"] or
                    item["remoteId"] and str(current.get("ID", "")) != item["remoteId"] or
                    item["modified"] and str(current.get("ModTime", "")) != item["modified"]):
                    raise ValueError("A selected cloud file changed. Refresh and confirm deletion again.")
                self._studio_cloud_command(["deletefile", "mabeltv_icloud:" + item["path"]])
                if self._studio_cloud_stat_optional(item["path"]) is not None:
                    raise ValueError("iCloud has not confirmed the deletion. Refresh before trying again.")
                self._studio_cloud_remove_from_catalogue(item["path"][len("Media/"):])
                operation.update(completed=operation["completed"] + 1, updated=time.time())
                self.state_database.studio_add("cloudop", operation)
            operation.update(status="complete", updated=time.time())
            self.studio_cloud_attempted = 0
        except (ValueError, OSError, TypeError, KeyError) as error:
            operation.update(status="failed", error=str(error) if isinstance(error, ValueError) else "Deletion could not be confirmed. Refresh iCloud before trying again.", updated=time.time())
        self.state_database.studio_add("cloudop", operation)

    def _studio_cloud_remove_from_catalogue(self, path):
        with self.studio_cloud_lock:
            self.studio_cloud_files = [item for item in self.studio_cloud_files if item["path"] != path]
            self.studio_cloud_checked = time.time()
            temporary = self.studio_cache / "icloud-catalogue.tmp"
            temporary.write_text(json.dumps({"files": self.studio_cloud_files, "checked": self.studio_cloud_checked}), encoding="utf-8")
            temporary.replace(self.studio_cache / "icloud-catalogue.json")
