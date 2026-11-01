"""Quiet, bounded film/TV organisation using canonical catalogue metadata."""
from __future__ import annotations

from pathlib import PurePosixPath
import hashlib
import json
import re
import time

from .studio_organiser_model import MODEL, title_hint, choose_title
from .studio_filing_policy import POLICY_VERSION, collection_members


class StudioOrganiserMixin:
    @staticmethod
    def _studio_organiser_match_key(title):
        metadata = title.get("metadata") or {}
        return f"{metadata.get('media_type', '')}:{metadata.get('tmdb_id', '')}"

    def _studio_organiser_stamp(self, title, groups=None, titles=None, records=None):
        if groups is None:
            titles, groups = self.studio_cloud_media_titles()
        members = groups.get(title["id"], [title])
        value = [title["fingerprint"], sorted([[item["id"], item["path"], item["bytes"],
                 item.get("modified", ""), item.get("remoteId", "")] for item in members])]
        if records is None:
            records = self.state_database.studio_records("organiser")
        previous = next((item for item in records if item["id"] == title["id"]), {})
        collection = previous.get("collection") or {}
        if collection.get("matchKey") == self._studio_organiser_match_key(title):
            if titles is None:
                titles, _ = self.studio_cloud_media_titles()
            value.append(collection_members(title, collection, titles, records))
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

    def _studio_organiser_cached(self, kind, key, context, candidates=None):
        # Only meaningful inputs, model and prompt version enter this key.
        # Heartbeats, refresh times, viewing state and other titles never do.
        candidates = sorted(candidates or [], key=lambda item: (item["media_type"], item["tmdb_id"]))
        signature = hashlib.sha256(json.dumps([MODEL, 1, kind, context, candidates], sort_keys=True).encode()).hexdigest()
        previous = next((item for item in self.state_database.studio_records("aicache") if item["id"] == signature), None)
        if previous is not None:
            result = previous["result"]
        else:
            audit = self.state_database.studio_ai_usage
            selected = title_hint(key, context, audit=audit) if kind == "query" else choose_title(key, context, candidates, audit=audit)
            result = selected if kind == "query" else ({name: selected[name] for name in ("media_type", "tmdb_id")} if selected else None)
            self.state_database.studio_memo("aicache", {"id": signature, "kind": kind, "result": result, "status": "complete", "updated": time.time()})
        if kind == "query":
            return result
        return next((item for item in candidates if result and item["tmdb_id"] == result["tmdb_id"] and item["media_type"] == result["media_type"]), None)

    def studio_organiser_status(self):
        status = next(iter(self.state_database.studio_records("organiserstatus")), None)
        if status and (not (self.database_path.parent / "secrets/openai/api-key").is_file() or
                       status.get("status") == "active" and time.time() - status.get("updated", 0) > 180):
            return {**status, "status": "cancelled", "message": "Organiser stopped"}
        return status

    def _studio_organiser_progress(self, **fields):
        previous = self.studio_organiser_status()
        if previous and all(previous.get(key) == value for key, value in fields.items()):
            return
        record = {"id": "current", "title": "Organising iCloud", "created": time.time(),
                  "updated": time.time(), "percent": 0, **fields}
        self.state_database.studio_add("organiserstatus", record)

    def studio_organiser_step(self):
        now = time.time()
        key_path = self.database_path.parent / "secrets" / "openai" / "api-key"
        if not key_path.is_file() or now < getattr(self, "studio_organiser_after", 0) or not self.studio_cloud_checked or self.studio_cloud_error:
            return
        self.studio_organiser_after = now + 15
        title = None
        try:
            # Resume a durable interrupted move before planning another title.
            pending = next((op for op in self.state_database.studio_records("filing")
                            if op["status"] in {"active", "failed"} and op.get("retryAfter", 0) <= now), None)
            if pending:
                self._studio_organiser_progress(status="active", message="Filing " + pending["title"], percent=60)
                try:
                    if not self.studio_filing_resume(pending):
                        return
                except (ValueError, OSError) as error:
                    pending.update(status="failed", error=str(error), retryAfter=now + 86400, updated=now)
                    self.state_database.studio_add("filing", pending)
                    raise
            titles, groups = self.studio_cloud_media_titles()
            done = {item["id"]: item for item in self.state_database.studio_records("organiser")}
            jobs = self.state_database.studio_records("job")
            deletions = self.state_database.studio_records("cloudop")
            # Finish opaque/new Studio downloads first, then backfill the library.
            for candidate in sorted(titles, key=lambda item: (not item["path"].startswith("MabelTV Studio/"), bool(item.get("metadata")), item["title"].casefold())):
                previous = done.get(candidate["id"], {})
                stamp = self._studio_organiser_stamp(candidate, groups, titles, list(done.values()))
                if previous.get("fingerprint") == stamp and previous.get("matchKey") == self._studio_organiser_match_key(candidate) and (
                    previous.get("status") == "unmatched" or
                    previous.get("status") == "complete" and previous.get("policy") == POLICY_VERSION or
                    previous.get("retryAfter", 0) > now):
                    continue
                members = groups.get(candidate["id"], [candidate])
                identities = {item["id"] for item in members}
                if any(job["status"] in {"queued", "active", "paused"} and
                       (job["source"].get("id") in identities or any(job["id"] in PurePosixPath(item["path"]).parts for item in members)) for job in jobs):
                    continue
                if any(op["status"] in {"queued", "active"} and any(frozen["path"] == "Media/" + item["path"]
                    for frozen in op["items"] for item in members) for op in deletions):
                    continue
                title = candidate
                break
            if title is None:
                self._studio_organiser_progress(status="complete", message="Library check complete", percent=100)
                return
            self._studio_organiser_progress(status="active", message="Matching " + title["title"], percent=10)
            key = key_path.read_text(encoding="utf-8").strip()
            if not key.startswith("sk-"):
                raise ValueError("The title organiser needs its private API connection restored.")
            metadata, details = self._studio_organiser_resolve(title, jobs, key)
            corrected, collection = False, None
            if metadata:
                self._studio_organiser_link(title, metadata)
                title = self.studio_cloud_title_for_file(title["id"])
                if self._studio_organiser_match_key(title) != f"{metadata['media_type']}:{metadata['tmdb_id']}":
                    metadata = title["metadata"]
                    details = self.my_tv_cached_tmdb_request(f"{metadata['media_type']}/{metadata['tmdb_id']}",
                        {"language": "en-GB", "append_to_response": "credits,release_dates"})
                filed_match = self._studio_organiser_match_key(title)
                details_collection = details.get("belongs_to_collection") if metadata["media_type"] == "movie" else None
                if isinstance(details_collection, dict) and type(details_collection.get("id")) is int:
                    collection = {"id": details_collection["id"], "name": details_collection.get("name", ""), "matchKey": filed_match}
                self.state_database.studio_memo("organiser", {"id": title["id"], "status": "changed",
                    "collection": collection, "updated": now})
                self._studio_organiser_progress(status="active", message="Filing " + title["title"], percent=60)
                if not self.studio_filing(title, details):
                    return
                # Bind the new series-group identity immediately, before new episodes
                # arrive, then memoise the final layout rather than its old paths.
                title = self.studio_cloud_title_for_file(members[0]["id"])
                metadata = title.get("metadata") or metadata
                corrected = self._studio_organiser_match_key(title) != filed_match
                self._studio_organiser_link(title, metadata)
            self.state_database.studio_memo("organiser", {"id": title["id"], "fingerprint": self._studio_organiser_stamp(title),
                "matchKey": self._studio_organiser_match_key(title), "policy": POLICY_VERSION, "collection": collection,
                "status": "changed" if corrected else "complete" if metadata else "unmatched", "updated": now,
                "retryAfter": 0})
            self._studio_organiser_progress(status="complete", message="Library updated", percent=100)
        except (ValueError, OSError, KeyError, TypeError) as error:
            # Never forward raw provider/credential errors to the portal.
            message = str(error) if isinstance(error, ValueError) else "The organiser will recheck this title later."
            self.studio_organiser_after = now + (3600 if "API allowance" in message or "could not connect" in message else 60)
            self._studio_organiser_progress(status="failed", message=message, error=message)
            if title:
                self.state_database.studio_memo("organiser", {"id": title["id"], "fingerprint": self._studio_organiser_stamp(title),
                    "matchKey": self._studio_organiser_match_key(title),
                    "status": "failed", "updated": now, "retryAfter": now + 86400})

    def _studio_organiser_resolve(self, title, jobs, key):
        match = title.get("metadata")
        guess, year = self._studio_title_guess(title)
        known = next((job for job in jobs if job.get("savedCloudPath") == title["path"] or
                      job["id"] in PurePosixPath(title["path"]).parts), None)
        if known and not match:
            guess = known["title"]
            match = known.get("matchedTitle") or known.get("match")
        context = {"filename": title["name"][:200], "folder": str(PurePosixPath(title["path"]).parent)[-300:],
                   "programme": known["title"] if known else "", "kind": title["kind"]}
        if not match:
            candidates = self._studio_organiser_candidates(guess, title)
            normal = lambda value: re.sub(r"[^a-z0-9]", "", str(value).casefold())
            exact = [item for item in candidates if normal(item["title"]) == normal(guess)
                     and (not year or item["year"] == year)]
            match = exact[0] if len(exact) == 1 else None
            if not match:
                hint = self._studio_organiser_cached("query", key, context)
                phrase = str(hint.get("title", "")).strip()[:120]
                if not phrase:
                    return None, {}
                if normal(phrase) != normal(guess):
                    candidates = self._studio_organiser_candidates(phrase, title)
                if not candidates:
                    return None, {}
                match = self._studio_organiser_cached("selection", key, context, candidates)
                if match and year and match["year"] != year:
                    match = None
        if not match:
            return None, {}
        match = self.studio_match(match)
        details = self.my_tv_cached_tmdb_request(f"{match['media_type']}/{match['tmdb_id']}",
            {"language": "en-GB", "append_to_response": "credits,release_dates"})
        if not isinstance(details, dict) or not (details.get("title") or details.get("name")):
            raise ValueError("The catalogue could not confirm this title. It will be checked later.")
        return {**match, "title": str(details.get("title") or details.get("name")),
            "year": str(details.get("release_date") or details.get("first_air_date") or "")[:4] or None,
            "poster_path": details.get("poster_path"), "overview": details.get("overview"),
            "runtime": details.get("runtime")}, details

    def _studio_organiser_candidates(self, phrase, title):
        if len(phrase.strip()) < 2:
            return []
        result = self.my_tv_cached_tmdb_request("search/multi", {"query": phrase[:120], "language": "en-GB", "page": 1})
        return [{"tmdb_id": item["id"], "media_type": item["media_type"],
                 "title": str(item.get("title") or item.get("name") or ""),
                 "year": str(item.get("release_date") or item.get("first_air_date") or "")[:4],
                 "overview": str(item.get("overview") or "")[:350]}
                for item in result.get("results", []) if item.get("media_type") in {"movie", "tv"}
                and type(item.get("id")) is int and item["id"] > 0
                and (title["kind"] != "series" or item["media_type"] == "tv")][:20]

    def _studio_organiser_link(self, title, metadata):
        record = {"id": title["id"], "fingerprint": title["fingerprint"], "status": "matched",
                  "updated": time.time(), "confirmed": title.get("metadata_confirmed", False),
                  "files": self._studio_title_versions(title)}
        self.state_database.studio_save_cloud_metadata(record, metadata, automatic=True)
