"""Recoverable cloud-side media filing; no video hydration, overwrite or deletion."""
from __future__ import annotations

import hashlib
import json
from pathlib import PurePosixPath
from .subtitle_files import belongs_to_video
import re
import time
from .studio_filing_policy import POLICY_VERSION, collection_members, component, movie_folder, series_target


def same_version(current, frozen):
    return bool(current and not current.get("IsDir") and frozen.get("remoteId")
        and str(current.get("ID", "")) == frozen["remoteId"]
        and int(current.get("Size", -1)) == frozen["bytes"]
        and (not frozen.get("modified") or str(current.get("ModTime", "")) == frozen["modified"]))


class StudioCloudFilingMixin:
    def studio_filing_plan(self, title, details):
        metadata = title["metadata"]
        name = component(metadata["title"])
        year = str(metadata.get("year") or "")
        name += " (" + year + ")" if re.fullmatch(r"(?:19|20)\d{2}", year) else ""
        with self.studio_cloud_lock:
            files = [dict(item) for item in self.studio_cloud_files]
        _, groups = self._studio_cloud_titles([item for item in files if self._studio_media_file(item)])
        members = groups.get(title["id"], [next((i for i in files if i["id"] == title["id"]), title)])
        origins = {}
        for operation in sorted(self.state_database.studio_records("filing"), key=lambda value: value["created"]):
            for entry in operation["items"]:
                origins.setdefault(entry["id"], entry["source"])
        kind = "TV" if metadata["media_type"] == "tv" else "Films"
        titles, _ = self.studio_cloud_media_titles()
        collection_size = len(collection_members(title, details.get("belongs_to_collection"), titles,
                                                 self.state_database.studio_records("organiser"))) if kind == "Films" else 0
        plan = []
        records = self.state_database.studio_cloud_metadata_records()
        for member in members:
            source = PurePosixPath(member["path"])
            if source.is_absolute() or ".." in source.parts or not member.get("remoteId"):
                raise ValueError("iCloud must confirm a stable file identity before organising this title.")
            if kind == "TV":
                season, episode = member.get("series"), member.get("episodeNumber")
                if type(season) is not int or type(episode) is not int:
                    # Keep ambiguous episode numbering intact for manual correction.
                    continue
                target = series_target(title, member, origins.get(member["id"], member["path"]), details)
            else:
                parent = movie_folder(title, details, origins.get(member["id"], member["path"]), collection_size)
                original = PurePosixPath(origins.get(member["id"], member["path"]))
                opaque = re.fullmatch(r"[bmp][a-z0-9]{7}|[a-f0-9]{24,32}", original.stem, re.I)
                filename = name + source.suffix.lower() if opaque else original.name
                record = records.get(member["id"], {})
                asset = str(record.get("archiveAsset", "")).split(":")[0]
                managed_name = re.fullmatch(r"[a-f0-9]{32}", asset) and re.search(
                    r" - " + re.escape(asset[:8]) + r"(?: \[Optimised\])?$", original.stem)
                if record.get("publicationJob") and managed_name:
                    # Only Studio-owned new copies are canonicalised. Preserve
                    # the separate organiser's existing imported filenames.
                    siblings = any(other != member["id"] and any(value_file["id"] == other for value_file in files) and value.get("archiveGroup") == record.get("archiveGroup")
                                   for other, value in records.items()) if record.get("archiveGroup") else False
                    marker = " [Optimised]" if siblings and record.get("variants") == ["optimised"] else ""
                    filename = name + marker + source.suffix.lower()
                if parent == PurePosixPath("Films/MCU") and not re.match(r"^\d+\s*[-.]", filename):
                    ordinal = next((re.match(r"^(\d+)\s*[-.]", part).group(1) for part in original.parts
                                    if re.match(r"^\d+\s*[-.]", part)), None)
                    if ordinal:
                        filename = ordinal.zfill(2) + " - " + filename
                target = parent / filename
                if any(item["id"] != member["id"] and item["path"].casefold() == str(target).casefold() for item in files):
                    target = parent / (target.stem + " [" + member["id"][:8] + "]" + target.suffix)
            parent, stem = target.parent, target.stem
            related = [member] + [item for item in files
                if item.get("extension") in {".srt", ".vtt", ".ass", ".ssa", ".nfo", ".mks"}
                and belongs_to_video(member["path"], item["path"])
                and (item["path"].startswith(member["path"] + ".") or not any(other["id"] != member["id"]
                     and self._studio_media_file(other) and PurePosixPath(other["path"]).with_suffix("") == source.with_suffix("") for other in files))]
            for item in related:
                destination = target if item["id"] == member["id"] else parent / (stem + item["path"][len(str(source.with_suffix(""))):])
                if str(destination) != item["path"]:
                    plan.append({"id": item["id"], "source": item["path"], "target": str(destination),
                        "bytes": item["bytes"], "modified": item.get("modified", ""), "remoteId": item.get("remoteId", "")})
        return plan

    def studio_filing_resume(self, operation):
        if operation.get("policy", 1) != POLICY_VERSION:
            operation.update(status="superseded", updated=time.time())
            self.state_database.studio_add("filing", operation)
            return True
        if not getattr(self, "studio_filing_capable", False):
            features = self._studio_rclone(["backend", "features", "mabeltv_icloud:Media"])
            if features.get("Features", {}).get("Move") is not True:
                raise ValueError("iCloud cannot organise files within the cloud. No videos were transferred.")
            self.studio_filing_capable = True
        for index, item in enumerate(operation["items"]):
            if index < operation.get("completed", 0):
                continue
            if self.studio_cloud_closed.is_set():
                return False
            source, target = "Media/" + item["source"], "Media/" + item["target"]
            current = self._studio_cloud_stat_optional(source)
            destination = self._studio_cloud_stat_optional(target)
            if destination is not None:
                if current is not None or not same_version(destination, item):
                    raise ValueError("A destination already exists. Both files were kept; check this title before retrying.")
            else:
                if not same_version(current, item):
                    raise ValueError("An iCloud file changed. Its current version was kept for a fresh match.")
                # A server-side move has no data transfer. The tiny transfer ceiling
                # prevents a provider fallback from downloading a video onto the Pi.
                self._studio_cloud_command(["moveto", "mabeltv_icloud:" + source, "mabeltv_icloud:" + target,
                    "--ignore-existing", "--disable", "Copy", "--max-transfer", "1B", "--cutoff-mode", "HARD", "--buffer-size", "0"])
                destination = self._studio_cloud_stat(target)
                if not same_version(destination, item) or self._studio_cloud_stat_optional(source) is not None:
                    raise ValueError("iCloud has not confirmed the move. The organiser will recheck before retrying.")
            self._studio_filing_catalogue(item, destination)
            operation.update(completed=index + 1, updated=time.time())
            self.state_database.studio_add("filing", operation)
            self._studio_organiser_progress(status="active", message=f"Filing {operation['title']} · {index + 1} of {len(operation['items'])} files",
                                            percent=60 + int(40 * (index + 1) / len(operation["items"])))
        operation.update(status="complete", updated=time.time(), error="")
        self.state_database.studio_add("filing", operation)
        return True

    def _studio_filing_catalogue(self, item, current):
        with self.studio_cloud_lock:
            for entry in self.studio_cloud_files:
                if entry["id"] == item["id"]:
                    target = PurePosixPath(item["target"])
                    entry.update(path=str(target), name=target.name, folder=str(target.parent),
                                 modified=str(current.get("ModTime", entry.get("modified", ""))))
            temporary = self.studio_cache / "icloud-filing.tmp"
            temporary.write_text(json.dumps({"files": self.studio_cloud_files,
                                             "checked": self.studio_cloud_checked}), encoding="utf-8")
            temporary.replace(self.studio_cache / "icloud-catalogue.json")

    def studio_filing(self, title, details):
        plan = self.studio_filing_plan(title, details)
        if not plan:
            return True
        identity = hashlib.sha256(json.dumps([POLICY_VERSION, plan], sort_keys=True).encode()).hexdigest()[:32]
        operation = next((item for item in self.state_database.studio_records("filing") if item["id"] == identity), None)
        if not operation:
            operation = {"id": identity, "title": title["title"], "items": plan,
                         "policy": POLICY_VERSION, "status": "active", "completed": 0, "created": time.time(), "updated": time.time()}
            self.state_database.studio_add("filing", operation)
        try:
            return self.studio_filing_resume(operation)
        except (ValueError, OSError) as error:
            operation.update(status="failed", error=str(error), retryAfter=time.time() + 86400, updated=time.time())
            self.state_database.studio_add("filing", operation)
            raise
