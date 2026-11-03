"""Phone alerts for verified Pi publications, independent of cloud archiving."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
import threading
import time
from urllib.request import Request


class UploadNotificationsMixin:
    def init_upload_notifications(self):
        self.upload_notice_closed = threading.Event()
        self.upload_notice_worker = None
        self.upload_notice_config = Path(os.environ.get(
            "MABELTV_NTFY_CONFIG", "/var/lib/mabeltv/secrets/ntfy.json"))
        if self.upload_notice_settings() is not None:
            self.upload_notice_worker = threading.Thread(
                target=self.run_upload_notifications, name="mabeltv-upload-notifications", daemon=True)
            self.upload_notice_worker.start()

    def upload_notice_settings(self):
        try:
            value = json.loads(self.upload_notice_config.read_text(encoding="utf-8"))
            if value.get("enabled") is not True:
                return None
            if value.get("server") != "https://ntfy.sh" or not re.fullmatch(
                    r"[A-Za-z0-9_-]{16,100}", str(value.get("topic", ""))):
                return None
            if not isinstance(value.get("enabled_after"), (int, float)) or value["enabled_after"] <= 0:
                return None
            return value
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def close_upload_notifications(self, timeout=10):
        self.upload_notice_closed.set()
        if self.upload_notice_worker:
            self.upload_notice_worker.join(timeout=timeout + 1)

    def run_upload_notifications(self):
        while not self.upload_notice_closed.is_set():
            try:
                self.poll_upload_notifications()
            except Exception:
                print("Pi-ready notification check will retry", file=sys.stderr, flush=True)
            self.upload_notice_closed.wait(5)

    def upload_notice_label(self, result):
        kind = result.get("kind")
        if kind == "my_tv":
            return "My TV films"
        if kind == "my-tv-series":
            series = self.my_tv_series_states().get("series", {}).get(result.get("series_id"), {})
            return "My TV: " + str(series.get("title") or series.get("name") or "TV series") + \
                " / Season " + str(result.get("season", 0))
        number = result.get("channel")
        return next((str(c.get("name") or "Mabel TV") for c in self.channels()
                     if c.get("number") == number), "Mabel TV channel " + str(number))

    def poll_upload_notifications(self):
        config = self.upload_notice_settings()
        if config is None:
            return
        for file in sorted(self.incoming.glob("*.result.json")):
            if self.upload_notice_closed.is_set():
                return
            result = self.read_json(file, {})
            if not isinstance(result, dict):
                continue
            upload_id = result.get("id", "")
            if not re.fullmatch(r"[a-f0-9]{32}", str(upload_id)) or result.get("status") != "complete" \
                    or result.get("complete") is not True or result.get("refreshed") is not True \
                    or result.get("kind") not in {"my_tv", "my-tv-series", "channel"} \
                    or float(result.get("finished", 0)) < config["enabled_after"]:
                continue
            try:
                destination = self.upload_destination(result)
                if result.get("optimised"):
                    destination = destination.with_suffix(".mp4")
                if not destination.is_file() or destination.stat().st_size <= 0:
                    continue
                title = Path(str(result["file_name"])).stem.replace("_", " ")[:200]
                label = self.upload_notice_label(result)
                self.send_completion_notice(upload_id, config, "Ready on your TV", title +
                    " is fully uploaded and available in " + label + ". Any iCloud archiving continues separately.")
            except Exception:
                continue
        self.poll_cloud_completion_notices(config)
        self.poll_optimisation_completion_notices(config)

    def poll_optimisation_completion_notices(self, config):
        for relative, state in self.my_tv_media_states().items():
            identity = str(state.get("compressionOperation", ""))
            if (state.get("state") != "optimised" or not re.fullmatch(r"[a-f0-9]{32}", identity)
                    or float(state.get("compressionCompleted", 0)) < config["enabled_after"]):
                continue
            try:
                file = self.safe_my_tv_path(relative)
                if not file.is_file():
                    continue
                size = file.stat().st_size
                self.send_completion_notice(identity, config, "Optimisation complete",
                    self.display_name(file.name) + f" is ready in My TV ({size / 1e9:.2f} GB).")
            except (ValueError, OSError):
                continue

    def send_completion_notice(self, identity, config, title, message):
        previous = self.state_database.studio_upload_notice(identity)
        if previous.get("status") == "sent" or previous.get("retry_after", 0) > time.time():
            return
        try:
            request = Request(config["server"] + "/" + config["topic"], data=message.encode("utf-8"),
                headers={"Title": title, "Tags": "white_check_mark",
                         "Content-Type": "text/plain; charset=utf-8"}, method="POST")
            with self._open_url(request, timeout=8) as response:
                receipt = json.loads(response.read(32768))
            if receipt.get("event") != "message" or not receipt.get("id"):
                raise ValueError("Notification was not acknowledged")
            self.state_database.studio_save_upload_notice(identity, {
                "status": "sent", "sent_at": time.time(), "message_id": receipt["id"]})
        except Exception:
            self.state_database.studio_save_upload_notice(identity, {
                "status": "retry", "retry_after": time.time() + 60})

    def poll_cloud_completion_notices(self, config):
        for job in self.state_database.studio_records("job"):
            if job.get("status") != "complete" or job.get("updated", 0) < config["enabled_after"] \
                    or job.get("destination", {}).get("kind") != "icloud" or not job.get("savedCloudPath"):
                continue
            unchanged = job.get("result", {}).get("unchanged")
            title = "iCloud original kept" if unchanged else "iCloud optimisation complete" \
                if job["destination"].get("optimiseCloud") else "Saved in iCloud"
            message = job.get("title", "Your video") + (": conversion would not save space; the original was kept."
                if unchanged else ": fully saved and verified in iCloud.")
            self.send_completion_notice("cloud-" + job["id"], config, title, message)
        for operation in self.state_database.studio_records("cloudop"):
            if operation.get("status") == "complete" and not operation.get("archiveJob") \
                    and operation.get("updated", 0) >= config["enabled_after"]:
                self.send_completion_notice("cloudop-" + operation["id"], config, "iCloud cleanup complete",
                    str(len(operation.get("items", []))) + " selected cloud files have been removed.")
