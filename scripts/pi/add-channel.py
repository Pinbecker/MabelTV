#!/usr/bin/env python3
"""Safely add or update one MabelTV channel in the authoritative database."""

from __future__ import annotations

import argparse
import os
from pathlib import Path, PurePosixPath
import sys
from typing import Any


def _state_database_type() -> Any:
    candidates = (Path(__file__).resolve().parent, Path("/opt/mabeltv/current"))
    for candidate in candidates:
        if (candidate / "mabeltv_backend" / "database.py").is_file():
            sys.path.insert(0, str(candidate))
            from mabeltv_backend.database import StateDatabase
            return StateDatabase
    raise SystemExit("The active MabelTV database package is unavailable.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="/var/lib/mabeltv/mabeltv.db")
    parser.add_argument("--number", required=True, type=int)
    parser.add_argument("--name", required=True)
    parser.add_argument("--folder", required=True)
    parser.add_argument("--aspect", choices=("crop", "fit", "stretch"), default="crop")
    parser.add_argument("--content-type", choices=("shows", "films"))
    return parser.parse_args()


def valid_folder(value: str) -> bool:
    folder = PurePosixPath(value)
    return bool(value) and not folder.is_absolute() and ".." not in folder.parts


def configure_channel(database: Any, requested: dict[str, Any]) -> bool:
    """Apply one idempotent channel change through targeted SQLite operations."""
    channels = database.read("channels").get("channels", [])
    number = int(requested["number"])
    folder = str(requested["folder"])
    matching_number = next(
        (channel for channel in channels if int(channel.get("number", -1)) == number), None)
    matching_folder = next(
        (channel for channel in channels if str(channel.get("folder", "")) == folder), None)
    if matching_number is not None and matching_number.get("folder") != folder:
        raise ValueError(
            f"Channel {number} already uses folder {matching_number.get('folder')!r}")
    if matching_folder is not None and int(matching_folder.get("number", -1)) != number:
        raise ValueError(
            f"Folder {folder!r} already belongs to channel {matching_folder.get('number')}")

    existing = matching_number or matching_folder
    desired = {
        "number": number,
        "name": str(requested["name"]).strip(),
        "folder": folder,
        "aspect": str(requested.get("aspect", "crop")),
        "content_type": str(requested.get("content_type")
                            or (existing or {}).get("content_type", "shows")),
    }
    if existing == desired:
        return False
    if existing is None:
        database.insert_channel(desired)
    else:
        database.update_channel(int(existing["number"]), desired)
    return True


def _drop_to_service_user() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run this command with sudo.")
    import pwd
    account = pwd.getpwnam("mabeltv")
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)


def main() -> int:
    args = parse_args()
    if not 1 <= args.number <= 999:
        raise SystemExit("Channel number must be between 1 and 999.")
    if not args.name.strip():
        raise SystemExit("Channel name cannot be empty.")
    if not valid_folder(args.folder):
        raise SystemExit("Folder must be a safe path relative to the media root.")

    StateDatabase = _state_database_type()
    _drop_to_service_user()
    database = StateDatabase(Path(args.database))
    database.verify_ready()
    try:
        changed = configure_channel(database, vars(args))
    except ValueError as error:
        raise SystemExit(f"{error}; no changes made.") from error
    if changed:
        print(f"Configured channel {args.number}: {args.name} "
              f"({args.folder}, {args.aspect}).")
    else:
        print(f"Channel {args.number} is already configured as {args.name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
