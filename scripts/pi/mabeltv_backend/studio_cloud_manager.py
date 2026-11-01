"""Confirmed deletion of selected cloud films/episodes and their subtitle sidecars."""
from __future__ import annotations
import json
from pathlib import PurePosixPath
import subprocess
import time
import uuid

class StudioCloudManagerMixin:
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
            related = [item] + [sidecar for sidecar in files.values() if sidecar.get("extension") in {".srt", ".vtt", ".ass"} and sidecar["path"].startswith(stem + ".")]
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
