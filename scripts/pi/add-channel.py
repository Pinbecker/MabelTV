#!/usr/bin/env python3
"""Safely add or update one Mabel TV channel in the live Pi configuration."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import tempfile


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/var/lib/mabeltv/channels.json")
    parser.add_argument("--number", required=True, type=int)
    parser.add_argument("--name", required=True)
    parser.add_argument("--folder", required=True)
    parser.add_argument("--aspect", choices=("crop", "fit", "stretch"), default="crop")
    return parser.parse_args()


def valid_folder(value: str) -> bool:
    folder = PurePosixPath(value)
    return bool(value) and not folder.is_absolute() and ".." not in folder.parts


def main() -> int:
    args = parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run this command with sudo.")
    if not 0 <= args.number <= 999:
        raise SystemExit("Channel number must be between 0 and 999.")
    if not args.name.strip():
        raise SystemExit("Channel name cannot be empty.")
    if not valid_folder(args.folder):
        raise SystemExit("Folder must be a safe path relative to the media root.")

    config_path = Path(args.config)
    try:
        root = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read {config_path}: {error}") from error

    channels = root.get("channels")
    if not isinstance(channels, list):
        raise SystemExit(f"{config_path} does not contain a channels list.")

    matching_number = next(
        (channel for channel in channels if channel.get("number") == args.number), None
    )
    matching_folder = next(
        (channel for channel in channels if channel.get("folder") == args.folder), None
    )
    if matching_number is not None and matching_number.get("folder") != args.folder:
        raise SystemExit(
            f"Channel {args.number} already uses folder "
            f"{matching_number.get('folder')!r}; no changes made."
        )
    if matching_folder is not None and matching_folder.get("number") != args.number:
        raise SystemExit(
            f"Folder {args.folder!r} already belongs to channel "
            f"{matching_folder.get('number')}; no changes made."
        )

    channel = matching_number or matching_folder
    desired = {
        "number": args.number,
        "name": args.name.strip(),
        "folder": args.folder,
        "aspect": args.aspect,
    }
    changed = channel != desired
    if channel is None:
        channels.append(desired)
    elif changed:
        channel.clear()
        channel.update(desired)
    channels.sort(key=lambda item: int(item.get("number", 1000)))

    if not changed:
        print(f"Channel {args.number} is already configured as {args.name}.")
        return 0

    config_path.parent.mkdir(parents=True, exist_ok=True)
    stat = config_path.stat()
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{config_path.name}.", dir=config_path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(root, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, stat.st_mode)
        os.chown(temporary_name, stat.st_uid, stat.st_gid)
        os.replace(temporary_name, config_path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)

    print(f"Configured channel {args.number}: {args.name} ({args.folder}, {args.aspect}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
