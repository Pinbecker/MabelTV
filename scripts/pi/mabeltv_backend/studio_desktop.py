"""Desktop imports join the same durable Studio workflow, bound to their laptop."""
import hashlib
import json
import re
import time
import uuid


class StudioDesktopMixin:
    def studio_desktop_add(self, payload):
        worker = str(payload.get("worker", ""))
        inputs = payload.get("inputs")
        if not re.fullmatch(r"[a-f0-9]{32}", worker) or not isinstance(inputs, list) or not 1 <= len(inputs) <= 100:
            raise ValueError("Choose up to 100 desktop sources")
        destination = self.studio_destination(payload.get("destination"))
        destination["saveCloud"] = True
        jobs = []
        for value in inputs:
            if not isinstance(value, dict):
                raise ValueError("Invalid desktop source")
            source = {"type": "iplayer", "pid": value.get("metadata", {}).get("pid")} if value.get("kind") == "iplayer" else None
            if source:
                if not re.fullmatch(r"[bmp][a-z0-9]{7}", str(source["pid"])):
                    raise ValueError("Choose a BBC programme")
            else:
                filename = str(value.get("path", ""))
                if not re.match(r"^(?:[A-Za-z]:[\\/]|\\\\)", filename) or not re.search(r"\.(mp4|m4v|mov|mkv|avi|webm|mpg|mpeg|ts)$", filename, re.I):
                    raise ValueError("Choose a Windows video file")
                source = {"type": "import", "path": filename, "worker": worker, "bytes": value.get("bytes"), "mtime": value.get("mtime")}
            metadata = value.get("metadata") or {}
            title = str(metadata.get("title") or value.get("title") or "Imported video")[:200]
            fingerprint = hashlib.sha256(json.dumps([source, destination], sort_keys=True).encode()).hexdigest()
            jobs.append({"id": uuid.uuid4().hex, "source": source, "title": title, "destination": dict(destination),
                         "match": self.studio_match(value.get("match")), "status": "queued", "stage": "queued", "percent": 0,
                         "created": time.time(), "updated": time.time(), "fingerprint": fingerprint, "policyVersion": 2})
        values = self.state_database.studio_add_jobs(jobs)
        return {"ok": True, "jobs": values}
