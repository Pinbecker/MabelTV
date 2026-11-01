"""Durable Studio records in the existing checked SQLite field store.

Each job/request/worker is an independent field. Claims and progress use one
BEGIN IMMEDIATE transaction; these records never replace TV settings.
"""
from __future__ import annotations

import json
import secrets
import time


PREFIX = "studio."
FINISHED = {"complete", "cancelled", "failed", "paused"}


class StudioRepositoryMixin:
    @staticmethod
    def _studio_records(db, kind):
        return [json.loads(row[0]) for row in db.execute(
            "SELECT value_json FROM application_settings WHERE key LIKE ? ORDER BY updated_at DESC",
            (PREFIX + kind + ".%",))]

    def _studio_put(self, db, kind, value):
        db.execute("INSERT INTO application_settings(key,value_json,updated_at) VALUES(?,?,?) "
                   "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                   (PREFIX + kind + "." + value["id"], json.dumps(value), time.time()))
        # Studio has independent no-store polling. Heartbeats and progress
        # must not invalidate TV settings or trigger player settings reloads.

    def studio_records(self, kind):
        db = self.connect()
        try:
            return self._studio_records(db, kind)
        finally:
            db.close()

    def studio_memo(self, kind, value):
        """Durable per-input memoisation is not completed queue history."""
        if kind not in {"organiser", "aicache"}:
            raise ValueError("Choose an organiser memo")
        with self.transaction() as db:
            self._studio_put(db, kind, value)
            if kind == "aicache":
                # Bounded, rebuildable response cache; per-title decisions remain.
                db.execute("DELETE FROM application_settings WHERE key IN "
                    "(SELECT key FROM application_settings WHERE key LIKE 'studio.aicache.%' "
                    "ORDER BY updated_at DESC LIMIT -1 OFFSET 4096)")
        return value

    def studio_ai_usage(self, value):
        month = time.strftime("%Y-%m", time.gmtime())
        with self.transaction() as db:
            current = next((item for item in self._studio_records(db, "aiusage") if item["id"] == month),
                           {"id": month, "requests": 0, "input_tokens": 0, "output_tokens": 0})
            current["requests"] += 1
            for key in ("input_tokens", "output_tokens"):
                count = value.get(key, 0)
                if type(count) is int and 0 <= count <= 1000000:
                    current[key] += count
            current.update(updated=time.time(), model=value["model"])
            self._studio_put(db, "aiusage", current)
        return current

    def studio_add(self, kind, value):
        with self.transaction() as db:
            records = self._studio_records(db, kind)
            if kind == "cloudop" and value.get("archiveJob") and value.get("status") == "queued" and value.get("completed") == 0:
                previous = next((item for item in records if item["id"] == value["id"]), None)
                if previous:
                    return previous
            if kind == "job" and sum(r["status"] not in FINISHED for r in records) >= 200:
                raise ValueError("Your Studio queue is full. Finish or cancel some items first.")
            if kind in {"request", "cloudop"} and not any(r["id"] == value["id"] for r in records) and sum(r["status"] in {"queued", "active"} for r in records) >= (20 if kind == "request" else 200):
                raise ValueError("There are too many waiting requests. Let the current work finish first.")
            self._studio_put(db, kind, value)
            # Retain bounded completed history; active work is never pruned.
            for old in records[19 if kind == "request" else 199:]:
                if old.get("status") in FINISHED or kind == "request" and old.get("updated", 0) < time.time() - 86400:
                    db.execute("DELETE FROM application_settings WHERE key=?",
                               (PREFIX + kind + "." + old["id"],))
        return value

    def studio_add_jobs(self, values):
        with self.transaction() as db:
            records = self._studio_records(db, "job")
            active = [r for r in records if r["status"] not in FINISHED or r["status"] == "paused"]
            result, pending = [], []
            for value in values:
                existing = next((r for r in active + pending if r.get("fingerprint") == value.get("fingerprint")), None)
                if existing:
                    result.append(existing)
                else:
                    pending.append(value)
                    result.append(value)
            if len(active) + len(pending) > 200:
                raise ValueError("Your Studio queue is full. Finish or cancel some items first.")
            for value in pending:
                self._studio_put(db, "job", value)
            for old in records[199:]:
                if old["status"] in {"complete", "failed", "cancelled"}:
                    db.execute("DELETE FROM application_settings WHERE key=?", (PREFIX + "job." + old["id"],))
            return result

    def studio_cloud_metadata_records(self):
        db = self.connect()
        try:
            rows = db.execute("""SELECT a.value_json,e.media_type,e.tmdb_id,e.title,e.year,
                e.poster_path,e.overview,e.runtime FROM application_settings a
                LEFT JOIN external_titles e ON e.media_type=json_extract(a.value_json,'$.media_type')
                    AND e.tmdb_id=json_extract(a.value_json,'$.tmdb_id')
                WHERE a.key LIKE 'studio.cloudmetadata.%'""")
            result = {}
            for row in rows:
                value = json.loads(row["value_json"])
                value["metadata"] = {key: row[key] for key in ("media_type", "tmdb_id", "title", "year", "poster_path", "overview", "runtime")} if row["tmdb_id"] else None
                result[value["id"]] = value
            return result
        finally:
            db.close()

    def studio_save_cloud_metadata(self, value, metadata=None, automatic=False):
        with self.transaction() as db:
            records = self._studio_records(db, "cloudmetadata")
            old = next((item for item in records if item["id"] == value["id"]), None)
            if old:
                for field in ("variants", "archiveGroup", "titleHint", "publicationJob", "archiveAsset"):
                    if field not in value and field in old:
                        value[field] = old[field]
            if automatic:
                protected = [item for item in records if item.get("confirmed") and (
                    item["id"] == value["id"] and item.get("fingerprint") == value["fingerprint"] or
                    value.get("files") and item.get("files") and all(version in item["files"] for version in value["files"]))]
                if protected:
                    chosen = max(protected, key=lambda item: item.get("updated", 0))
                    value.update(confirmed=True, status="matched", media_type=chosen["media_type"], tmdb_id=chosen["tmdb_id"])
                    self._studio_put(db, "cloudmetadata", value)
                    return value
                if old and old.get("status") == "matched" and old.get("fingerprint") == value["fingerprint"] and not metadata:
                    for field in ("variants", "archiveGroup", "titleHint", "publicationJob", "archiveAsset"):
                        if field in value:
                            old[field] = value[field]
                    old["updated"] = time.time()
                    self._studio_put(db, "cloudmetadata", old)
                    return old
            if metadata:
                db.execute("""INSERT INTO external_titles(media_type,tmdb_id,title,year,poster_path,overview,runtime,updated)
                    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(media_type,tmdb_id) DO UPDATE SET
                    title=excluded.title,year=COALESCE(excluded.year,external_titles.year),
                    poster_path=COALESCE(excluded.poster_path,external_titles.poster_path),
                    overview=COALESCE(excluded.overview,external_titles.overview),
                    runtime=COALESCE(excluded.runtime,external_titles.runtime),updated=excluded.updated""",
                    tuple(metadata.get(key) for key in ("media_type", "tmdb_id", "title", "year", "poster_path", "overview", "runtime")) + (time.time(),))
                value.update(media_type=metadata["media_type"], tmdb_id=metadata["tmdb_id"])
                self._bump_revisions(db, "my_tv_viewing")
            self._studio_put(db, "cloudmetadata", value)
        return value

    def studio_action(self, identity, action, match=None, cloud_copies="original"):
        with self.transaction() as db:
            job = next((j for j in self._studio_records(db, "job") if j["id"] == identity), None)
            if not job:
                raise ValueError("That Studio item could not be found")
            if action not in {"pause", "cancel", "resume", "retry", "metadata", "archive"}:
                raise ValueError("Choose a Studio queue action")
            if action in {"pause", "cancel"}:
                if job["status"] in {"complete", "cancelled"}:
                    raise ValueError("This item has already finished")
                job.update(status="paused" if action == "pause" else "cancelled", command=action)
            else:
                if job["status"] not in FINISHED:
                    raise ValueError("This item is already working")
                if action == "metadata":
                    if not job.get("result", {}).get("complete"):
                        raise ValueError("Publish this item before matching its title")
                    job["match"] = match
                    job["metadata_only"] = True
                if action == "archive":
                    if not job.get("result", {}).get("complete") or job["source"]["type"] == "cloud":
                        raise ValueError("Choose a completed Studio download to save in iCloud")
                    if cloud_copies not in {"original", "optimised", "both"}:
                        raise ValueError("Choose Original, Optimised or Both for iCloud")
                    job["destination"].update(saveCloud=True, cloudCopies=cloud_copies, temporaryWork=True, keepOptimised=False)
                    job["cloud_only"] = True
                    job["metadata_only"] = False
                job.update(status="queued", command="", worker="", claim="", lease=0, error="")
            job["updated"] = time.time()
            self._studio_put(db, "job", job)
            return job

    def studio_poll(self, worker, name, active=None, responses=None):
        now = time.time()
        with self.transaction() as db:
            self._studio_put(db, "worker", {"id": worker, "name": name, "seen": now})
            requests = self._studio_records(db, "request")
            for response in (responses or [])[:4]:
                current = next((r for r in requests if r["id"] == response.get("id")), None)
                if current and current.get("worker") == worker and current.get("claim") == response.get("claim"):
                    current.update(status="failed" if response.get("error") else "complete",
                                   result=response.get("result"), error=str(response.get("error", ""))[:500], updated=now)
                    self._studio_put(db, "request", current)
            jobs = self._studio_records(db, "job")
            acknowledged = None
            if active:
                current = next((j for j in jobs if j["id"] == active.get("id")), None)
                if current and current.get("worker") == worker and current.get("claim") == active.get("claim"):
                    acknowledged = {"id": current["id"], "command": current.get("command", "")}
                    if current["status"] == "active":
                        for key in ("stage", "message", "percent", "result", "error", "metadataWarning", "savedCloudPath", "matchedTitle"):
                            if key in active:
                                current[key] = active[key]
                        if active.get("status") in {"complete", "failed", "paused"}:
                            current["status"] = active["status"]
                        current.update(updated=now, lease=now + 90)
                        self._studio_put(db, "job", current)
            # An expired lease can be recovered by the same laptop or another paired Studio.
            job = None
            if not active:
                for item in sorted(jobs, key=lambda j: j["created"]):
                    if item["status"] == "queued" or item["status"] == "active" and item.get("lease", 0) < now:
                        item.update(status="active", worker=worker, claim=secrets.token_hex(16), lease=now + 90, updated=now)
                        self._studio_put(db, "job", item)
                        job = item
                        break
            pending = []
            for request in sorted(requests, key=lambda r: r["created"]):
                if request["status"] == "queued" or request["status"] == "active" and request.get("lease", 0) < now:
                    request.update(status="active", worker=worker, claim=secrets.token_hex(16), lease=now + 300)
                    self._studio_put(db, "request", request)
                    pending.append(request)
                    break
            return {"job": job, "acknowledged": acknowledged, "requests": pending}
