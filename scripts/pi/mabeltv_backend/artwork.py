"""Bounded, rebuildable cache for provider artwork served to the portal."""

from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


TMDB_ARTWORK_ORIGIN = "https://image.tmdb.org/t/p"
TMDB_ARTWORK_SIZES = frozenset({"w92", "w185", "w342", "w500", "w780", "w1280", "original"})
TMDB_ARTWORK_NAME = re.compile(r"[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)", re.IGNORECASE)
TMDB_ARTWORK_MAX_BYTES = 16 * 1024 * 1024
TMDB_ARTWORK_CACHE_MAX_BYTES = 512 * 1024 * 1024
TMDB_ARTWORK_CACHE_MAX_FILES = 4000
TMDB_ARTWORK_PRUNE_SECONDS = 60 * 60


class ArtworkProxyMixin:
    """Fetch immutable TMDB images once and expose them through our origin."""

    def tmdb_artwork(self, size: str, name: str) -> Path:
        if size not in TMDB_ARTWORK_SIZES or not TMDB_ARTWORK_NAME.fullmatch(name):
            raise ValueError("Invalid TMDB artwork path")
        target = self.tmdb_artwork_cache_root / size / name
        try:
            if target.is_file() and target.stat().st_size > 0:
                return target
        except OSError:
            pass

        request = Request(
            f"{TMDB_ARTWORK_ORIGIN}/{size}/{name}",
            headers={"Accept": "image/avif,image/webp,image/png,image/jpeg", "User-Agent": "MabelTV/1"},
        )
        try:
            with urlopen(request, timeout=15) as response:
                content_type = response.headers.get_content_type().lower()
                if not content_type.startswith("image/"):
                    raise ValueError("TMDB returned an invalid artwork response")
                content = response.read(TMDB_ARTWORK_MAX_BYTES + 1)
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            raise ValueError("TMDB artwork is temporarily unavailable") from error
        if not content or len(content) > TMDB_ARTWORK_MAX_BYTES:
            raise ValueError("TMDB returned invalid artwork")

        target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        temporary = target.with_name(
            f".{target.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        self.prune_tmdb_artwork_cache()
        return target

    def prune_tmdb_artwork_cache(self, force: bool = False) -> None:
        now = time.monotonic()
        last_prune = getattr(self, "tmdb_artwork_last_prune", 0.0)
        if not force and last_prune and now - last_prune < TMDB_ARTWORK_PRUNE_SECONDS:
            return
        lock = getattr(self, "tmdb_artwork_prune_lock", None)
        if lock is None or not lock.acquire(blocking=False):
            return
        try:
            self.tmdb_artwork_last_prune = now
            files: list[tuple[float, int, Path]] = []
            for path in self.tmdb_artwork_cache_root.glob("*/*"):
                if not path.is_file() or path.suffix == ".tmp":
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                files.append((stat.st_mtime, stat.st_size, path))
            files.sort()
            total = sum(item[1] for item in files)
            while (len(files) > TMDB_ARTWORK_CACHE_MAX_FILES
                   or total > TMDB_ARTWORK_CACHE_MAX_BYTES):
                _, size, path = files.pop(0)
                try:
                    path.unlink()
                    total -= size
                except OSError:
                    pass
        finally:
            lock.release()
