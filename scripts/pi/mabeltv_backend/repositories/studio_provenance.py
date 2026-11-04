"""Durable acquisition and delivery records, independent of bounded Activity."""
import hashlib
import json
import time


def put(db, kind, value):
    db.execute("INSERT INTO application_settings(key,value_json,updated_at) VALUES(?,?,?) "
               "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
               ("studio." + kind + "." + value["id"], json.dumps(value), time.time()))


def keep_acquisition(db, job):
    source = job["source"]
    identity = source.get("acquisitionId") or hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()[:32]
    source["acquisitionId"] = identity
    row = db.execute("SELECT value_json FROM application_settings WHERE key=?", ("studio.acquisition." + identity,)).fetchone()
    if not row:
        original = {key: value for key, value in source.items() if key not in {"claim", "inspection", "variants"}}
        if source.get("type") == "iplayer" and source.get("pid"):
            original["url"] = "https://www.bbc.co.uk/iplayer/episode/" + source["pid"]
        put(db, "acquisition", {"id": identity, "source": original, "title": job["title"],
                               "match": job.get("match"), "created": job["created"], "version": 1})
    return identity


def keep_delivery(db, job):
    identity = keep_acquisition(db, job)
    previous = db.execute("SELECT value_json FROM application_settings WHERE key=?", ("studio.delivery." + job["id"],)).fetchone()
    value = json.loads(previous[0]) if previous else {}
    value.update({key: job[key] for key in ("id", "title", "destination", "result", "savedCloudPath", "matchedTitle", "provenance") if key in job})
    value.update(acquisitionId=identity, updated=time.time(), status=job["status"], version=1)
    put(db, "delivery", value)
