"""Version-bound subtitle alternatives. Selection never issues a TV command."""
import base64
import hashlib
import json
import re
import subprocess
import tempfile
import time
from functools import wraps
from pathlib import Path, PurePosixPath


def subtitle_serialised(function):
    @wraps(function)
    def call(self, *args, **kwargs):
        with self.subtitle_track_lock:
            return function(self, *args, **kwargs)
    return call


def subtitle_text(data):
    if len(data) > 1024 * 1024:
        raise ValueError("Choose subtitles smaller than 1 MB")
    try:
        text = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252")
    if "\x00" in text or not re.search(r"\d\d:\d\d:\d\d[,.]\d{3}\s+-->", text[:65536]):
        raise ValueError("Choose a text subtitle with valid timings")
    text = re.sub(r"</?font\b[^>]*>|\{\\[^}]*\}", "", text, flags=re.I)
    return text.replace("\r\n", "\n")


class SubtitleTracksMixin:
    def subtitle_upload_source(self, receipt):
        video = self.upload_destination(receipt)
        source = {"kind": receipt["kind"], "file": self.my_tv_relative_path(video) if receipt["kind"] == "my_tv" else video.name}
        if receipt["kind"] == "my-tv-series":
            source.update(series=receipt["series_id"], file=video.relative_to(self.my_tv_series_root / receipt["series_id"]).as_posix())
        elif receipt["kind"] == "channel":
            source["channel"] = receipt["channel"]
        return source

    def subtitle_context(self, payload):
        source = payload.get("source", payload)
        if not isinstance(source, dict) or source.get("kind") not in {"cloud", "my_tv", "my-tv-series", "channel"}:
            raise ValueError("Choose a library video")
        if source.get("kind") == "cloud":
            item = self.studio_cloud_item(str(source.get("id", "")))
            if not self._studio_media_file(item):
                raise ValueError("Choose a video")
            identity = "cloud:" + (item.get("remoteId") or item["id"])
            return {"id": hashlib.sha256(identity.encode()).hexdigest(), "source": {"kind": "cloud", "id": item["id"]},
                    "item": item, "title": (item.get("metadata") or {}).get("title") or item["name"],
                    "metadata": item.get("metadata") or {}, "fingerprint": [item["bytes"], item.get("modified"), item.get("remoteId")]}
        kind, path, title, identity, _ = self.remote_source(source)
        stat = path.stat()
        if kind == "my_tv":
            metadata = self.my_tv_media_states().get(self.my_tv_relative_path(path), {}).get("metadata", {})
        elif kind == "my-tv-series":
            metadata = self.my_tv_series_states()["series"].get(source["series"], {}).get("metadata", {})
        else:
            states = self.channel_media_states()
            metadata = states.get("programmes", {}).get(self.channel_programme_key(source["channel"], path.name), {})
        identity = str(identity or path)
        return {"id": hashlib.sha256((kind + ":" + identity).encode()).hexdigest(), "source": source,
                "path": path, "title": metadata.get("title") or title, "metadata": metadata,
                "fingerprint": [stat.st_size, str(stat.st_mtime_ns), str(stat.st_ino)]}

    def subtitle_record(self, context):
        value = next((value for value in self.state_database.studio_records("subtitles") if value["id"] == context["id"]), None)
        if not value or value.get("fingerprint") != context["fingerprint"]:
            value = {"id": context["id"], "fingerprint": context["fingerprint"], "tracks": [], "selected": "", "source": context["source"]}
        return value

    def subtitle_keep(self, context, record, data, label, origin="included"):
        text = subtitle_text(data)
        identity = hashlib.sha256(text.encode()).hexdigest()[:24]
        if not any(track["id"] == identity for track in record["tracks"]):
            if len(record["tracks"]) >= 12:
                raise ValueError("This copy already has 12 subtitle alternatives")
            record["tracks"].append({"id": identity, "label": str(label)[:180], "origin": origin, "text": text})
        return identity

    def subtitle_import_existing(self, context, record):
        if record["tracks"]:
            return
        if "path" in context:
            paths = self.subtitle_sidecars(context["path"])
            for path in paths[:8]:
                if path.suffix.lower() not in {".srt", ".vtt"}:
                    continue
                identity = self.subtitle_keep(context, record, path.read_bytes(), "Existing subtitles · " + path.name)
                if not record["selected"] or path.name == context["path"].stem + ".en.srt":
                    record["selected"] = identity
        else:
            for item in context["item"].get("subtitles", [])[:8]:
                if item["bytes"] > 1024 * 1024 or not item["path"].lower().endswith((".srt", ".vtt")):
                    continue
                response = subprocess.run(["rclone", "--config", str(self.studio_cloud_config), "cat",
                    "mabeltv_icloud:Media/" + item["path"], "--count", "1048577", "--retries", "1", "--timeout", "20s"],
                    capture_output=True, timeout=30, check=False)
                if response.returncode:
                    raise ValueError("iCloud subtitles could not be read. Try again")
                identity = self.subtitle_keep(context, record, response.stdout, "iCloud subtitles · " + PurePosixPath(item["path"]).name)
                if not record["selected"] or item["path"] == context["item"]["path"] + ".en.srt":
                    record["selected"] = identity
        self.state_database.studio_add("subtitles", record)

    @subtitle_serialised
    def subtitle_tracks(self, payload):
        context = self.subtitle_context(payload)
        record = self.subtitle_record(context)
        self.subtitle_import_existing(context, record)
        if "path" in context and "embedded" not in record:
            try:
                probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "s", "-show_entries",
                    "stream=index,codec_name:stream_tags=language,title", "-of", "json", str(context["path"])],
                    capture_output=True, text=True, timeout=10, check=False)
                record["embedded"] = [{"id": "embedded:" + str(stream["index"]), "label": "Included · " + str(stream.get("tags", {}).get("title") or stream.get("tags", {}).get("language") or "Subtitle track"),
                    "origin": "included", "index": stream["index"]} for stream in json.loads(probe.stdout).get("streams", [])
                    if stream.get("codec_name") in {"subrip", "ass", "ssa", "mov_text", "webvtt", "text"}]
            except (OSError, ValueError, subprocess.TimeoutExpired):
                record["embedded"] = []
            self.state_database.studio_add("subtitles", record)
        return {"title": context["title"], "selected": record["selected"], "configured": bool(self.opensubtitles_key()),
            "tracks": [{key: value for key, value in track.items() if key != "text"} for track in record["tracks"]] + record.get("embedded", []),
            "fingerprint": context["fingerprint"]}

    def subtitle_publish(self, context, record, identity):
        fresh = self.subtitle_context({"source": context["source"]})
        if fresh["fingerprint"] != context["fingerprint"]:
            raise ValueError("This video version changed. Reopen its subtitles")
        track = next((track for track in record["tracks"] if track["id"] == identity), None)
        if identity != "off" and not track:
            raise ValueError("Choose an available subtitle")
        # A valid empty cue overrides embedded/other sidecars without destroying
        # them. The existing remote CC control remains independent during play.
        text = track["text"] if track else "1\n00:00:00,000 --> 00:00:00,001\n\u200b\n"
        if "path" in context:
            path = context["path"].with_name(context["path"].stem + ".en.srt")
            temporary = path.with_suffix(".srt.new")
            temporary.write_text(text, encoding="utf-8")
            temporary.replace(path)
            # MPV's exact-name sidecar also receives the selected text; its old
            # content was retained in SQLite before this publication.
            exact = context["path"].with_suffix(".srt")
            temporary = exact.with_suffix(".srt.new")
            temporary.write_text(text, encoding="utf-8")
            temporary.replace(exact)
        else:
            item = context["item"]
            current = self._studio_cloud_stat("Media/" + item["path"])
            if current.get("Size") != item["bytes"] or current.get("ID", "") != item.get("remoteId", ""):
                raise ValueError("The iCloud version changed. Reopen its subtitles")
            target = item["path"] + ".en.srt"
            with tempfile.TemporaryDirectory(dir=self.studio_cache) as folder:
                path = Path(folder) / "selected.srt"
                path.write_text(text, encoding="utf-8")
                self._studio_cloud_command(["copyto", str(path), "mabeltv_icloud:Media/" + target])
                verified = self._studio_cloud_stat("Media/" + target)
                if verified.get("Size") != path.stat().st_size:
                    raise ValueError("iCloud has not verified the subtitle. Try again")
            self.studio_cloud_wake.set()
        record.update(selected=identity, updated=time.time())
        self.state_database.studio_add("subtitles", record)

    @subtitle_serialised
    def subtitle_select(self, payload):
        context = self.subtitle_context(payload)
        if payload.get("fingerprint") != context["fingerprint"]:
            raise ValueError("This video version changed. Reopen its subtitles")
        record = self.subtitle_record(context)
        identity = str(payload.get("track", ""))
        embedded = next((track for track in record.get("embedded", []) if track["id"] == identity), None)
        if embedded:
            result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(context["path"]), "-map", "0:" + str(embedded["index"]),
                "-c:s", "srt", "-f", "srt", "pipe:1"], capture_output=True, timeout=30, check=False)
            if result.returncode:
                raise ValueError("The included subtitle could not be read. Try a downloaded track")
            identity = self.subtitle_keep(context, record, result.stdout, embedded["label"])
        record["chosenByUser"] = True
        self.subtitle_publish(context, record, identity)
        return {"ok": True, "selected": record["selected"], "nextPlayback": True}

    def subtitle_search(self, payload):
        context = self.subtitle_context(payload)
        match = context["metadata"]
        query = str(payload.get("query") or context["title"]).strip()[:160]
        parameters = {"languages": "en", "query": query}
        if match.get("tmdb_id"):
            parameters["tmdb_id"] = match["tmdb_id"]
        if context["source"]["kind"] == "my-tv-series":
            number = re.search(r"\bS(?:eries|eason)?\s*(\d{1,2})\s*E(?:pisode)?\s*(\d{1,3})\b|\b(\d{1,2})x(\d{1,3})\b", context["path"].stem, re.I)
            if not number:
                raise ValueError("Choose a numbered episode before searching for subtitles")
            parameters.update(season_number=int(number[1] or number[3]), episode_number=int(number[2] or number[4]))
        elif "item" in context and "series" in context["item"]:
            parameters.update(season_number=context["item"]["series"], episode_number=context["item"].get("episodeNumber"))
        if match.get("media_type") == "tv" and (parameters.get("season_number") is None or parameters.get("episode_number") is None):
            raise ValueError("Choose a numbered episode before searching for subtitles")
        if "season_number" in parameters and "tmdb_id" in parameters:
            parameters["parent_tmdb_id"] = parameters.pop("tmdb_id")
        response = self.opensubtitles_request("subtitles", parameters)
        results = []
        for item in response.get("data", []):
            attrs = item.get("attributes", {})
            if attrs.get("language") != "en":
                continue
            for file in attrs.get("files", []):
                identity = file.get("file_id")
                if type(identity) is not int or identity <= 0:
                    continue
                results.append({"id": str(identity), "label": str(attrs.get("release") or file.get("file_name") or "English subtitles")[:200],
                    "fps": attrs.get("fps"), "hearingImpaired": bool(attrs.get("hearing_impaired")), "downloads": attrs.get("download_count", 0)})
        results = results[:40]
        self.state_database.studio_add("subtitleSearch", {"id": context["id"], "results": results, "fingerprint": context["fingerprint"], "updated": time.time()})
        return {"results": results}

    @subtitle_serialised
    def subtitle_download(self, payload):
        context = self.subtitle_context(payload)
        search = next((value for value in self.state_database.studio_records("subtitleSearch") if value["id"] == context["id"]), {})
        selected = next((value for value in search.get("results", []) if value["id"] == str(payload.get("id"))), None)
        if not selected or search.get("fingerprint") != context["fingerprint"] or time.time() - search.get("updated", 0) > 3600:
            raise ValueError("Search for subtitles again before downloading")
        ticket = self.opensubtitles_request("download", body={"file_id": int(selected["id"])})
        data = self.opensubtitles_download_bytes(str(ticket.get("link", "")))
        record = self.subtitle_record(context)
        self.subtitle_import_existing(context, record)
        identity = self.subtitle_keep(context, record, data, selected["label"], "downloaded")
        record["chosenByUser"] = True
        self.subtitle_publish(context, record, identity)
        return self.subtitle_tracks(payload)

    @subtitle_serialised
    def subtitle_receive(self, payload):
        """Preserve transfer tracks before replacing the active subtitle."""
        context = self.subtitle_context(payload)
        record = self.subtitle_record(context)
        self.subtitle_import_existing(context, record)
        identity = self.subtitle_keep(context, record, base64.b64decode(str(payload.get("data", "")), validate=True),
                                     str(payload.get("label") or "Included with download"), "included")
        if payload.get("activate") is False or record.get("chosenByUser"):
            self.state_database.studio_add("subtitles", record)
        else:
            self.subtitle_publish(context, record, identity)
        return {"ok": True, "track": identity}

    @subtitle_serialised
    def subtitle_archive_verify(self, payload):
        context = self.subtitle_context(payload)
        if "item" not in context or type(payload.get("bytes")) is not int or not 0 < payload["bytes"] <= 512 * 1024 * 1024:
            raise ValueError("Choose a subtitle archive for an existing iCloud video")
        path = context["item"]["path"] + ".original-subtitles.mks"
        current = self._studio_cloud_stat_optional("Media/" + path)
        if not current or current.get("Size") != payload["bytes"]:
            return {"confirmed": False}
        record = self.subtitle_record(context)
        record["embeddedArchive"] = {"path": path, "bytes": current["Size"], "remoteId": current.get("ID"), "confirmed": True}
        self.state_database.studio_add("subtitles", record)
        self.studio_cloud_wake.set()
        return {"confirmed": True}

    @subtitle_serialised
    def subtitle_forward(self, payload):
        job = next((value for value in self.state_database.studio_records("job") if value["id"] == payload.get("job")), None)
        if not job or job.get("status") != "active" or not payload.get("claim") or payload["claim"] != job.get("claim") or job["source"]["type"] != "cloud":
            raise ValueError("This transfer no longer owns the subtitle copies")
        source = self.subtitle_context({"source": {"kind": "cloud", "id": job["source"]["id"]}})
        record = self.subtitle_record(source)
        self.subtitle_import_existing(source, record)
        target = self.subtitle_context({"source": payload["target"]})
        if source["id"] == target["id"]:
            return {"ok": True}
        saved = self.subtitle_record(target)
        self.subtitle_import_existing(target, saved)
        for track in record["tracks"]:
            self.subtitle_keep(target, saved, track["text"].encode(), track["label"], track["origin"])
        if record["selected"] and not saved.get("chosenByUser"):
            saved["chosenByUser"] = record.get("chosenByUser", False)
            self.subtitle_publish(target, saved, record["selected"])
        else:
            self.state_database.studio_add("subtitles", saved)
        if "item" in target:
            for archive in source["item"].get("subtitleArchives", []):
                if not 0 < archive["bytes"] <= 512 * 1024 * 1024:
                    raise ValueError("The original subtitle archive needs review")
                destination = target["item"]["path"] + ".original-subtitles.mks"
                self._studio_cloud_command(["copyto", "mabeltv_icloud:Media/" + archive["path"],
                    "mabeltv_icloud:Media/" + destination, "--max-transfer", "512Mi"])
                if self._studio_cloud_stat("Media/" + destination).get("Size") != archive["bytes"]:
                    raise ValueError("iCloud has not confirmed the subtitle archive")
        return {"ok": True}

    @subtitle_serialised
    def subtitle_replacement_snapshot(self, previous, replacement):
        original = self.subtitle_context(self.subtitle_upload_source(previous))
        old = self.subtitle_record(original)
        self.subtitle_import_existing(original, old)
        context = self.subtitle_context(self.subtitle_upload_source(replacement))
        record = self.subtitle_record(context)
        self.subtitle_import_existing(context, record)
        return {"tracks": record["tracks"], "selected": record["selected"], "chosenByUser": record.get("chosenByUser", False),
                "oldSidecars": [path.name for path in self.subtitle_sidecars(original["path"])]}

    @subtitle_serialised
    def subtitle_replacement_restore(self, receipt, snapshot):
        context = self.subtitle_context(self.subtitle_upload_source(receipt))
        record = self.subtitle_record(context)
        record.update(tracks=snapshot.get("tracks", []), selected=snapshot.get("selected", ""), chosenByUser=snapshot.get("chosenByUser", False))
        self.state_database.studio_add("subtitles", record)
