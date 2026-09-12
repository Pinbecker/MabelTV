#!/usr/bin/env python3
"""Import, validate and inspect MabelTV's one-time JSON migration."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT))

from mabeltv_backend.database import SCHEMA_VERSION, StateDatabase  # noqa: E402


RELATIVE_STORES = {
    "channels": "var/lib/mabeltv/channels.json",
    "settings": "var/lib/mabeltv/settings.json",
    "owner": "var/lib/mabeltv/owner.json",
    "player": "var/lib/mabeltv/state.json",
    "viewing": "var/lib/mabeltv/viewing-history.json",
    "channel_metadata": "srv/mabeltv/media/.mabeltv-channels.json",
    "adult_media": "srv/mabeltv/media/.adult/.mabeltv-adult.json",
    "adult_series": "srv/mabeltv/media/.adult/.mabeltv-series.json",
    "adult_viewing": "srv/mabeltv/media/.adult/.mabeltv-viewing.json",
    "adult_insights": "srv/mabeltv/media/.adult/.mabeltv-insights.json",
}


def canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): canonical(saved) for key, saved in sorted(value.items())}
    if isinstance(value, list):
        return [canonical(saved) for saved in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def digest(value: Any) -> str:
    encoded = json.dumps(canonical(value), ensure_ascii=False,
                         sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def read_sources(root: Path) -> tuple[dict[str, Any], dict[str, str]]:
    values: dict[str, Any] = {}
    hashes: dict[str, str] = {}
    for kind, relative in RELATIVE_STORES.items():
        path = root / relative
        if not path.is_file():
            raise FileNotFoundError(f"Required migration source is missing: {path}")
        raw = path.read_bytes()
        try:
            values[kind] = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError(f"Invalid JSON migration source {path}: {error}") from error
        hashes[kind] = hashlib.sha256(raw).hexdigest()
    return values, hashes


def shape_counts(kind: str, value: Any) -> dict[str, int]:
    if kind == "channels":
        return {"channels": len(value.get("channels", []))}
    if kind == "viewing":
        return {"sessions": len(value.get("sessions", []))}
    if kind == "channel_metadata":
        return {name: len(value.get(name, {})) for name in
                ("channels", "programmes", "favourites", "favourite_channels")}
    if kind == "adult_series":
        return {name: len(value.get(name, {})) for name in ("series", "episodes")}
    if kind == "adult_viewing":
        titles = value.get("titles", {})
        return {
            "titles": len(titles),
            "watch_events": sum(len(item.get("history", [])) for item in titles.values()
                                if isinstance(item, dict)),
            "watchlist": sum(bool(item.get("watchlisted")) for item in titles.values()
                             if isinstance(item, dict)),
            "up_next": sum(bool(item.get("up_next")) for item in titles.values()
                           if isinstance(item, dict)),
            "ratings": sum(bool(item.get("personal_rating")) for item in titles.values()
                           if isinstance(item, dict)),
            "episodes": sum(len(item.get("episodes", {})) for item in titles.values()
                            if isinstance(item, dict)),
            "availability": len(value.get("availability", {})),
            "explore": len(value.get("explore", {})),
        }
    if kind == "adult_insights":
        return {name: len(value.get(name, {})) for name in ("titles", "failures")}
    return {"fields": len(value) if isinstance(value, dict) else 0}


def compare(source: dict[str, Any], database: StateDatabase) -> dict[str, Any]:
    stores: dict[str, Any] = {}
    success = True
    for kind, original in source.items():
        restored = database.read(kind)
        source_counts = shape_counts(kind, original)
        database_counts = shape_counts(kind, restored)
        equal = canonical(original) == canonical(restored)
        stores[kind] = {
            "equal": equal,
            "source_digest": digest(original),
            "database_digest": digest(restored),
            "source_counts": source_counts,
            "database_counts": database_counts,
        }
        success = success and equal and source_counts == database_counts
    integrity = database.integrity_report()
    success = success and integrity["integrity"] == "ok" \
        and not integrity["foreign_key_errors"]
    return {"ok": success, "schema_version": SCHEMA_VERSION,
            "stores": stores, "integrity": integrity}


def import_sources(source_root: Path, database_path: Path,
                   source_id: str, manifest_sha256: str) -> dict[str, Any]:
    source, hashes = read_sources(source_root)
    if database_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing database: {database_path}")
    temporary = database_path.with_name(database_path.name + ".importing")
    temporary.unlink(missing_ok=True)
    database = StateDatabase(temporary, {})
    database.initialise()
    try:
        # Channels precede player timeline foreign keys.
        for kind in ("channels", "settings", "owner", "player", "viewing",
                     "channel_metadata", "adult_media", "adult_series",
                     "adult_viewing", "adult_insights"):
            database.write(kind, source[kind])
        report = compare(source, database)
        report["source_hashes"] = hashes
        if not report["ok"]:
            raise RuntimeError(json.dumps(report, indent=2, sort_keys=True))
        with database.transaction() as connection:
            connection.execute("INSERT INTO imports(source_id,source_manifest_sha256,imported_at,report_json) VALUES(?,?,?,?)",
                               (source_id, manifest_sha256, time.time(),
                                json.dumps(report, sort_keys=True)))
        os.chmod(temporary, 0o640)
        os.replace(temporary, database_path)
        return report
    except Exception:
        temporary.unlink(missing_ok=True)
        Path(str(temporary) + "-wal").unlink(missing_ok=True)
        Path(str(temporary) + "-shm").unlink(missing_ok=True)
        raise


def export_sources(database_path: Path, output_root: Path) -> dict[str, Any]:
    """Create a complete JSON rollback tree without touching live state."""
    if output_root.exists():
        raise FileExistsError(f"Refusing to overwrite export: {output_root}")
    temporary = output_root.with_name(output_root.name + ".exporting")
    if temporary.exists():
        raise FileExistsError(f"Refusing to overwrite partial export: {temporary}")
    database = StateDatabase(database_path, {})
    database.verify_ready()
    temporary.mkdir(parents=True)
    try:
        for kind, relative in RELATIVE_STORES.items():
            path = temporary / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8") as output:
                json.dump(database.read(kind), output, ensure_ascii=False,
                          indent=2, sort_keys=True)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.chmod(path, 0o640)
        restored, hashes = read_sources(temporary)
        report = compare(restored, database)
        report["export_hashes"] = hashes
        if not report["ok"]:
            raise RuntimeError(json.dumps(report, indent=2, sort_keys=True))
        report_path = temporary / "MIGRATION-EXPORT-REPORT.json"
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                               encoding="utf-8")
        os.chmod(report_path, 0o640)
        os.replace(temporary, output_root)
        return report
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    importer = subparsers.add_parser("import")
    importer.add_argument("--source-root", type=Path, required=True)
    importer.add_argument("--database", type=Path, required=True)
    importer.add_argument("--source-id", required=True)
    importer.add_argument("--manifest-sha256", required=True)
    validator = subparsers.add_parser("validate")
    validator.add_argument("--source-root", type=Path, required=True)
    validator.add_argument("--database", type=Path, required=True)
    backup = subparsers.add_parser("backup")
    backup.add_argument("--database", type=Path, required=True)
    backup.add_argument("--output", type=Path, required=True)
    exporter = subparsers.add_parser("export-json")
    exporter.add_argument("--database", type=Path, required=True)
    exporter.add_argument("--output-root", type=Path, required=True)
    bootstrap = subparsers.add_parser("bootstrap")
    bootstrap.add_argument("--database", type=Path, required=True)
    bootstrap.add_argument("--channels", type=Path, required=True)
    bootstrap.add_argument("--settings", type=Path, required=True)
    upgrade = subparsers.add_parser("upgrade")
    upgrade.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "import":
        report = import_sources(args.source_root, args.database, args.source_id,
                                args.manifest_sha256)
    elif args.command == "validate":
        source, _ = read_sources(args.source_root)
        database = StateDatabase(args.database, {})
        database.verify_ready()
        report = compare(source, database)
    elif args.command == "backup":
        database = StateDatabase(args.database, {})
        database.verify_ready()
        if args.output.exists():
            raise FileExistsError(f"Refusing to overwrite backup: {args.output}")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        source = database.connect()
        destination = sqlite3.connect(args.output)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        report = StateDatabase(args.output, {}).integrity_report()
    elif args.command == "export-json":
        report = export_sources(args.database, args.output_root)
    elif args.command == "upgrade":
        report = StateDatabase(args.database, {}).upgrade()
    else:
        if args.database.exists():
            raise FileExistsError(f"Refusing to overwrite database: {args.database}")
        database = StateDatabase(args.database, {})
        database.initialise()
        source = {
            "channels": json.loads(args.channels.read_text(encoding="utf-8")),
            "settings": json.loads(args.settings.read_text(encoding="utf-8")),
            "owner": {}, "player": {"schema_version": 4},
            "viewing": {"schema_version": 2, "tracking_started": time.time(),
                        "sessions": []},
            "channel_metadata": {}, "adult_media": {},
            "adult_series": {"series": {}, "episodes": {}},
            "adult_viewing": {"schema_version": 1, "titles": {},
                              "availability": {}, "explore": {}},
            "adult_insights": {"schema_version": 1, "titles": {}, "failures": {}},
        }
        for kind, value in source.items():
            database.write(kind, value)
        os.chmod(args.database, 0o640)
        report = database.integrity_report()
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report.get("ok", report.get("integrity") == "ok"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
