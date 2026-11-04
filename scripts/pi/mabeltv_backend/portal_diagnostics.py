"""Bounded protected diagnostics; no request bodies, query values or source URLs."""
import re
import time


def record_diagnostics(library, payload):
    events = payload.get("events")
    if not isinstance(events, list) or len(events) > 10:
        raise ValueError("Invalid diagnostic events")
    checked = []
    for event in events:
        if not isinstance(event, dict):
            raise ValueError("Invalid diagnostic event")
        path = str(event.get("path", ""))
        if not re.fullmatch(r"/api/[a-zA-Z0-9_/:.\-]{1,110}", path):
            continue
        checked.append({"path": path, "method": str(event.get("method", ""))[:8],
                        "route": re.sub(r"[^a-zA-Z0-9_/#:.\-]", "", str(event.get("route", "")))[:80],
                        "requestId": str(event.get("requestId", ""))[:40], "code": str(event.get("code", ""))[:32],
                        "duration": min(120000, max(0, int(event.get("duration", 0)))),
                        "visible": event.get("visible") == "visible", "online": event.get("online") is True})
    if checked:
        library.state_database.studio_add("diagnostic", {"id": str(time.time_ns()), "events": checked, "status": "complete", "created": time.time()})
    return {"ok": True}
