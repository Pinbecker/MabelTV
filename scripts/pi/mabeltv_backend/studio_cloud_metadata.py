"""Film/TV cloud projections and durable links to the shared title metadata owner."""
from __future__ import annotations

import hashlib
import json
from pathlib import PurePosixPath
import re
import time
import unicodedata


class StudioCloudMetadataMixin:
    @staticmethod
    def _studio_collection_keys(item, groups):
        members = [version for value in item.get("versions", [item])
                   for version in groups.get(value["id"], [value])]
        metadata = item.get("metadata") or {}
        keys = ["file:" + member["id"] for member in members]
        if metadata.get("tmdb_id"):
            keys.insert(0, f"title:{metadata['media_type']}:{metadata['tmdb_id']}")
        return keys

    def _studio_collection_catalogue(self, titles, groups):
        assignments = {item["key"]: item["collection"] for item in self.state_database.studio_records("cloudmembership")}
        names = {item["name"] for item in self.state_database.studio_records("cloudcollection")}
        for item in titles:
            parts = list(PurePosixPath(item.get("folder", "")).parts)
            while parts and parts[0].casefold() in {"films", "tv", "kids", "children", "childrens"}:
                parts.pop(0)
            inherited = parts[0] if parts else ""
            keys = self._studio_collection_keys(item, groups)
            item["collection"] = next((assignments[key] for key in keys if key in assignments), inherited)
            if item["collection"]:
                names.add(item["collection"])
        return sorted(names, key=str.casefold)

    def studio_cloud_collection(self, payload):
        identities = payload.get("ids")
        if not isinstance(identities, list) or not 1 <= len(identities) <= 100 or any(not isinstance(value, str) for value in identities):
            raise ValueError("Choose between 1 and 100 iCloud titles")
        name = payload.get("collection", "")
        if not isinstance(name, str) or len(name) > 80 or any(ord(c) < 32 or c in '/\\' for c in name):
            raise ValueError("Use a collection name of up to 80 characters")
        name = name.strip()
        if name in {".", ".."} or payload.get("create") is True and not name:
            raise ValueError("Enter a collection name")
        titles, groups = self.studio_cloud_media_titles()
        titles = self._studio_cloud_merge_versions(titles)
        names = self._studio_collection_catalogue(titles, groups)
        existing = next((value for value in names if value.casefold() == name.casefold()), None)
        create = payload.get("create") is True
        if create and existing:
            raise ValueError("That iCloud collection already exists")
        if name and not create and existing is None:
            raise ValueError("Choose an existing iCloud collection")
        keys = set()
        for identity in identities:
            item = next((value for value in titles if any(version["id"] == identity for version in value.get("versions", [value]))), None)
            if not item:
                raise ValueError("That title is no longer in iCloud. Refresh before moving it.")
            keys.update(self._studio_collection_keys(item, groups))
        collection = self.state_database.studio_assign_cloud_collection(sorted(keys), existing or name, create)
        return {"ok": True, "collection": collection}

    @staticmethod
    def _studio_media_file(item):
        root = PurePosixPath(item["path"]).parts[0].casefold()
        return item.get("kind") == "video" and root not in {
            "audiobooks", "audio books", "family videos", "podcasts & radio", "podcasts", "radio"}

    @staticmethod
    def _studio_title_guess(item):
        name = item.get("title_hint") or (item["name"] if item["kind"] == "series" else PurePosixPath(item["name"]).stem)
        name = re.sub(r"[._]+", " ", name).strip()
        years = list(re.finditer(r"\b(?:19|20)\d{2}\b", name))
        year = years[-1].group() if years and years[-1].start() > 0 else ""
        if year:
            name = name[:years[-1].start()].strip(" ()[]-_")
        name = re.split(r"(?i)\b(?:480p|720p|1080p|2160p|bluray|web[ -]?dl|x26[45]|hevc)\b", name)[0].strip(" ()[]-_")
        return name or item["name"], year

    @staticmethod
    def _studio_title_fingerprint(item):
        value = [item["id"]] if item["kind"] == "series" else [item["id"], item["path"], item["bytes"], item.get("modified")]
        return hashlib.sha256(json.dumps(value).encode()).hexdigest()

    def _studio_title_versions(self, item):
        with self.studio_cloud_lock:
            files = [dict(value) for value in self.studio_cloud_files if self._studio_media_file(value)]
        _, groups = self._studio_cloud_titles(files)
        members = groups.get(item["id"], [next((value for value in files if value["id"] == item["id"]), item)])
        return sorted([[value["id"], value["bytes"], value.get("modified", ""), value.get("remoteId", "")] for value in members])

    def studio_cloud_media_titles(self):
        with self.studio_cloud_lock:
            files = [dict(item) for item in self.studio_cloud_files if self._studio_media_file(item)]
        titles, groups = self._studio_cloud_titles(files)
        records = self.state_database.studio_cloud_metadata_records()
        for item in titles:
            title, year = self._studio_title_guess(item)
            fingerprint = self._studio_title_fingerprint(item)
            record = records.get(item["id"], {})
            if record.get("fingerprint") != fingerprint:
                record = {}
                # A checked cloud-side rename preserves file identity and content.
                # Reuse its canonical link, including an explicit owner correction.
                members = groups.get(item["id"], [item])
                versions = [[value["id"], value["bytes"], value.get("modified", ""), value.get("remoteId", "")] for value in members]
                aliases = [value for value in records.values() if value.get("metadata") and value.get("files")
                           and all(version in value["files"] for version in versions)
                           and (item["kind"] != "series" or value.get("media_type") == "tv")]
                confirmed = [value for value in aliases if value.get("confirmed")]
                if confirmed:
                    record = max(confirmed, key=lambda value: value.get("updated", 0))
                elif len({(value.get("media_type"), value.get("tmdb_id")) for value in aliases}) == 1:
                    record = aliases[0]
            metadata = record.get("metadata") or {}
            if not metadata and record.get("archiveGroup"):
                aliases = [value for value in records.values() if value.get("archiveGroup") == record["archiveGroup"] and value.get("metadata")]
                if len({(value["media_type"], value["tmdb_id"]) for value in aliases}) == 1:
                    metadata = aliases[0]["metadata"]
            media_type = metadata.get("media_type") or ("tv" if item["kind"] == "series" else "movie")
            parts = PurePosixPath(item["path"]).parts
            kids = any(part.casefold() in {"kids", "children", "childrens"} for part in parts[:-1])
            item.update(title=metadata.get("title") or record.get("titleHint") or title, year=metadata.get("year") or year,
                media_type=media_type, category="kids" if kids else "tv" if media_type == "tv" else "films",
                metadata=metadata or None, metadata_confirmed=record.get("confirmed", False), match_status=record.get("status", "pending"),
                fingerprint=fingerprint, needs_metadata=not metadata and (not record or record.get("status") in {"pending", "unavailable"}),
                variants=record.get("variants", []), archiveGroup=record.get("archiveGroup", ""), title_hint=record.get("titleHint", ""))
        return titles, groups

    def studio_cloud_archive_metadata(self, item, payload):
        variants = payload.get("variants", [])
        if not isinstance(variants, list) or any(value not in {"original", "optimised"} for value in variants):
            raise ValueError("Choose the archived copy type")
        group = str(payload.get("archiveGroup", ""))
        if group and not re.fullmatch(r"[a-f0-9]{32}", group):
            raise ValueError("Choose a Studio archive identity")
        record = {"id": item["id"], "fingerprint": self._studio_title_fingerprint(item),
            "files": [[item["id"], item["bytes"], item["modified"], item["remoteId"]]], "status": "pending",
            "variants": variants, "archiveGroup": group, "titleHint": str(payload.get("title", ""))[:200], "updated": time.time()}
        old = self.state_database.studio_cloud_metadata_records().get(item["id"], {})
        profile = payload.get("encodingProfile")
        source_size = payload.get("encodingSourceBytes")
        if profile in {"balanced", "compact", "smallest"} and type(source_size) is int and item["bytes"] <= source_size <= 2**53:
            record.update(encodingProfile=profile, encodingSourceBytes=source_size)
        elif old.get("fingerprint") == record["fingerprint"]:
            for key in ("encodingProfile", "encodingSourceBytes"):
                if key in old:
                    record[key] = old[key]
        publication_job = str(payload.get("publicationJob", ""))
        asset = str(payload.get("archiveAsset", ""))
        if asset:
            if not re.fullmatch(r"[a-f0-9]{32}:(?:original|optimised|original\+optimised)", asset):
                raise ValueError("Choose a Studio archive asset")
            record["archiveAsset"] = asset
        if publication_job:
            if not re.fullmatch(r"[a-f0-9]{32}", publication_job):
                raise ValueError("Choose a Studio publication")
            record["publicationJob"] = publication_job
        match = self.studio_match(payload.get("match"))
        metadata = None
        if match:
            details = self.my_tv_cached_tmdb_request(f"{match['media_type']}/{match['tmdb_id']}", {"language": "en-GB"})
            metadata = {**match, "title": str(details.get("title") or details.get("name") or match["title"]),
                        "year": str(details.get("release_date") or details.get("first_air_date") or match.get("year") or "")[:4] or None,
                        "poster_path": details.get("poster_path"), "overview": details.get("overview"), "runtime": details.get("runtime")}
            record["status"] = "matched"
        self.state_database.studio_save_cloud_metadata(record, metadata, automatic=True)
        publication = next((job for job in self.state_database.studio_records("job")
                            if job["id"] == publication_job), None)
        if (publication and publication["destination"]["kind"] == "icloud"
                and "collection" in publication["destination"]):
            keys = ["file:" + item["id"]]
            if metadata and metadata.get("tmdb_id"):
                keys.append(f"title:{metadata['media_type']}:{metadata['tmdb_id']}")
            self.state_database.studio_assign_cloud_collection(keys, publication["destination"]["collection"])
        for intent in self.state_database.studio_records("archiveintent"):
            if intent.get("status") == "pending" and intent.get("archiveAsset") == asset and intent.get("publicationJob") == publication_job:
                self.state_database.studio_add("archiveintent", {**intent, "status": "complete", "file": item["id"], "updated": time.time()})

    def studio_cloud_title_for_file(self, identity):
        titles, groups = self.studio_cloud_media_titles()
        for item in titles:
            if item["id"] == identity or any(episode["id"] == identity for episode in groups.get(item["id"], [])):
                return item
        raise ValueError("That film or series is no longer in iCloud. Refresh the library.")

    def studio_cloud_media_catalogue(self, query):
        titles, groups = self.studio_cloud_media_titles()
        identity = str(query.get("series", [""])[0])
        if identity:
            title = next((item for item in titles if item["id"] == identity), None)
            if not title or identity not in groups:
                raise ValueError("That series is no longer in iCloud")
            records = self.state_database.studio_cloud_metadata_records()
            episodes = [{**item, "series_title": title["title"], "titleId": identity,
                         "metadata": title["metadata"], "category": title["category"],
                         "variants": records.get(item["id"], {}).get("variants", []),
                         "archiveGroup": records.get(item["id"], {}).get("archiveGroup", "")} for item in groups[identity]]
            episodes = self._studio_cloud_merge_versions(episodes, episodes=True)
            return {"items": episodes, "total": len(episodes), "series": identity}
        search = str(query.get("q", [""])[0]).strip().casefold()[:200]
        category = str(query.get("category", [""])[0])
        if category not in {"", "films", "tv", "kids"}:
            raise ValueError("Choose Films, TV or Kids")
        display_titles = self._studio_cloud_merge_versions(titles)
        collections = self._studio_collection_catalogue(display_titles, groups)
        if category:
            present = {item["collection"] for item in display_titles if item["category"] == category}
            collections = [name for name in collections if name in present]
        collection = query.get("collection", [None])[0]
        visible = [item for item in display_titles if (not category or item["category"] == category)
                   and (collection is None or item["collection"] == collection)
                   and (not search or search in (item["title"] + " " + item["name"] + " " + item["year"]).casefold())]
        if query.get("tmdb_id"):
            tmdb_id, media_type = int(query["tmdb_id"][0]), str(query.get("media_type", [""])[0])
            if tmdb_id <= 0 or media_type not in {"movie", "tv"}:
                raise ValueError("Choose a film or TV title")
            normal = lambda value: re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", str(value).casefold().replace("&", "and")))
            title, year = str(query.get("title", [""])[0]), str(query.get("year", [""])[0])
            visible = [item for item in visible if (
                item.get("metadata") and item["metadata"].get("media_type") == media_type
                and int(item["metadata"].get("tmdb_id") or 0) == tmdb_id) or (
                not item.get("metadata") and item.get("media_type") == media_type and title
                and normal(item["title"]) == normal(title)
                and (not year or not item.get("year") or item["year"] == year))]
        order = str(query.get("sort", ["name-asc"])[0])
        if order not in {"name-asc", "name-desc", "size-desc", "size-asc", "date-desc", "date-asc"}:
            raise ValueError("Choose a library sort order")
        size = lambda item: sum(version["bytes"] for version in item.get("versions", [item]))
        name = lambda item: item["title"].casefold()
        if order.startswith("size-"):
            visible.sort(key=lambda item: ((-1 if order == "size-desc" else 1) * size(item), name(item)))
        elif order.startswith("date-"):
            visible.sort(key=lambda item: (not bool(item.get("year")),
                (-1 if order == "date-desc" else 1) * int(item.get("year") or 0), name(item)))
        else:
            visible.sort(key=name, reverse=order == "name-desc")
        offset = max(0, int(query.get("offset", ["0"])[0]))
        return {**self.studio_cloud_status(), "items": visible[offset:offset + 100], "offset": offset, "collections": collections,
            "total": len(visible), "titleCount": len(display_titles), "unmatched": sum(not item["metadata"] for item in display_titles),
            "needsMetadata": [item["id"] for item in titles if item["needs_metadata"]][:500],
            "unmatchedIds": [item["id"] for item in titles if not item["metadata"]][:500]}

    @staticmethod
    def _studio_cloud_merge_versions(items, episodes=False):
        groups = {}
        for item in items:
            metadata = item.get("metadata") or {}
            key = item["id"]
            if episodes and item.get("episodeNumber") is not None:
                key = (item.get("series"), item["episodeNumber"])
            elif not episodes and item["kind"] != "series":
                key = (item.get("category"), metadata.get("media_type"), metadata.get("tmdb_id")) if metadata.get("tmdb_id") else item.get("archiveGroup") or key
            groups.setdefault(key, []).append(item)
        result = []
        for versions in groups.values():
            versions.sort(key=lambda item: (bool(item.get("variants")) and "original" not in item["variants"], -item["bytes"], item["id"]))
            item = dict(versions[0])
            if len(versions) > 1:
                item["versions"] = [dict(version) for version in versions]
            result.append(item)
        return result

    def studio_cloud_match(self, payload):
        item = self.studio_cloud_title_for_file(str(payload.get("id", "")))
        automatic = payload.get("automatic") is True
        old = self.state_database.studio_cloud_metadata_records().get(item["id"], {})
        if automatic and item.get("metadata_confirmed"):
            return {"item": item}
        if automatic and old.get("fingerprint") == item["fingerprint"] and (old.get("confirmed") or not payload.get("retry")):
            return {"item": item}
        match = payload.get("match")
        title, year = self._studio_title_guess(item)
        record = {"id": item["id"], "fingerprint": item["fingerprint"], "query": title,
                  "updated": time.time(), "confirmed": not automatic, "status": "unmatched",
                  "files": self._studio_title_versions(item)}
        try:
            if automatic:
                response = self.my_tv_cached_tmdb_request("search/multi", {"query": title[:120], "include_my_tv": "false", "language": "en-GB", "page": 1})
                normal = lambda text: re.sub(r"[^a-z0-9]", "", str(text).casefold())
                choices = [candidate for candidate in response.get("results", []) if candidate.get("media_type") in {"movie", "tv"}
                    and normal(candidate.get("title") or candidate.get("name")) == normal(title)
                    and (not year or str(candidate.get("release_date") or candidate.get("first_air_date") or "").startswith(year))
                    and (item["kind"] != "series" or candidate.get("media_type") == "tv")]
                preferred = [candidate for candidate in choices if candidate["media_type"] == item["media_type"]]
                choices = preferred or choices
                match = {"media_type": choices[0]["media_type"], "tmdb_id": choices[0]["id"]} if len(choices) == 1 else None
            metadata = None
            if match:
                match = self.studio_match(match)
                if item["kind"] == "series" and match["media_type"] != "tv":
                    raise ValueError("Choose TV series metadata for these episodes")
                details = self.my_tv_cached_tmdb_request(f"{match['media_type']}/{match['tmdb_id']}", {"language": "en-GB"})
                metadata = {**match, "title": str(details.get("title") or details.get("name") or title),
                    "year": str(details.get("release_date") or details.get("first_air_date") or "")[:4] or None,
                    "poster_path": details.get("poster_path") or None, "overview": details.get("overview") or None,
                    "runtime": details.get("runtime") or None}
                record["status"] = "matched"
            elif not automatic:
                raise ValueError("Choose the matching film or TV series")
        except (ValueError, OSError):
            if not automatic:
                raise
            record["status"] = "unavailable"
            metadata = None
        self.state_database.studio_save_cloud_metadata(record, metadata, automatic)
        return {"item": self.studio_cloud_title_for_file(item["id"])}
