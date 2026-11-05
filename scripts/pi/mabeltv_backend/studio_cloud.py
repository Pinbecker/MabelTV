"""Always-available iCloud catalogue, separate from downloaded media/state."""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import threading
import time

from .studio_cloud_auth import ICloudConversation


VIDEO = {".mp4", ".mkv", ".m4v", ".mov", ".avi", ".webm", ".mpg", ".mpeg", ".ts"}
AUDIO = {".mp3", ".m4b", ".m4a", ".flac", ".wav", ".ogg"}


class StudioCloudMixin:
    def init_studio_cloud(self):
        self.studio_secrets = self.database_path.parent / "secrets" / "icloud"
        self.studio_secrets.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.studio_cloud_config = self.studio_secrets / "rclone.conf"
        self.studio_cache = self.database_path.parent / "studio-cache"
        self.studio_cache.mkdir(exist_ok=True, mode=0o700)
        self.studio_cloud_lock = threading.RLock()
        self.studio_auth_lock = threading.Lock()
        self.studio_cloud_wake = threading.Event()
        self.studio_cloud_closed = threading.Event()
        self.studio_cloud_scanning = False
        self.studio_cloud_error = ""
        self.studio_cloud_checked = 0
        self.studio_cloud_attempted = 0
        self.studio_cloud_files = []
        self.studio_cloud_conversation = None
        for operation in self.state_database.studio_records("cloudop"):
            if operation["status"] == "active":
                operation.update(status="failed", error="This cloud change was interrupted. Refresh iCloud before trying again.")
                self.state_database.studio_add("cloudop", operation)
        try:
            cached = json.loads((self.studio_cache / "icloud-catalogue.json").read_text())
            self.studio_cloud_files = cached["files"]
            self.studio_cloud_checked = float(cached["checked"])
        except (OSError, ValueError, KeyError, TypeError):
            pass
        self.studio_cloud_thread = threading.Thread(target=self._studio_cloud_loop, daemon=True,
                                                     name="studio-icloud-catalogue")
        self.studio_cloud_thread.start()

    def close_studio_cloud(self):
        self.studio_cloud_closed.set()
        self.studio_cloud_wake.set()
        if self.studio_cloud_conversation:
            self.studio_cloud_conversation.close()
            self.studio_cloud_conversation = None
        self.studio_cloud_thread.join(timeout=2)

    def _studio_cloud_loop(self):
        while not self.studio_cloud_closed.is_set():
            requested = self.studio_cloud_wake.wait(15)
            self.studio_cloud_wake.clear()
            if self.studio_cloud_closed.is_set():
                break
            with self.studio_auth_lock:
                conversation = self.studio_cloud_conversation
                if conversation and time.time() - conversation.created > 900:
                    conversation.close()
                    self.studio_cloud_conversation = None
            if self.studio_cloud_config.is_file():
                self.studio_cloud_operations_step()
            if self.studio_cloud_config.is_file() and (requested or time.time() - self.studio_cloud_attempted > 300):
                self._studio_cloud_scan()
            if self.studio_cloud_config.is_file() and not self.studio_cloud_closed.is_set():
                self.studio_organiser_step()

    def _studio_rclone(self, args, config=None, timeout=180):
        try:
            result = subprocess.run(["rclone", "--config", str(config or self.studio_cloud_config),
                "--contimeout", "20s", "--timeout", "60s", "--retries", "1", "--low-level-retries", "1",
                *args], capture_output=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError("iCloud could not be reached. Your last catalogue is still available.") from None
        if result.returncode:
            raise ValueError("iCloud could not refresh. Check the connection or reconnect your Apple Account.")
        return json.loads(result.stdout)

    def _studio_cloud_scan(self):
        with self.studio_cloud_lock:
            self.studio_cloud_scanning = True
            self.studio_cloud_attempted = time.time()
        try:
            rows = self._studio_rclone(["lsjson", "mabeltv_icloud:Media", "--recursive", "--files-only", "--no-mimetype"])
            files = []
            for row in rows[:50000]:
                path = PurePosixPath(str(row.get("Path", "")))
                if path.is_absolute() or ".." in path.parts or any(p.startswith(".") for p in path.parts):
                    continue
                extension = path.suffix.lower()
                files.append({"id": hashlib.sha256(str(row.get("ID") or path).encode()).hexdigest()[:24],
                    "path": str(path), "name": path.name, "folder": str(path.parent),
                    "bytes": int(row.get("Size", 0)), "modified": str(row.get("ModTime", "")),
                    "remoteId": str(row.get("ID", "")),
                    "extension": extension, "kind": "video" if extension in VIDEO else "audio" if extension in AUDIO else "file"})
            checked = time.time()
            temporary = self.studio_cache / "icloud-catalogue.tmp"
            temporary.write_text(json.dumps({"files": files, "checked": checked}), encoding="utf-8")
            os.replace(temporary, self.studio_cache / "icloud-catalogue.json")
            with self.studio_cloud_lock:
                self.studio_cloud_files, self.studio_cloud_checked, self.studio_cloud_error = files, checked, ""
            for intent in self.state_database.studio_records("archiveintent"):
                if intent.get("status") == "pending":
                    arrived = next((item for item in files if item["path"] == intent["path"] and item["bytes"] == intent["bytes"]), None)
                    if arrived:
                        self.studio_cloud_archive_metadata(arrived, intent)
        except (ValueError, OSError):
            self.studio_cloud_error = "iCloud could not refresh. Your last catalogue is kept; reconnect if this continues."
        finally:
            self.studio_cloud_scanning = False

    def studio_cloud_status(self):
        return {"configured": self.studio_cloud_config.is_file(), "checked": self.studio_cloud_checked,
                "scanning": self.studio_cloud_scanning, "error": self.studio_cloud_error,
                "count": sum(self._studio_media_file(item) for item in self.studio_cloud_files), "root": "Media",
                "collectionRevision": max((item.get("updated", 0) for item in self.state_database.studio_records("cloudmembership")), default=0),
                "metadataRevision": max((item.get("updated", 0) for item in self.state_database.studio_records("cloudmetadata")), default=0)}

    def studio_cloud_refresh(self, payload=None):
        self.studio_cloud_wake.set()
        return self.studio_cloud_status()

    def studio_cloud_catalogue(self, query):
        return self.studio_cloud_media_catalogue(query)

    @staticmethod
    def _studio_cloud_titles(files):
        titles, groups = [], {}
        for item in files:
            path = PurePosixPath(item["path"])
            episode = re.search(r"\bS(\d{1,2})E(\d{1,3})\b", path.stem, re.I) if item["kind"] == "video" else None
            season = next(((index, re.fullmatch(r"(?:Season|Series)\s*(\d{1,2})", part, re.I))
                           for index, part in enumerate(path.parts[:-1]) if re.fullmatch(r"(?:Season|Series)\s*(\d{1,2})", part, re.I)), None) if item["kind"] == "video" else None
            tv_folder = next((index for index, part in enumerate(path.parts[:-2])
                              if part.casefold() in {"tv", "tv shows", "tv series"}), None) if item["kind"] == "video" else None
            if not episode and not season and tv_folder is None:
                titles.append(item)
                continue
            if season:
                root = PurePosixPath(*path.parts[:season[0]]) if season[0] > 0 else path.parent
                name = root.name
                season_number = int(season[1].group(1))
            elif tv_folder is not None:
                root = PurePosixPath(*path.parts[:tv_folder + 2])
                name = root.name
                season_number = int(episode.group(1)) if episode else 0
            else:
                name = path.stem[:episode.start()].strip(" ._-") or path.parent.name
                root = path.parent / name
                season_number = int(episode.group(1))
            identity = "series:" + hashlib.sha256(str(root).casefold().encode()).hexdigest()[:24]
            if identity not in groups:
                groups[identity] = {"title": {"id": identity, "name": name, "path": str(root),
                    "folder": str(root.parent), "kind": "series", "extension": ".series", "bytes": 0,
                    "virtualSeries": not bool(season) and tv_folder is None}, "episodes": []}
            group = groups[identity]
            group["title"]["bytes"] += item["bytes"]
            group["episodes"].append({**item, "series_title": name, "series": season_number,
                                       "episodeNumber": int(episode.group(2)) if episode else None})
        for group in groups.values():
            group["title"].update(episode_count=len({(i["series"], i.get("episodeNumber") if i.get("episodeNumber") is not None else i["id"]) for i in group["episodes"]}), season_count=len({i["series"] for i in group["episodes"]}))
            titles.append(group["title"])
        return titles, {identity: sorted(group["episodes"], key=lambda i: (i["series"], i.get("episodeNumber") or 0, i["name"]))
                        for identity, group in groups.items()}

    def studio_cloud_item(self, identity):
        with self.studio_cloud_lock:
            item = next((dict(i) for i in self.studio_cloud_files if i["id"] == identity), None)
            if not item:
                raise ValueError("That file is no longer in the iCloud catalogue. Refresh and try again.")
            _, groups = self._studio_cloud_titles(self.studio_cloud_files)
            episode = next((entry for episodes in groups.values() for entry in episodes if entry["id"] == identity), None)
            if episode:
                item.update(series=episode["series"], series_title=episode["series_title"], episodeNumber=episode["episodeNumber"])
            stem = str(PurePosixPath(item["path"]).with_suffix(""))
            item["subtitles"] = [{"path": i["path"], "bytes": i["bytes"]} for i in self.studio_cloud_files
                                 if i["extension"] in {".srt", ".vtt", ".ass"}
                                 and (i["path"].startswith(stem + "."))]
        if self._studio_media_file(item):
            title = self.studio_cloud_title_for_file(identity)
            item["metadata"] = title.get("metadata")
            item["match_status"] = title.get("match_status", "pending")
        return item

    def studio_cloud_confirm(self, payload):
        path = PurePosixPath(str(payload.get("path", "")))
        if payload.get("verifyId"):
            with self.studio_cloud_lock:
                frozen = next((dict(value) for value in self.studio_cloud_files if value["id"] == payload["verifyId"]), None)
            if not frozen or any(frozen.get(key, "") != payload.get(key, "") for key in ("bytes", "modified", "remoteId")):
                return {"confirmed": False}
            try:
                checked = self._studio_rclone(["lsjson", "mabeltv_icloud:Media/" + frozen["path"], "--stat", "--no-mimetype"], timeout=90)
            except ValueError:
                return {"confirmed": False}
            return {"confirmed": not checked.get("IsDir") and checked.get("ID") == frozen["remoteId"] and checked.get("Size") == frozen["bytes"] and checked.get("ModTime", "") == frozen.get("modified", "")}
        if path.suffix.lower() not in VIDEO:
            raise ValueError("Only video copies are saved to iCloud")
        if not path.parts or path.is_absolute() or ".." in path.parts or any(part.startswith('.') for part in path.parts) or not (
            str(path).startswith("MabelTV Studio/") or path.parts[0] in {"Films", "TV", "Kids"} and path.suffix.lower() in VIDEO):
            raise ValueError("Choose a Studio iCloud destination")
        group, variants = str(payload.get("archiveGroup", "")), payload.get("variants", [])
        if group and not re.fullmatch(r"[a-f0-9]{32}", group) or not isinstance(variants, list) or len(variants) > 2 or any(not isinstance(role, str) or role not in {"original", "optimised"} for role in variants):
            raise ValueError("Choose a valid Studio archive copy")
        if payload.get("reserve") is True:
            publication = str(payload.get("publicationJob", ""))
            asset = str(payload.get("archiveAsset", ""))
            job = next((value for value in self.state_database.studio_records("job") if value["id"] == publication), None)
            if not job or job["status"] != "active" or not payload.get("claim") or job.get("claim") != payload["claim"]:
                raise ValueError("This transfer needs its current Studio claim")
            if not group or not variants or not re.fullmatch(r"[a-f0-9]{32}:(?:original|optimised|original\+optimised)", asset) or type(payload.get("bytes")) is not int or not 0 < payload["bytes"] <= 4 * 1024 ** 4:
                raise ValueError("Choose a valid archive reservation")
            identity = hashlib.sha256((publication + asset).encode()).hexdigest()[:32]
            self.state_database.studio_add("archiveintent", {"id": identity, "publicationJob": publication,
                "archiveAsset": asset, "archiveGroup": group, "variants": variants, "path": str(path),
                "bytes": payload["bytes"], "title": str(payload.get("title", ""))[:200],
                "match": self.studio_match(payload.get("match")), "status": "pending", "updated": time.time()})
            return {"reserved": True}
        if group and re.fullmatch(r"[a-f0-9]{32}", group) and isinstance(variants, list) and variants:
            with self.studio_cloud_lock:
                current_files = {value["id"]: dict(value) for value in self.studio_cloud_files}
            for record in self.state_database.studio_cloud_metadata_records().values():
                current = current_files.get(record["id"])
                if current and record.get("archiveGroup") == group and (not payload.get("archiveAsset") or record.get("archiveAsset") == payload["archiveAsset"]) and set(variants) <= set(record.get("variants", [])) and current["bytes"] == payload.get("bytes"):
                    version = [current["id"], current["bytes"], current.get("modified", ""), current.get("remoteId", "")]
                    if version in record.get("files", []):
                        try:
                            checked = self._studio_rclone(["lsjson", "mabeltv_icloud:Media/" + current["path"], "--stat", "--no-mimetype"], timeout=90)
                        except ValueError:
                            continue
                        if checked.get("ID") == current["remoteId"] and checked.get("Size") == current["bytes"] and checked.get("ModTime", "") == current.get("modified", ""):
                            if payload.get("lookupOnly") is not True:
                                self.studio_cloud_archive_metadata(current, payload)
                            return {"confirmed": True, "id": current["id"], "path": current["path"], "modified": current.get("modified", ""), "remoteId": current["remoteId"]}
        if payload.get("lookupOnly") is True:
            return {"confirmed": False}
        try:
            item = self._studio_rclone(["lsjson", "mabeltv_icloud:Media/" + str(path), "--stat", "--no-mimetype"], timeout=90)
        except ValueError:
            return {"confirmed": False}
        if item.get("IsDir") or int(item.get("Size", -1)) != int(payload.get("bytes", -2)):
            return {"confirmed": False}
        if not item.get("ID"):
            return {"confirmed": True}
        entry = {"id": hashlib.sha256(str(item["ID"]).encode()).hexdigest()[:24],
                 "path": str(path), "name": path.name, "folder": str(path.parent),
                 "bytes": int(item["Size"]), "modified": str(item.get("ModTime", "")),
                 "remoteId": str(item["ID"]), "extension": path.suffix.lower(), "kind": "video"}
        with self.studio_cloud_lock:
            self.studio_cloud_files = [value for value in self.studio_cloud_files if value["id"] != entry["id"]] + [entry]
            temporary = self.studio_cache / "icloud-confirm.tmp"
            temporary.write_text(json.dumps({"files": self.studio_cloud_files, "checked": self.studio_cloud_checked}), encoding="utf-8")
            temporary.replace(self.studio_cache / "icloud-catalogue.json")
        self.studio_cloud_archive_metadata(entry, payload)
        return {"confirmed": True, "id": entry["id"], "path": str(path), "modified": entry["modified"], "remoteId": entry["remoteId"]}

    def studio_cloud_auth(self, payload):
        with self.studio_auth_lock:
            current = self.studio_cloud_conversation
            if payload.get("action") == "cancel":
                if current and current.id == payload.get("id"):
                    current.close()
                    self.studio_cloud_conversation = None
                return {"cancelled": True}
            if payload.get("action") == "start":
                if current:
                    current.close()
                current = ICloudConversation(self.studio_secrets / "pending", self.studio_cloud_config)
                self.studio_cloud_conversation = current
            if not current or current.id != payload.get("id", current.id if payload.get("action") == "start" else ""):
                raise ValueError("Start a new iCloud connection")
            result = current.advance(str(payload.get("answer", "")))
            if result["complete"]:
                # Prove the pending account before replacing the working credentials.
                self._studio_rclone(["lsjson", "mabeltv_icloud:", "--max-depth", "1"], current.config, timeout=90)
                target = self.studio_secrets / "rclone.new"
                shutil.copyfile(current.config, target)
                os.chmod(target, 0o600)
                current.close()
                self.studio_cloud_conversation = None
                os.replace(target, self.studio_cloud_config)
                self.studio_cloud_wake.set()
            return result
