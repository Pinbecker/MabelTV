"""Authenticated original recovery from retained files or durable acquisition IDs."""
import hashlib
import json
import re
import time
import uuid


class StudioOriginalsMixin:
    def studio_backfill_history(self):
        """Promote surviving legacy evidence once; never invent missing sources."""
        from .repositories.studio_provenance import keep_acquisition, keep_delivery
        metadata = self.state_database.studio_cloud_metadata_records()
        with self.state_database.transaction() as db:
            deliveries = {value["id"] for value in self.state_database._studio_records(db, "delivery")}
            for job in self.state_database._studio_records(db, "job"):
                if not all(key in job for key in ("source", "title", "created", "destination")):
                    continue
                keep_acquisition(db, job)
                self.state_database._studio_put(db, "job", job)
                if job.get("status") != "complete" or job["id"] in deliveries:
                    continue
                copies = {}
                for item in self.studio_cloud_files:
                    record = metadata.get(item["id"], {})
                    if record.get("publicationJob") != job["id"] or record.get("fingerprint") != self._studio_title_fingerprint(item):
                        continue
                    for role in record.get("variants", []):
                        if role in {"original", "optimised"}:
                            copies[role] = {key: item.get(key, "") for key in ("id", "path", "bytes", "modified", "remoteId")}
                            copies[role]["confirmed"] = True
                job["provenance"] = {"source": {"bytes": job["source"].get("bytes")}, "cloudCopies": copies,
                                      "pi": job.get("result"), "legacy": True}
                keep_delivery(db, job)

    def studio_record_provenance(self, payload):
        from .repositories.studio_provenance import keep_delivery
        identity = str(payload.get("job", ""))
        provenance = payload.get("provenance")
        if not isinstance(provenance, dict) or len(json.dumps(provenance)) > 16000:
            raise ValueError("Invalid source receipt")
        pi = provenance.get("pi")
        if isinstance(pi, dict) and pi.get("complete"):
            try:
                path = self.upload_destination(pi)
                if pi.get("kind") == "my_tv":
                    pi["library_id"] = self.my_tv_media_states().get(self.my_tv_relative_path(path), {}).get("library_id")
                elif pi.get("kind") == "my-tv-series":
                    key = pi["series_id"] + "/" + path.relative_to(self.my_tv_series_root / pi["series_id"]).as_posix()
                    pi["library_id"] = self.my_tv_series_states()["episodes"].get(key, {}).get("library_id")
            except (ValueError, KeyError, TypeError):
                pass
        with self.state_database.transaction() as db:
            job = next((value for value in self.state_database._studio_records(db, "job") if value["id"] == identity), None)
            if not job or not payload.get("claim") or job.get("claim") != payload["claim"] or job["status"] != "active":
                raise ValueError("This Studio claim is no longer active")
            receipt = {**job, "id": identity + (":" + str(payload["fileIndex"]) if type(payload.get("fileIndex")) is int else ""),
                       "provenance": provenance, "result": provenance.get("pi", {}), "status": "complete"}
            keep_delivery(db, receipt)
        return {"ok": True}

    def studio_original_info(self, payload):
        identity = str(payload.get("id", ""))
        library_id = None
        if payload.get("kind") in {"my_tv", "my-tv-series"}:
            _, _, _, library_id, _ = self.remote_source(payload)
        delivery = next((value for value in self.state_database.studio_records("delivery") if value.get("id") == identity or any(
            item.get("id") == identity for item in value.get("provenance", {}).get("cloudCopies", {}).values()) or
            library_id and (value.get("provenance", {}).get("pi") or {}).get("library_id") == library_id), None)
        if not delivery:
            return {"available": False, "reason": "No recorded original source"}
        acquisition = next((value for value in self.state_database.studio_records("acquisition")
                            if value["id"] == delivery["acquisitionId"]), None)
        related = [value for value in self.state_database.studio_records("delivery") if value.get("acquisitionId") == delivery["acquisitionId"]]
        retained = next((value["provenance"]["cloudCopies"]["original"] for value in related
                         if value.get("provenance", {}).get("cloudCopies", {}).get("original")), None)
        if retained:
            try:
                item = self.studio_cloud_item(retained["id"])
                if item["bytes"] != retained["bytes"] or any(item.get(k, "") != retained.get(k, "") for k in ("modified", "remoteId")):
                    retained = None
            except ValueError:
                retained = None
        origin = acquisition["source"] if acquisition else {}
        recoverable = bool(origin.get("type") == "iplayer" and re.fullmatch(r"[bmp][a-z0-9]{7}", str(origin.get("pid", "")))
                           or origin.get("type") == "torrent" and origin.get("magnet") and origin.get("files")
                           or origin.get("type") == "import" and origin.get("path") and origin.get("worker"))
        return {"available": bool(retained or recoverable), "acquisitionId": acquisition["id"] if acquisition else "",
                "title": acquisition.get("title", "") if acquisition else "", "retained": bool(retained),
                "bytes": delivery.get("provenance", {}).get("source", {}).get("bytes"),
                "reason": "" if retained or recoverable else "No recorded original source",
                "deliveryId": delivery["id"], "original": retained}

    def studio_download_original(self, payload, enqueue=True):
        info = self.studio_original_info(payload)
        if not info["available"]:
            raise ValueError(info["reason"])
        acquisition = next(value for value in self.state_database.studio_records("acquisition") if value["id"] == info["acquisitionId"])
        destination = self.studio_destination(payload.get("destination"))
        mode = payload.get("mode", "alongside")
        if mode not in {"alongside", "replace"}:
            raise ValueError("Choose Keep alongside or Replace existing")
        source = dict(acquisition["source"])
        delivery = next(value for value in self.state_database.studio_records("delivery") if value["id"] == info["deliveryId"])
        selected = delivery.get("provenance", {}).get("fileIndex")
        if source.get("type") == "torrent" and type(selected) is int:
            source["files"] = [value for value in source["files"] if value["index"] == selected]
            if not source["files"]:
                raise ValueError("The original torrent file selection is missing")
        if info.get("original"):
            retained = self.studio_cloud_item(info["original"]["id"])
            source = {"type": "cloud", **{key: retained.get(key, "") for key in ("id", "path", "bytes", "modified", "remoteId", "series", "episodeNumber")},
                      "archiveGroup": acquisition["id"], "variants": ["original"]}
        source["acquisitionId"] = acquisition["id"]
        if destination["kind"] == "series" and destination["preserveSeasons"] and type(source.get("series")) is int:
            destination["season"] = source["series"]
        destination.update(preparationIntent="compatible", cloudCopies="original", saveCloud=destination["kind"] == "icloud" or destination["saveCloud"],
                           prepare=destination["kind"] != "icloud", recoveryMode=mode)
        if mode == "replace":
            destination["replaceDelivery"] = info["deliveryId"]
            if payload.get("confirmReplace") is not True:
                raise ValueError("Confirm which existing copy will be replaced")
            if destination["kind"] == "icloud":
                previous = delivery.get("provenance", {}).get("cloudCopies", {}).get("optimised")
                if not previous:
                    raise ValueError("No optimised iCloud copy to replace. Choose Keep alongside")
                item = self.studio_cloud_item(previous["id"])
                if any(item.get(key, "") != previous.get(key, "") for key in ("bytes", "modified", "remoteId")):
                    raise ValueError("The existing iCloud version changed. Refresh before replacing it")
                destination["replaceFrozen"] = item
            else:
                previous = delivery.get("provenance", {}).get("pi") or delivery.get("result")
                if not previous or not previous.get("complete"):
                    raise ValueError("No recorded TV copy to replace. Choose Keep alongside")
                expected = {"film": "my_tv", "series": "my-tv-series", "mabel": "channel"}[destination["kind"]]
                if previous.get("kind") != expected or expected == "my-tv-series" and previous.get("series_id") != destination.get("series") \
                        or expected == "channel" and previous.get("channel") != destination.get("channel"):
                    raise ValueError("Choose the existing TV destination to replace it, or Keep alongside")
                if expected == "my_tv" and previous.get("library_id"):
                    current = next((name for name, state in self.my_tv_media_states().items() if state.get("library_id") == previous["library_id"]), None)
                    if current:
                        previous = {**previous, "file_name": current.rsplit("/", 1)[-1], "folder": current.rsplit("/", 1)[0] if "/" in current else ""}
                path = self.upload_destination(previous)
                stat = path.stat()
                destination["replaceFrozen"] = {"receipt": previous, "bytes": stat.st_size, "mtime": stat.st_mtime_ns, "inode": stat.st_ino}
        now = time.time()
        job = {"id": uuid.uuid4().hex, "source": source, "title": acquisition["title"], "match": acquisition.get("match"),
               "destination": destination, "status": "queued", "stage": "queued", "percent": 0, "created": now, "updated": now,
               "policyVersion": 2, "originalRecovery": True}
        job["fingerprint"] = hashlib.sha256(json.dumps([source, destination], sort_keys=True).encode()).hexdigest()
        if not enqueue:
            return job
        result = self.state_database.studio_add_jobs([job])
        return {"ok": True, "ids": [value["id"] for value in result]}

    def studio_originals_info(self, payload):
        identities = payload.get("ids")
        if not isinstance(identities, list) or not 1 <= len(identities) <= 100 or any(not isinstance(value, str) for value in identities):
            raise ValueError("Choose up to 100 files")
        items = [self.studio_original_info({"id": value}) for value in dict.fromkeys(identities)]
        available = all(value["available"] for value in items)
        return {"available": available, "items": items,
                "title": items[0].get("title", "") if len(items) == 1 else str(len(items)) + " originals",
                "reason": "" if available else "Some selected files have no recorded original source"}

    def studio_download_originals(self, payload):
        identities = payload.get("ids")
        if not isinstance(identities, list) or not 1 <= len(identities) <= 100 or any(not isinstance(value, str) for value in identities):
            raise ValueError("Choose up to 100 originals")
        # Freeze and validate every destination before any item is admitted.
        jobs = [self.studio_download_original({**payload, "id": identity}, enqueue=False) for identity in dict.fromkeys(identities)]
        result = self.state_database.studio_add_jobs(jobs)
        return {"ok": True, "ids": [value["id"] for value in result]}
