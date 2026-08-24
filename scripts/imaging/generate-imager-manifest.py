#!/usr/bin/env python3
"""Create a Raspberry Pi Imager manifest for one KidsTV image."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import lzma
import pathlib
import re
import sys
from typing import BinaryIO


def sha256_and_size(stream: BinaryIO) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size


def image_details(path: pathlib.Path) -> tuple[str, int, str, int]:
    with path.open("rb") as download:
        download_hash, download_size = sha256_and_size(download)
    if path.name.endswith(".img.xz"):
        with lzma.open(path, "rb") as extracted:
            extract_hash, extract_size = sha256_and_size(extracted)
    elif path.name.endswith(".img"):
        extract_hash, extract_size = download_hash, download_size
    else:
        raise ValueError("image must end in .img or .img.xz")
    return extract_hash, extract_size, download_hash, download_size


def uri(value: str | None, fallback: pathlib.Path) -> str:
    if value:
        if not re.match(r"^https?://", value):
            raise ValueError("published URLs must use https:// or http://")
        return value
    return fallback.resolve().as_uri()


def build_manifest(args: argparse.Namespace) -> dict[str, object]:
    image = args.image.resolve()
    icon = args.icon.resolve()
    if not image.is_file():
        raise ValueError(f"image does not exist: {image}")
    if not icon.is_file() and not args.icon_url:
        raise ValueError(f"icon does not exist: {icon}")
    extract_hash, extract_size, download_hash, download_size = image_details(image)
    targets = {
        "pi4": {
            "name": f"KidsTV {args.version}",
            "description": "A child-friendly television appliance for Raspberry Pi 4",
            "devices": ["pi4-64bit"],
            "architecture": "arm64",
        },
        "pi1-benchmark": {
            "name": f"KidsTV {args.version} - Pi 1 benchmark",
            "description": "Full KidsTV benchmark image for Raspberry Pi 1 (experimental)",
            "devices": ["pi1-32bit"],
            "architecture": "armhf",
        },
    }
    target = targets[args.target]
    entry: dict[str, object] = {
        "name": target["name"],
        "description": target["description"],
        "icon": uri(args.icon_url, icon),
        "url": uri(args.image_url, image),
        "website": args.website,
        "release_date": args.release_date,
        "extract_size": extract_size,
        "extract_sha256": extract_hash,
        "image_download_size": download_size,
        "image_download_sha256": download_hash,
        "devices": target["devices"],
        "init_format": "cloudinit-rpi",
        "architecture": target["architecture"],
    }
    return {"os_list": [entry]}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("--image", required=True, type=pathlib.Path)
    result.add_argument("--version", required=True)
    result.add_argument("--target", choices=("pi4", "pi1-benchmark"), default="pi4")
    result.add_argument("--output", required=True, type=pathlib.Path)
    result.add_argument(
        "--icon",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parents[2]
        / "packaging/imager/mabeltv-imager.svg",
    )
    result.add_argument("--image-url")
    result.add_argument("--icon-url")
    result.add_argument("--website", default="https://github.com/Pinbecker/MabelTV")
    result.add_argument("--release-date", default=dt.date.today().isoformat())
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        manifest = build_manifest(args)
    except (OSError, ValueError, lzma.LZMAError) as error:
        print(f"Cannot create Imager manifest: {error}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"Raspberry Pi Imager manifest: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
