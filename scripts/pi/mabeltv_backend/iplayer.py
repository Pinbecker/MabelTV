"""Read BBC identity from media currently in the library, never upload history."""
from __future__ import annotations

import re
import socket
import struct
import time
from pathlib import Path
from typing import BinaryIO, Any

PID = re.compile(r"[bmp][a-z0-9]{7}")
TAG_NAMES = {b"tven": "pid", b"tvsh": "title", b"\xa9alb": "album",
             b"\xa9nam": "episode", b"tvsn": "series", b"tves": "episodeNumber",
             b"\xa9lyr": "links", b"ldes": "description"}


def media_identity(path: Path) -> dict[str, Any]:
    """Bounded MP4 atom reads. Skip video bytes and cover artwork entirely."""
    tags: dict[str, Any] = {}
    budget = [2 * 1024 * 1024, 10000]

    def atoms(stream: BinaryIO, start: int, end: int, depth: int = 0) -> None:
        if depth > 6:
            return
        offset = start
        while offset + 8 <= end and budget[1] > 0:
            budget[1] -= 1
            stream.seek(offset)
            header = stream.read(8)
            if len(header) != 8:
                return
            size, kind = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extra = stream.read(8)
                if len(extra) != 8:
                    return
                size = struct.unpack(">Q", extra)[0]
                header_size = 16
            elif size == 0:
                size = end - offset
            if size < header_size or offset + size > end:
                return
            content, stop = offset + header_size, offset + size
            if kind in {b"moov", b"udta", b"ilst"}:
                atoms(stream, content, stop, depth + 1)
            elif kind == b"meta":
                atoms(stream, content + 4, stop, depth + 1)
            elif kind in TAG_NAMES and size <= 65536 and size <= budget[0]:
                stream.seek(content)
                data = stream.read(stop - content)
                budget[0] -= len(data)
                # iTunes tag payload contains a data atom, type and locale.
                if len(data) >= 16 and data[4:8] == b"data":
                    length = int.from_bytes(data[:4], "big")
                    if 16 <= length <= len(data):
                        payload = data[16:length]
                        key = TAG_NAMES[kind]
                        tags[key] = int.from_bytes(payload, "big") if key in {
                            "series", "episodeNumber"} and len(payload) <= 8 \
                            else payload.decode("utf-8", errors="replace")[:4096]
            offset = stop

    try:
        with path.open("rb") as stream:
            atoms(stream, 0, path.stat().st_size)
    except (OSError, ValueError, struct.error):
        return {}
    pid = str(tags.get("pid", ""))
    if not PID.fullmatch(pid):
        match = re.search(r"https://www\.bbc\.co\.uk/(?:iplayer/episode|programmes)/"
                          r"([bmp][a-z0-9]{7})(?:\b|/)",
                          str(tags.get("links", "")) + str(tags.get("description", "")))
        pid = match.group(1) if match else ""
    # Unrelated MP4 titles must not masquerade as BBC programme metadata.
    return {"pid": pid, "title": str(tags.get("title") or tags.get("album") or "")[:300],
            "episode": str(tags.get("episode", ""))[:300],
            "series": tags.get("series"), "episodeNumber": tags.get("episodeNumber")} if pid else {}


class IPlayerLibraryMixin:
    def iplayer_library_files(self):
        for channel in self.channels():
            folder = self.media_root / str(channel["folder"])
            for item in folder.glob("*"):
                yield item, {"kind": "mabel", "channel": channel["number"],
                             "label": "Mabel TV · " + channel["name"]}, channel["name"]
        for folder in [self.my_tv_root, *(self.my_tv_root / name
                                       for name in self.my_tv_folders())]:
            for item in folder.glob("*"):
                yield item, {"kind": "film", "label": "My TV · Films"}, ""
        states = self.my_tv_series_states()
        for series_id, state in states["series"].items():
            if not re.fullmatch(r"[a-f0-9]{32}", str(series_id)) or not isinstance(state, dict):
                continue
            title = str(state.get("title") or "Series")
            for item in (self.my_tv_series_root / series_id).rglob("*"):
                yield item, {"kind": "series", "series": series_id,
                             "label": "My TV · " + title}, title

    def iplayer_library(self) -> dict[str, Any]:
        items = []
        active_paths = set()
        # Cache only parsed tags, keyed by file fingerprint. Presence is always
        # re-established from the current files, including on a cache hit.
        with self.iplayer_inventory_lock:
            for path, location, show in self.iplayer_library_files():
                try:
                    if not path.is_file() or path.suffix.lower() not in {
                            ".mp4", ".m4v", ".mov", ".mkv", ".avi", ".webm", ".ts"}:
                        continue
                    resolved = path.resolve()
                    if not resolved.is_relative_to(self.media_root):
                        continue
                    stat = path.stat()
                    signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)
                    key = str(resolved)
                    cached = self.iplayer_identity_cache.get(key)
                    # Windows can coalesce timestamps on rapid same-size writes.
                    # Read bounded tags again while newly changed, then cache.
                    settled = time.time_ns() - stat.st_mtime_ns > 1_000_000_000
                    identity = cached[1] if settled and cached and cached[0] == signature else media_identity(path)
                    final = path.stat()
                    if (final.st_size, final.st_mtime_ns, final.st_ctime_ns, final.st_ino) != signature:
                        continue
                    active_paths.add(key)
                    self.iplayer_identity_cache[key] = (signature, identity)
                    relative = path.relative_to(self.media_root).as_posix()
                    items.append({**identity, "file": path.name, "show": show,
                                  "location": {**location, "path": relative}})
                except (OSError, ValueError):
                    continue  # Removed or moved during this read.
            self.iplayer_identity_cache = {
                key: value for key, value in self.iplayer_identity_cache.items()
                if key in active_paths}
        return {"items": items, "checkedAt": time.time(), "device": socket.gethostname()}
