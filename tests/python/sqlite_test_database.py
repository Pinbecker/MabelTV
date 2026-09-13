from __future__ import annotations

import time
from pathlib import Path
from typing import Any


def initialise_test_database(database_type: Any, path: Path,
                             channels: dict[str, Any] | None = None,
                             settings: dict[str, Any] | None = None) -> Any:
    database = database_type(path)
    database.initialise()
    stores = {
        "channels": channels or {"schema_version": 1, "channels": []},
        "settings": settings or {"schema_version": 1},
        "owner": {},
        "player": {"schema_version": 4, "standby": False},
        "viewing": {"schema_version": 2, "tracking_started": time.time(),
                    "sessions": []},
        "channel_metadata": {},
        "adult_media": {},
        "adult_series": {"series": {}, "episodes": {}},
        "adult_viewing": {"schema_version": 1, "titles": {},
                          "availability": {}, "explore": {}},
        "adult_insights": {"schema_version": 1, "titles": {}, "failures": {}},
    }
    for kind, value in stores.items():
        database.write(kind, value)
    return database
