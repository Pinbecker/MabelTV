"""External provider transport and subtitle behaviour for the local library service."""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import time
from copy import deepcopy
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request

from .constants import (
    ADULT_METADATA_CACHE_SECONDS,
    ADULT_PROVIDER_CACHE_SECONDS,
    ADULT_PROVIDER_MAX_CACHE_SECONDS,
    OPENSUBTITLES_API_BASE_URL,
    OPENSUBTITLES_USER_AGENT,
    SUBTITLE_EXTENSIONS,
    SUPPORTED_EXTENSIONS,
    TMDB_BACKDROP_IMAGE_BASE_URL,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE_URL,
    WATCHMODE_API_BASE_URL,
)


class ProviderTransportMixin:
    def tmdb_key(self) -> str:
        key = os.environ.get("MABELTV_TMDB_API_KEY", "").strip()
        if not key:
            try:
                key = self.tmdb_key_path.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return key

    def opensubtitles_key(self) -> str:
        """Return the Pi-local consumer key, never exposing it through the portal."""
        key = os.environ.get("MABELTV_OPENSUBTITLES_API_KEY", "").strip()
        if not key:
            try:
                key = self.opensubtitles_key_path.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return key

    @staticmethod
    def subtitle_sidecars(source: Path) -> list[Path]:
        """Find MPV-recognised sidecars belonging to one film, not unrelated SRTs."""
        candidates: list[Path] = []
        for extension in SUBTITLE_EXTENSIONS:
            exact = source.with_suffix(extension)
            if exact.is_file():
                candidates.append(exact)
            candidates.extend(candidate for candidate in source.parent.glob(
                f"{source.stem}.*{extension}") if candidate.is_file())
        return list(dict.fromkeys(candidates))

    def subtitle_availability(self, source: Path) -> dict[str, Any]:
        sidecars = self.subtitle_sidecars(source)
        if sidecars:
            return {"status": "external", "file": sidecars[0].name}
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "s",
                 "-show_entries", "stream=index", "-of", "json", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            streams = json.loads(result.stdout).get("streams", [])
            if result.returncode == 0 and streams:
                return {"status": "embedded"}
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            # A malformed file must not prevent its confirmed film metadata
            # from being stored. Playback validation handles that separately.
            pass
        return {"status": "missing"}

    def opensubtitles_request(self, endpoint: str,
                              parameters: dict[str, Any] | None = None,
                              body: dict[str, Any] | None = None) -> Any:
        key = self.opensubtitles_key()
        if not key:
            raise ValueError("OpenSubtitles has not been configured")
        query = urlencode(parameters or {})
        url = f"{OPENSUBTITLES_API_BASE_URL}/{endpoint.lstrip('/')}"
        if query:
            url += f"?{query}"
        headers = {
            "Accept": "application/json",
            "Api-Key": key,
            "User-Agent": OPENSUBTITLES_USER_AGENT,
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        try:
            request = Request(url, data=data, headers=headers)
            with self._open_url(request, timeout=15) as response:
                return json.loads(response.read(2 * 1024 * 1024))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError("OpenSubtitles could not be reached") from error

    def opensubtitles_download_bytes(self, link: str) -> bytes:
        parsed = urlsplit(link)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("OpenSubtitles returned an invalid download link")
        try:
            request = Request(link, headers={"User-Agent": OPENSUBTITLES_USER_AGENT})
            with self._open_url(request, timeout=20) as response:
                return response.read(4 * 1024 * 1024 + 1)
        except (HTTPError, URLError, TimeoutError) as error:
            raise ValueError("OpenSubtitles could not download the subtitle") from error

    @staticmethod
    def opensubtitles_best_file(response: Any) -> int | None:
        if not isinstance(response, dict):
            return None
        options: list[tuple[tuple[int, int, float, int], int]] = []
        for item in response.get("data", []):
            if not isinstance(item, dict):
                continue
            attributes = item.get("attributes", {})
            if not isinstance(attributes, dict) or attributes.get("language") != "en":
                continue
            for value in attributes.get("files", []):
                if not isinstance(value, dict):
                    continue
                try:
                    file_id = int(value.get("file_id", 0))
                except (TypeError, ValueError):
                    continue
                # The OpenSubtitles search API often omits the extension from
                # an otherwise valid text-subtitle filename.  The download is
                # still checked for real SRT timing cues before it is saved.
                if file_id <= 0:
                    continue
                # Prefer ordinary English SRTs with a proven download history;
                # hearing-impaired captions remain a valid fallback.
                score = (
                    0 if bool(attributes.get("hearing_impaired")) else 1,
                    int(float(attributes.get("ratings") or 0) * 100),
                    float(attributes.get("download_count") or 0),
                    -file_id,
                )
                options.append((score, file_id))
        return max(options)[1] if options else None

    def fetch_automatic_subtitle(self, source: Path, tmdb_id: int) -> dict[str, Any]:
        """Fetch one conservative English SRT after a confirmed TMDB match.

        This never raises into the metadata path: a missing subtitle must not
        make the film, artwork, or its selected TMDB match disappear.
        """
        current = self.subtitle_availability(source)
        if current["status"] != "missing":
            return current
        if not self.opensubtitles_key():
            return {"status": "not_configured"}
        try:
            matches = self.opensubtitles_request(
                "subtitles", {"tmdb_id": tmdb_id, "languages": "en",
                               "order_by": "download_count", "order_direction": "desc"})
            file_id = self.opensubtitles_best_file(matches)
            if file_id is None:
                return {"status": "unavailable", "provider": "OpenSubtitles"}
            ticket = self.opensubtitles_request("download", body={"file_id": file_id})
            link = str(ticket.get("link", "")) if isinstance(ticket, dict) else ""
            data = self.opensubtitles_download_bytes(link)
            if len(data) > 4 * 1024 * 1024 or b"-->" not in data[:64 * 1024]:
                raise ValueError("OpenSubtitles returned an invalid subtitle")
            target = source.with_name(f"{source.stem}.en.srt")
            temporary = target.with_suffix(".srt.new")
            temporary.write_bytes(data)
            os.replace(temporary, target)
            return {"status": "downloaded", "file": target.name,
                    "language": "en", "provider": "OpenSubtitles",
                    "updated": time.time()}
        except (OSError, ValueError):
            return {"status": "unavailable", "provider": "OpenSubtitles"}

    def tmdb_status(self) -> dict[str, Any]:
        return {"configured": bool(self.tmdb_key()),
                "key_file": str(self.tmdb_key_path), "provider": "TMDB"}

    def tmdb_request(self, endpoint: str, parameters: dict[str, Any] | None = None) -> Any:
        key = self.tmdb_key()
        if not key:
            raise ValueError("TMDB is ready, but its API key has not been added yet")
        query = dict(parameters or {})
        # TMDB issues JWT-style Read Access Tokens as well as legacy v3 API
        # keys. The former must be sent as a Bearer token, never as a query
        # parameter (which produces a 401 and risks leaking the credential).
        bearer_token = key.count(".") == 2 and key.startswith("eyJ")
        if not bearer_token:
            query["api_key"] = key
        url = f"{TMDB_BASE_URL}/{endpoint.lstrip('/')}?{urlencode(query)}"
        try:
            headers = {"Accept": "application/json", "User-Agent": "MabelTV/0.2.5"}
            if bearer_token:
                headers["Authorization"] = f"Bearer {key}"
            request = Request(url, headers=headers)
            with self._open_url(request, timeout=12) as response:
                return json.loads(response.read(2 * 1024 * 1024))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError("TMDB could not be reached. Try the scan again later") from error

    def watchmode_key(self) -> str:
        """Return the Pi-local Watchmode key without exposing it to clients."""
        key = os.environ.get("MABELTV_WATCHMODE_API_KEY", "").strip()
        if not key:
            try:
                key = self.watchmode_key_path.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return key

    def watchmode_request(self, endpoint: str,
                          parameters: dict[str, Any] | None = None) -> Any:
        key = self.watchmode_key()
        if not key:
            raise ValueError("Streaming links have not been configured yet")
        query = urlencode(parameters or {})
        url = f"{WATCHMODE_API_BASE_URL}/{endpoint.strip('/')}"
        if query:
            url += f"?{query}"
        try:
            request = Request(url, headers={
                "Accept": "application/json", "X-API-Key": key,
                "User-Agent": "MabelTV/0.2.5",
            })
            with self._open_url(request, timeout=12) as response:
                return json.loads(response.read(2 * 1024 * 1024))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError("Streaming services could not be reached. Try again later") from error

    def adult_cached_tmdb_request(self, endpoint: str,
                                  parameters: dict[str, Any] | None = None) -> Any:
        """Cache catalogue metadata while keeping viewing and local state live."""
        marker = f"{endpoint}?{urlencode(sorted((parameters or {}).items()))}"
        now = time.time()
        with self.config_lock:
            cache = getattr(self, "_adult_tmdb_cache", None)
            if not isinstance(cache, dict):
                cache = {}
                self._adult_tmdb_cache = cache
            saved = cache.get(marker, {})
            if isinstance(saved, dict) and now - float(
                    saved.get("checked", 0) or 0) < ADULT_METADATA_CACHE_SECONDS:
                return deepcopy(saved.get("value"))
        value = self.tmdb_request(endpoint, parameters)
        with self.config_lock:
            cache[marker] = {"checked": now, "value": deepcopy(value)}
        return value
