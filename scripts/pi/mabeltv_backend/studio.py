"""Portal/desktop Studio commands, validation and durable worker coordination."""
from __future__ import annotations

import hashlib
import base64
import json
from pathlib import PurePosixPath
import re
import time
import uuid
from .compression import compression_profile, compression_choices


class StudioMixin:
    def studio_status(self):
        now = time.time()
        workers = self.state_database.studio_records("worker")
        jobs = [job for job in self.state_database.studio_records("job") if not job.get("historyHidden")]
        for job in jobs:
            job.pop("claim", None)
            if job["status"] in {"queued", "active"} and not any(now - w["seen"] < 25 for w in workers):
                job["displayStatus"] = "Queued"
        return {"compressionProfiles": compression_choices(), "backup": self.studio_backup_latest(), "workers": [{**w, "online": now - w["seen"] < 25} for w in workers],
                "jobs": jobs, "cloudOperations": self.state_database.studio_records("cloudop"),
                "organiser": self.studio_organiser_status(),
                "organiserUsage": self.state_database.studio_records("aiusage"), "cloud": self.studio_cloud_status(), "now": now}

    def studio_request(self, payload):
        query = str(payload.get("query", "")).strip()
        if not 1 <= len(query) <= 200:
            raise ValueError("Enter a programme name or BBC episode link")
        kind = str(payload.get("kind", "search"))
        if kind not in {"search", "metadata"}:
            raise ValueError("Choose an iPlayer request")
        if kind == "metadata" and not re.fullmatch(r"[bmp][a-z0-9]{7}", query):
            raise ValueError("Choose a BBC programme")
        existing = sorted(self.state_database.studio_records("request"), key=lambda r: r["created"], reverse=True)
        if not payload.get("refresh"):
            cached = next((r for r in existing if r["query"].casefold() == query.casefold()
                           and r["kind"] == kind and r["status"] in {"queued", "active", "complete"}
                           and time.time() - r["created"] < 21600), None)
            if cached:
                return self._studio_public_request(cached)
        request = {"id": uuid.uuid4().hex, "kind": kind, "query": query, "refresh": bool(payload.get("refresh")),
                   "status": "queued", "created": time.time(), "updated": time.time()}
        self.state_database.studio_add("request", request)
        return self._studio_public_request(request)

    @staticmethod
    def _studio_public_request(request):
        return {k: v for k, v in request.items() if k not in {"claim", "worker", "lease"}}

    def studio_request_status(self, identity):
        request = next((r for r in self.state_database.studio_records("request") if r["id"] == identity), None)
        if request is None:
            raise ValueError("That search expired. Search again.")
        return self._studio_public_request(request)

    def studio_destination(self, value):
        if not isinstance(value, dict) or value.get("kind") not in {"mabel", "film", "series", "icloud"}:
            raise ValueError("Choose where this media should go")
        destination = {"kind": value["kind"], "prepare": value.get("prepare", value["kind"] in {"mabel", "film", "series"}) is True,
                       "keepOptimised": value.get("keepOptimised", True) is True,
                       "saveCloud": value.get("saveCloud", False) is True, "preserveSeasons": value.get("preserveSeasons") is True}
        destination.update(temporaryWork=True, keepOptimised=False)
        destination["allowRisk"] = value.get("allowRisk") is True
        destination["unattended"] = value.get("unattended") is True
        destination["preparationIntent"] = "compatible" if value.get("preparationIntent") == "compatible" or (not value.get("preparationIntent") and not value.get("compression") and value["kind"] != "icloud") else "compress"
        if "compression" in value:
            destination["compression"] = compression_profile(value["compression"])["id"]
        if not isinstance(value.get("cloudCopies", "original"), str) or value.get("cloudCopies", "original") not in {"original", "optimised", "both"}:
            raise ValueError("Choose Original, Optimised or Both for iCloud")
        destination["cloudCopies"] = value.get("cloudCopies", "original")
        if value.get("optimiseCloud") is True:
            if destination["preparationIntent"] == "compatible":
                raise ValueError("Choose a compression profile for an iCloud space-saving replacement")
            if value["kind"] != "icloud" or destination["cloudCopies"] != "optimised":
                raise ValueError("Choose an optimised iCloud replacement")
            destination["optimiseCloud"] = True
            destination["label"] = "Optimise iCloud version"
        destination["prepare"] = value["kind"] != "icloud" or destination["cloudCopies"] != "original"
        if destination["kind"] == "mabel":
            channel = next((c for c in self.channels() if c["folder"] == value.get("folder")), None)
            if not channel:
                raise ValueError("Choose an existing Mabel TV channel")
            destination.update(folder=channel["folder"], channel=channel["number"], label=channel["name"])
        elif destination["kind"] == "series":
            season = value.get("season")
            if type(season) is not int or not 0 <= season <= 99:
                raise ValueError("Choose a season from 0 to 99")
            identity = str(value.get("series", ""))
            name = str(value.get("name", "")).strip()[:120]
            if identity:
                series = next((s for s in self.my_tv_series_library() if s["id"] == identity), None)
                if not series:
                    raise ValueError("Choose an existing series")
                name = series["title"]
            if not name:
                raise ValueError("Enter the series name")
            destination.update(series=identity, name=name, season=season, label=name)
        else:
            destination["label"] = "Optimise iCloud version" if destination.get("optimiseCloud") else {"film": "My TV films", "icloud": "iCloud"}[destination["kind"]]
        if "collection" in value and destination["kind"] != "mabel":
            collection = value["collection"]
            if not isinstance(collection, str) or len(collection) > 80:
                raise ValueError("Choose an existing collection")
            names = (self.studio_cloud_catalogue({})["collections"] if destination["kind"] == "icloud"
                     else self.my_tv_folders())
            if collection and collection not in names:
                raise ValueError("Choose an existing collection in this library")
            destination["collection"] = collection
        return destination

    def studio_match(self, match):
        if not match:
            return None
        if not isinstance(match, dict) or match.get("media_type") not in {"movie", "tv"} or type(match.get("tmdb_id")) is not int or match["tmdb_id"] < 1:
            raise ValueError("Choose a title match")
        return {"tmdb_id": match["tmdb_id"], "media_type": match["media_type"],
                "title": str(match.get("title", ""))[:200], "year": str(match.get("year", ""))[:4]}

    def studio_create_collection(self, payload):
        name, scope = str(payload.get("name", "")).strip(), payload.get("scope")
        if not name or len(name) > 80 or any(ord(c) < 32 or c in '/\\' for c in name) or name in {".", ".."}:
            raise ValueError("Enter a collection name of up to 80 characters")
        if scope == "icloud":
            value = self.state_database.studio_assign_cloud_collection([], name, create=True)
            return {"name": value, "collections": self.studio_cloud_catalogue({})["collections"]}
        if scope == "pi":
            self.manage({"action": "create-my-tv-folder", "name": name})
            return {"name": self.normalise_my_tv_folder(name), "collections": self.my_tv_folders()}
        raise ValueError("Choose TV or iCloud collection")

    def studio_add_jobs(self, payload):
        sources = payload.get("sources")
        if not isinstance(sources, list) or not 1 <= len(sources) <= 100:
            raise ValueError("Choose between 1 and 100 files or episodes")
        destination = self.studio_destination(payload.get("destination"))
        match = self.studio_match(payload.get("match"))
        cloud_records = self.state_database.studio_cloud_metadata_records() if any(isinstance(value, dict) and value.get("type") == "cloud" for value in sources) else {}
        jobs = []
        for source in sources:
            if not isinstance(source, dict):
                raise ValueError("Choose a media source")
            if source.get("type") == "cloud":
                if destination["kind"] == "icloud" and not destination.get("optimiseCloud"):
                    raise ValueError("This item is already in iCloud. Choose My TV or Mabel TV.")
                item = self.studio_cloud_item(str(source.get("id", "")))
                if not self._studio_media_file(item):
                    raise ValueError("Choose video files to send to a TV library")
                cloud_title = self.studio_cloud_title_for_file(item["id"])
                source_match = cloud_title.get("metadata") or match
                origin = {"type": "cloud", "id": item["id"], "path": item["path"], "bytes": item["bytes"],
                          "modified": item.get("modified", ""), "remoteId": item.get("remoteId", "")}
                origin["archiveGroup"] = cloud_records.get(item["id"], {}).get("archiveGroup") or hashlib.sha256(item["id"].encode()).hexdigest()[:32]
                origin["variants"] = cloud_records.get(item["id"], {}).get("variants", [])
                ancestor = next((delivery for delivery in self.state_database.studio_records("delivery")
                                 if any(copy.get("id") == item["id"] for copy in delivery.get("provenance", {}).get("cloudCopies", {}).values())), None)
                if ancestor:
                    origin["acquisitionId"] = ancestor["acquisitionId"]
                if destination["cloudCopies"] == "optimised":
                    if payload.get("replaceCloudOriginal") is not True or any(source.get(key) != item.get(key, "") for key in ("bytes", "modified", "remoteId")):
                        raise ValueError("Confirm that the original iCloud copy will be replaced. Choose Both to keep it.")
                if "series" in item:
                    origin.update(series=item["series"], episodeNumber=item["episodeNumber"])
                title = cloud_title["title"]
            elif source.get("type") == "iplayer" and re.fullmatch(r"[bmp][a-z0-9]{7}", str(source.get("pid", ""))):
                source_match = match
                origin = {"type": "iplayer", "pid": source["pid"]}
                title = str(source.get("title", "BBC programme"))[:200]
                if type(source.get("series")) is int and 0 <= source["series"] <= 99:
                    origin["series"] = source["series"]
            elif source.get("type") == "torrent":
                origin = self.studio_torrent_source(source)
                source_match = match if len(origin["files"]) == 1 or match and match["media_type"] == "tv" else None
                title = str(source_match.get("title") if source_match else origin["title"])[:240]
            else:
                raise ValueError("Choose an iCloud file, BBC programme or download result")
            if destination.get("optimiseCloud") and origin["type"] != "cloud":
                raise ValueError("Choose an existing iCloud video to optimise")
            chosen = dict(destination)
            chosen["saveCloud"] = True
            if origin["type"] == "cloud" and chosen["cloudCopies"] == "optimised":
                chosen["replaceCloudOriginal"] = True
            if origin["type"] != "cloud":
                chosen.update(saveCloud=True, cloudCopies=destination.get("cloudCopies", "original"))
                if chosen["cloudCopies"] != "original":
                    chosen["prepare"] = True
            if chosen["kind"] == "series" and chosen["preserveSeasons"] and "series" in origin:
                chosen["season"] = origin["series"]
            excluded = {"archiveGroup", "variants", "path"} if origin["type"] == "cloud" else {"inspection", "magnet", "title"} if origin["type"] == "torrent" else set()
            stable_origin = {key: value for key, value in origin.items() if key not in excluded}
            fingerprint = hashlib.sha256(json.dumps([stable_origin, chosen], sort_keys=True).encode()).hexdigest()
            existing = next((j for j in self.state_database.studio_records("job") if j.get("fingerprint") == fingerprint
                             and j["status"] in {"queued", "active", "paused"}), None)
            if existing:
                jobs.append(existing)
                continue
            jobs.append({"id": uuid.uuid4().hex, "fingerprint": fingerprint,
                "source": origin, "title": title, "destination": chosen, "match": self.studio_match(source_match),
                "status": "queued", "stage": "queued", "percent": 0, "policyVersion": 2, "created": time.time(), "updated": time.time()})
        jobs = self.state_database.studio_add_jobs(jobs)
        return {"ok": True, "ids": [j["id"] for j in jobs]}

    def studio_job_action(self, payload):
        if payload.get("allowRisk") is True:
            job = next((value for value in self.state_database.studio_records("job") if value["id"] == str(payload.get("id", ""))), None)
            if not job or job.get("errorCode") != "QUALITY_REVIEW" or job["status"] != "failed":
                raise ValueError("Choose a file awaiting compression confirmation")
            job["destination"]["allowRisk"] = True
            self.state_database.studio_add("job", job)
        self.state_database.studio_action(str(payload.get("id", "")), str(payload.get("action", "")),
                                          self.studio_match(payload.get("match")), payload.get("cloudCopies", "original"))
        return {"ok": True}

    def studio_worker_poll(self, payload):
        identity = str(payload.get("id", ""))
        if not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise ValueError("Studio needs a valid worker identity")
        active = payload.get("active")
        if active and (not isinstance(active, dict) or len(json.dumps(active)) > 16384):
            raise ValueError("Invalid Studio progress")
        responses = payload.get("responses", [])
        if not isinstance(responses, list) or len(json.dumps(responses)) > 2 * 1024 * 1024:
            raise ValueError("Invalid Studio search response")
        capabilities = payload.get("capabilities", [])
        if not isinstance(capabilities, list) or len(capabilities) > 10 or any(not isinstance(item, str) or item not in {"torrent", "cloud-optimise", "parallel-stages", "compression-presets", "library-collections", "intel-policy-v2"} for item in capabilities):
            raise ValueError("Invalid Studio capabilities")
        actives = payload.get("activeJobs")
        if actives is not None and ("parallel-stages" not in capabilities or not isinstance(actives, list)
                or len(actives) > 64 or any(not isinstance(value, dict) or not isinstance(value.get("id"), str)
                                          or len(json.dumps(value)) > 16384 for value in actives)
                or len({value["id"] for value in actives}) != len(actives)):
            raise ValueError("Invalid Studio parallel progress")
        worker_session = payload.get("session", "")
        if not isinstance(worker_session, str) or worker_session and ("parallel-stages" not in capabilities
                or not re.fullmatch(r"[a-f0-9]{32}", worker_session)):
            raise ValueError("Invalid Studio worker session")
        request_active = payload.get("requestActive")
        if request_active is not None and (not isinstance(request_active, dict) or len(json.dumps(request_active)) > 300):
            raise ValueError("Invalid Studio request lease")
        responses = self.studio_torrent_worker_responses(responses)
        result = self.state_database.studio_poll(identity, str(payload.get("name", "Laptop"))[:80], active, responses,
                                                capabilities, request_active, actives, worker_session)
        self.studio_pi_sync_progress()
        return result

    def studio_subtitle(self, payload):
        """Attach text only to a server-confirmed publication, never an arbitrary path."""
        result = self.upload_status(str(payload.get("upload", "")))
        if not result.get("complete"):
            raise ValueError("Wait until the video has been published")
        video = self.upload_destination(result)
        if not video.is_file():
            raise ValueError("The published video is no longer available")
        language = str(payload.get("language", "en"))
        if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", language):
            raise ValueError("Choose a subtitle language")
        try:
            data = base64.b64decode(str(payload.get("data", "")), validate=True)
            if data.startswith((b"\xff\xfe", b"\xfe\xff")):
                text = data.decode("utf-16")
            else:
                try:
                    text = data.decode("utf-8-sig")
                except UnicodeDecodeError:
                    text = data.decode("cp1252")
        except (ValueError, UnicodeError):
            raise ValueError("Choose a text SRT subtitle") from None
        if len(data) > 1024 * 1024 or "\x00" in text or "-->" not in text[:65536]:
            raise ValueError("Choose an SRT subtitle smaller than 1 MB")
        target = video.with_name(video.stem + "." + language + ".srt")
        temporary = target.with_suffix(".srt.new")
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(target)
        return {"ok": True}
