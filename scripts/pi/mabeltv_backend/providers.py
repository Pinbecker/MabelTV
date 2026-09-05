"""Provider metadata behaviour for the local library service."""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request

from .constants import (
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


class ProviderMetadataMixin:
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

    @staticmethod
    def netflix_content_id(destination: Any) -> str:
        """Turn an official Watchmode Netflix URL into LG's proven launch value."""
        candidate = str(destination or "").strip()
        parsed = urlsplit(candidate)
        if parsed.scheme not in {"http", "https", "nflx"}:
            raise ValueError("Netflix did not provide a usable TV destination for this title")
        host = parsed.netloc.lower()
        if parsed.scheme != "nflx" and not (host == "netflix.com" or host.endswith(".netflix.com")):
            raise ValueError("Netflix did not provide a usable TV destination for this title")
        match = re.search(r"/(?:watch|title)/(\d+)(?:/|$)", parsed.path)
        if not match:
            raise ValueError("Netflix did not provide a title ID that this TV can open")
        return f"m=https://www.netflix.com/watch/{match.group(1)}&source_type=4"

    @staticmethod
    def adult_title_key(media_type: str, tmdb_id: Any) -> str:
        media_type = str(media_type or "").strip().lower()
        if media_type not in {"movie", "tv"}:
            raise ValueError("Choose a film or TV series")
        try:
            identifier = int(tmdb_id)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid title") from None
        if identifier <= 0:
            raise ValueError("Choose a valid title")
        return f"{media_type}:{identifier}"

    def adult_viewing_store(self) -> dict[str, Any]:
        value = self.read_json(self.adult_viewing_path, {})
        if not isinstance(value, dict):
            value = {}
        for field in ("titles", "availability"):
            if not isinstance(value.get(field), dict):
                value[field] = {}
        value["schema_version"] = 1
        # Provider launches used to leave a prompt behind for the next visit.
        # Prompts are no longer part of the viewing model, and watched titles
        # belong in history rather than the unseen Watchlist.
        for item in value["titles"].values():
            if not isinstance(item, dict):
                continue
            item.pop("pending_confirmation", None)
            episode_states = item.get("episodes", {})
            has_watched_episode = isinstance(episode_states, dict) and any(
                isinstance(saved, dict) and saved.get("watched") is True
                for saved in episode_states.values())
            if item.get("manual_state") == "watched" or has_watched_episode:
                item["watchlisted"] = False
        # Watchmode's free-data terms require old cached provider data to be
        # removed, rather than retained forever as ordinary application state.
        cutoff = time.time() - ADULT_PROVIDER_MAX_CACHE_SECONDS
        value["availability"] = {
            key: item for key, item in value["availability"].items()
            if isinstance(item, dict) and float(item.get("checked", 0) or 0) >= cutoff
        }
        return value

    def write_adult_viewing_store(self, value: dict[str, Any]) -> None:
        value["updated"] = time.time()
        self.write_json(self.adult_viewing_path, value)

    @staticmethod
    def adult_title_summary(value: dict[str, Any], media_type: str) -> dict[str, Any]:
        date = str(value.get("release_date" if media_type == "movie" else
                             "first_air_date", ""))
        return {
            "media_type": media_type,
            "tmdb_id": int(value.get("id", 0) or 0),
            "title": str(value.get("title" if media_type == "movie" else "name", "")),
            "original_title": str(value.get("original_title" if media_type == "movie"
                                             else "original_name", "")),
            "year": date[:4],
            "overview": str(value.get("overview", "")),
            "poster_path": str(value.get("poster_path") or ""),
            "backdrop_path": str(value.get("backdrop_path") or ""),
        }

    @staticmethod
    def adult_next_episode_after_progress(
            episodes: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Continue after the furthest watched episode, not from an earlier gap."""
        ordered = sorted(episodes, key=lambda value: (
            int(value.get("season", 0) or 0),
            int(value.get("episode", 0) or 0),
        ))
        last_watched = max(
            (index for index, value in enumerate(ordered) if value.get("watched") is True),
            default=-1,
        )
        next_index = last_watched + 1
        return ordered[next_index] if next_index < len(ordered) else None

    def adult_local_title_index(self) -> dict[str, dict[str, Any]]:
        """Map confirmed Adult TV media to one canonical TMDB title."""
        index: dict[str, dict[str, Any]] = {}
        for film in self.adult_library():
            metadata = film.get("metadata", {})
            try:
                key = self.adult_title_key("movie", metadata.get("tmdb_id"))
            except ValueError:
                continue
            index[key] = {
                "kind": "film", "path": film["path"],
                "title": str(metadata.get("title") or film["display_name"]),
                "poster": str(metadata.get("poster") or ""),
                "position": float(film.get("remote_position", 0) or 0),
                "duration": float(film.get("remote_duration", 0) or 0),
                "last_watched": float(film.get("remote_last_watched", 0) or 0),
                "browser_ready": film.get("browser_ready") is not False,
            }
        for series in self.adult_series_library():
            metadata = series.get("metadata", {})
            try:
                key = self.adult_title_key("tv", metadata.get("tmdb_id"))
            except ValueError:
                continue
            episodes = series.get("episodes", [])
            next_episode = self.adult_next_episode_after_progress(episodes)
            index[key] = {
                "kind": "series", "series": series["id"],
                "title": str(metadata.get("title") or series["title"]),
                "poster": str(metadata.get("poster") or ""),
                "episode_count": len(episodes),
                "watched_count": int(series.get("watched_count", 0) or 0),
                "next_episode": next_episode,
            }
        return index

    def adult_discovery(self, query: str) -> dict[str, Any]:
        query = str(query or "").strip()
        if len(query) < 2:
            return {"query": query, "results": []}
        response = self.tmdb_request("search/multi", {
            "query": query[:120], "include_adult": "false", "language": "en-GB",
            "page": 1,
        })
        local = self.adult_local_title_index()
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for value in response.get("results", []) if isinstance(response, dict) else []:
            if not isinstance(value, dict) or value.get("media_type") not in {"movie", "tv"}:
                continue
            item = self.adult_title_summary(value, str(value["media_type"]))
            if not item["tmdb_id"] or not item["title"]:
                continue
            key = self.adult_title_key(item["media_type"], item["tmdb_id"])
            item.update({"key": key, "local": local.get(key),
                         "on_mabeltv": key in local})
            results.append(item)
            seen.add(key)
            if len(results) >= 20:
                break
        # Unmatched local files still remain findable; they simply cannot have
        # provider availability until the parent confirms their metadata.
        lowered = query.casefold()
        for film in self.adult_library():
            if film.get("metadata", {}).get("tmdb_id") or lowered not in str(
                    film.get("display_name", "")).casefold():
                continue
            results.insert(0, {
                "key": f"local:{film['library_id']}", "media_type": "movie",
                "tmdb_id": 0, "title": film["display_name"], "year": "",
                "overview": "This local film needs a metadata match before streaming services can be checked.",
                "poster_path": "", "backdrop_path": "", "on_mabeltv": True,
                "local": {"kind": "film", "path": film["path"]},
            })
        return {"query": query, "results": results,
                "attribution": "Streaming availability data from TMDB and JustWatch"}

    def adult_title_detail(self, media_type: str, tmdb_id: Any) -> dict[str, Any]:
        key = self.adult_title_key(media_type, tmdb_id)
        media_type, raw_id = key.split(":", 1)
        value = self.tmdb_request(f"{media_type}/{raw_id}", {"language": "en-GB"})
        if not isinstance(value, dict):
            raise ValueError("That title could not be loaded")
        summary = self.adult_title_summary(value, media_type)
        providers = self.tmdb_request(f"{media_type}/{raw_id}/watch/providers")
        region = providers.get("results", {}).get("GB", {}) \
            if isinstance(providers, dict) else {}
        groups = []
        for provider_type, label in (("flatrate", "Stream"), ("free", "Free"),
                                     ("ads", "With ads"), ("rent", "Rent"),
                                     ("buy", "Buy")):
            for provider in region.get(provider_type, []) if isinstance(region, dict) else []:
                if not isinstance(provider, dict):
                    continue
                groups.append({
                    "provider_id": int(provider.get("provider_id", 0) or 0),
                    "name": str(provider.get("provider_name", "")),
                    "type": provider_type, "label": label,
                    "logo_path": str(provider.get("logo_path") or ""),
                })
        runtime = value.get("runtime") if media_type == "movie" else (
            value.get("episode_run_time", [None]) or [None])[0]
        local_titles = self.adult_local_title_index()
        local_title = local_titles.get(key)
        local_episode_states: dict[str, dict[str, Any]] = {}
        if isinstance(local_title, dict) and local_title.get("kind") == "series":
            local_series = next(
                (series for series in self.adult_series_library()
                 if series.get("id") == local_title.get("series")), None)
            if isinstance(local_series, dict):
                local_episode_states = {
                    f"{episode.get('season')}:{episode.get('episode')}": episode
                    for episode in local_series.get("episodes", [])
                    if isinstance(episode, dict)
                }
        detail = summary | {
            "key": key, "runtime": int(runtime or 0),
            "genres": [str(item.get("name", "")) for item in value.get("genres", [])
                       if isinstance(item, dict) and item.get("name")],
            "seasons": [{"number": int(item.get("season_number", 0) or 0),
                         "name": str(item.get("name", "")),
                         "episodes": int(item.get("episode_count", 0) or 0),
                         "poster_path": str(item.get("poster_path") or ""),
                         "overview": str(item.get("overview") or ""),
                         "air_date": str(item.get("air_date") or "")}
                        for item in value.get("seasons", []) if isinstance(item, dict)
                        and int(item.get("season_number", 0) or 0) > 0],
            "providers": groups, "provider_link": str(region.get("link", ""))
            if isinstance(region, dict) else "", "region": "GB",
            "on_mabeltv": key in local_titles,
            "local": local_title,
            "attribution": "Streaming availability data from TMDB and JustWatch",
        }
        with self.config_lock:
            store = self.adult_viewing_store()
            state = store["titles"].get(key, {})
            detail["viewing"] = state if isinstance(state, dict) else {}
        episode_states = detail["viewing"].get("episodes", {}) \
            if isinstance(detail["viewing"], dict) else {}
        if not isinstance(episode_states, dict):
            episode_states = {}
        rewatch_episode_states = detail["viewing"].get("rewatch_episodes", {}) \
            if isinstance(detail["viewing"], dict) else {}
        if not isinstance(rewatch_episode_states, dict):
            rewatch_episode_states = {}
        for season in detail["seasons"]:
            season["watched_count"] = sum(
                (isinstance(episode_states.get(f"{season['number']}:{episode}"), dict)
                 and episode_states[f"{season['number']}:{episode}"].get("watched") is True)
                or local_episode_states.get(
                    f"{season['number']}:{episode}", {}).get("watched") is True
                for episode in range(1, int(season.get("episodes", 0) or 0) + 1))
        rewatching = bool(detail["viewing"].get("series_watching")) and \
            detail["viewing"].get("series_watching_mode") == "rewatch"
        states = rewatch_episode_states if rewatching else episode_states
        available = []
        for season in detail["seasons"]:
            for episode in range(1, int(season.get("episodes", 0) or 0) + 1):
                episode_key = f"{season['number']}:{episode}"
                saved = states.get(episode_key, {})
                locally_watched = not rewatching and local_episode_states.get(
                    episode_key, {}).get("watched") is True
                available.append({
                    "season": season["number"], "episode": episode,
                    "watched": (isinstance(saved, dict)
                                and saved.get("watched") is True) or locally_watched,
                })
        candidate = self.adult_next_episode_after_progress(available)
        next_episode = None
        if candidate:
            next_episode = {
                "season": candidate["season"], "episode": candidate["episode"],
                "title": "", "source": "streaming", "rewatch": rewatching,
            }
        detail["next_episode"] = next_episode
        return detail

    def adult_title_season(self, tmdb_id: Any, season_number: Any) -> dict[str, Any]:
        key = self.adult_title_key("tv", tmdb_id)
        try:
            number = int(season_number)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid season") from None
        if number < 1:
            raise ValueError("Choose a valid season")
        value = self.tmdb_request(f"tv/{key.split(':', 1)[1]}/season/{number}",
                                  {"language": "en-GB"})
        if not isinstance(value, dict):
            raise ValueError("That season could not be loaded")
        with self.config_lock:
            store = self.adult_viewing_store()
            state = store["titles"].get(key, {})
            episode_states = state.get("episodes", {}) if isinstance(state, dict) else {}
            if not isinstance(episode_states, dict):
                episode_states = {}
            rewatch_episode_states = state.get("rewatch_episodes", {}) \
                if isinstance(state, dict) else {}
            if not isinstance(rewatch_episode_states, dict):
                rewatch_episode_states = {}
        local_title = self.adult_local_title_index().get(key, {})
        local_episode_states: dict[str, dict[str, Any]] = {}
        if isinstance(local_title, dict) and local_title.get("kind") == "series":
            local_series = next(
                (series for series in self.adult_series_library()
                 if series.get("id") == local_title.get("series")), None)
            if isinstance(local_series, dict):
                local_episode_states = {
                    f"{episode.get('season')}:{episode.get('episode')}": episode
                    for episode in local_series.get("episodes", [])
                    if isinstance(episode, dict)
                }
        episodes = []
        for item in value.get("episodes", []):
            if not isinstance(item, dict):
                continue
            episode = int(item.get("episode_number", 0) or 0)
            if episode < 1:
                continue
            episode_key = f"{number}:{episode}"
            saved = episode_states.get(episode_key, {})
            local_saved = local_episode_states.get(episode_key, {})
            episodes.append({
                "number": episode,
                "name": str(item.get("name") or f"Episode {episode}"),
                "air_date": str(item.get("air_date") or ""),
                "runtime": int(item.get("runtime", 0) or 0),
                "overview": str(item.get("overview") or ""),
                "still_path": str(item.get("still_path") or ""),
                "watched": (bool(saved.get("watched"))
                            if isinstance(saved, dict) else False)
                           or local_saved.get("watched") is True,
                "rewatch_watched": bool(rewatch_episode_states.get(
                    episode_key, {}).get("watched"))
                if isinstance(rewatch_episode_states.get(episode_key), dict) else False,
            })
        return {"key": key, "season": number,
                "name": str(value.get("name") or f"Season {number}"),
                "overview": str(value.get("overview") or ""),
                "poster_path": str(value.get("poster_path") or ""),
                "episodes": episodes}

    @staticmethod
    def normalise_watchmode_sources(values: Any) -> list[dict[str, Any]]:
        def safe_destination(raw_value: Any) -> str:
            destination = str(raw_value or "").strip()
            if not destination or len(destination) > 4096:
                return ""
            parsed = urlsplit(destination)
            scheme = parsed.scheme.lower()
            if scheme in {"http", "https"}:
                if not parsed.netloc:
                    return ""
                # A few UK providers still arrive from Watchmode as http links.
                # Upgrade them so the exact title URL is retained safely and can
                # participate in iOS/Android Universal Link hand-off.
                if scheme == "http":
                    destination = parsed._replace(scheme="https").geturl()
                return destination
            # Paid Watchmode plans can return provider app schemes. Preserve
            # those trusted API values, while rejecting browser-executable and
            # local-file schemes.
            if scheme and scheme not in {"javascript", "data", "file", "blob"} and \
                    all(character not in destination for character in "\r\n\t"):
                return destination
            return ""

        sources: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for value in values if isinstance(values, list) else []:
            if not isinstance(value, dict):
                continue
            web_url = safe_destination(value.get("web_url"))
            ios_url = safe_destination(value.get("ios_url"))
            android_url = safe_destination(value.get("android_url"))
            if not any((web_url, ios_url, android_url)):
                continue
            name = str(value.get("name") or "Streaming service")
            source_type = str(value.get("type") or "sub").lower()
            marker = (name.casefold(), source_type)
            if marker in seen:
                continue
            seen.add(marker)
            sources.append({
                "source_id": int(value.get("source_id", 0) or 0),
                "name": name, "type": source_type,
                "region": str(value.get("region") or "GB").upper(),
                "web_url": web_url, "ios_url": ios_url,
                "android_url": android_url,
                "format": str(value.get("format") or ""),
            })
        return sources

    def adult_streaming_links(self, media_type: str, tmdb_id: Any,
                              refresh: bool = False) -> dict[str, Any]:
        key = self.adult_title_key(media_type, tmdb_id)
        now = time.time()
        with self.config_lock:
            store = self.adult_viewing_store()
            cached = store["availability"].get(key, {})
            if not refresh and isinstance(cached, dict) and \
                    cached.get("link_schema") == 2 and \
                    now - float(cached.get("checked", 0) or 0) < ADULT_PROVIDER_CACHE_SECONDS:
                return dict(cached)
        external_id = f"{key.split(':', 1)[0]}-{key.split(':', 1)[1]}"
        values = self.watchmode_request(
            f"title/{external_id}/sources/", {"regions": "GB"})
        result = {"key": key, "region": "GB", "checked": now, "link_schema": 2,
                  "sources": self.normalise_watchmode_sources(values),
                  "provider": "Watchmode"}
        with self.config_lock:
            store = self.adult_viewing_store()
            store["availability"][key] = result
            self.write_adult_viewing_store(store)
        return result

    def adult_viewing_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        key = self.adult_title_key(payload.get("media_type"), payload.get("tmdb_id"))
        action = str(payload.get("action", ""))
        allowed = {"watchlist", "rewatch", "up_next", "move_up", "move_down",
                   "part_watched", "watched", "not_watched", "dropped",
                   "watching", "launched", "remove", "episode_watched",
                   "season_watched"}
        if action not in allowed:
            raise ValueError("Choose a valid viewing action")
        now = time.time()
        with self.config_lock:
            store = self.adult_viewing_store()
            current = store["titles"].get(key, {})
            if not isinstance(current, dict):
                current = {}
            for field in ("title", "year", "poster_path", "overview"):
                if field in payload:
                    current[field] = str(payload.get(field) or "")[:1000]
            try:
                current["runtime"] = max(0, int(payload.get("runtime", current.get("runtime", 0)) or 0))
            except (TypeError, ValueError):
                current["runtime"] = 0
            current.update({"media_type": key.split(":", 1)[0],
                            "tmdb_id": int(key.split(":", 1)[1]), "updated": now})
            episodes = current.get("episodes", {})
            if not isinstance(episodes, dict):
                episodes = {}
            has_completed = current.get("manual_state") == "watched" or \
                bool(current.get("history"))
            has_progress = any(
                    isinstance(saved, dict) and saved.get("watched") is True
                    for saved in episodes.values())
            local_title = self.adult_local_title_index().get(key, {})
            has_progress = has_progress or (
                isinstance(local_title, dict)
                and int(local_title.get("watched_count", 0) or 0) > 0)
            if action == "watchlist":
                enabled = bool(payload.get("enabled", True))
                if enabled and has_completed:
                    raise ValueError("You've already seen this. Add it to Rewatch instead.")
                if enabled and has_progress:
                    raise ValueError(
                        "This series is already in progress. Continue it from Watching or Up Next.")
                current["watchlisted"] = enabled
                current["watchlist_updated"] = now
            elif action == "rewatch":
                enabled = bool(payload.get("enabled", True))
                if enabled and not has_completed:
                    raise ValueError("Mark this watched before adding it to Rewatch")
                current["rewatch"] = enabled
                current["rewatch_updated"] = now
            elif action == "up_next":
                enabled = bool(payload.get("enabled", True))
                current["up_next"] = enabled
                if enabled:
                    ranks = [int(value.get("up_next_rank", 0) or 0)
                             for value in store["titles"].values()
                             if isinstance(value, dict) and value.get("up_next")]
                    current["up_next_rank"] = max(ranks, default=0) + 1
            elif action in {"part_watched", "watched", "not_watched", "dropped"}:
                previous_manual_state = current.get("manual_state")
                current["manual_state"] = action
                current["viewing_updated"] = now
                if action == "watched":
                    current.setdefault("history", []).append(now)
                    current["watchlisted"] = False
                    current["up_next"] = False
                    if current.get("series_watching") and \
                            current.get("series_watching_mode") == "rewatch":
                        current["rewatch_completed"] = now
                    current["series_watching"] = False
                elif action == "not_watched" and previous_manual_state == "watched":
                    history = current.get("history", [])
                    if isinstance(history, list) and history:
                        history.pop()
            elif action in {"move_up", "move_down"}:
                queued = sorted(
                    ((stored_key, stored) for stored_key, stored in store["titles"].items()
                     if isinstance(stored, dict) and stored.get("up_next")),
                    key=lambda pair: int(pair[1].get("up_next_rank", 999999) or 999999))
                position = next((index for index, pair in enumerate(queued)
                                 if pair[0] == key), -1)
                target = position + (-1 if action == "move_up" else 1)
                if position >= 0 and 0 <= target < len(queued):
                    other_key, other = queued[target]
                    current_rank = int(current.get("up_next_rank", position + 1) or position + 1)
                    other_rank = int(other.get("up_next_rank", target + 1) or target + 1)
                    current["up_next_rank"], other["up_next_rank"] = other_rank, current_rank
                    store["titles"][other_key] = other
            elif action == "watching":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Watching is available for TV series")
                enabled = bool(payload.get("enabled", True))
                current["series_watching"] = enabled
                current["series_watching_updated"] = now
                if enabled:
                    requested_mode = str(payload.get("mode") or "").strip()
                    if requested_mode not in {"first_watch", "rewatch"}:
                        requested_mode = "rewatch" \
                            if current.get("manual_state") == "watched" else "first_watch"
                    current["series_watching_mode"] = requested_mode
                    if requested_mode == "rewatch" and current.get("rewatch_completed"):
                        current["rewatch_episodes"] = {}
                        current.pop("rewatch_completed", None)
                    if not current.get("up_next"):
                        ranks = [int(value.get("up_next_rank", 0) or 0)
                                 for value in store["titles"].values()
                                 if isinstance(value, dict) and value.get("up_next")]
                        current["up_next_rank"] = max(ranks, default=0) + 1
                    current["up_next"] = True
            elif action == "launched":
                current["last_launched"] = now
                current["last_provider"] = str(
                    payload.get("provider") or "Streaming service")[:100]
            elif action == "episode_watched":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Episodes are only available for TV series")
                try:
                    season = int(payload.get("season"))
                    episode = int(payload.get("episode"))
                except (TypeError, ValueError):
                    raise ValueError("Choose a valid episode") from None
                if season < 1 or episode < 1 or not isinstance(payload.get("watched"), bool):
                    raise ValueError("Choose a valid episode status")
                rewatch = payload.get("rewatch") is True
                if rewatch and (not current.get("series_watching") or
                                current.get("series_watching_mode") != "rewatch"):
                    raise ValueError("Start watching this series again before tracking a rewatch")
                state_field = "rewatch_episodes" if rewatch else "episodes"
                episodes = current.setdefault(state_field, {})
                if not isinstance(episodes, dict):
                    episodes = {}
                    current[state_field] = episodes
                episodes[f"{season}:{episode}"] = {"watched": payload["watched"], "updated": now}
                if payload["watched"] and not rewatch:
                    current["watchlisted"] = False
            elif action == "season_watched":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Series are only available for TV titles")
                try:
                    season = int(payload.get("season"))
                    episode_count = int(payload.get("episode_count"))
                except (TypeError, ValueError):
                    raise ValueError("Choose a valid series") from None
                watched = payload.get("watched")
                if season < 1 or episode_count < 1 or episode_count > 1000 or \
                        not isinstance(watched, bool):
                    raise ValueError("Choose a valid series status")
                rewatch = payload.get("rewatch") is True
                if rewatch and (not current.get("series_watching") or
                                current.get("series_watching_mode") != "rewatch"):
                    raise ValueError("Start watching this series again before tracking a rewatch")
                state_field = "rewatch_episodes" if rewatch else "episodes"
                episodes = current.setdefault(state_field, {})
                if not isinstance(episodes, dict):
                    episodes = {}
                    current[state_field] = episodes
                for episode in range(1, episode_count + 1):
                    episodes[f"{season}:{episode}"] = {"watched": watched, "updated": now}
                if watched and not rewatch:
                    current["watchlisted"] = False
            elif action == "remove":
                current["watchlisted"] = False
                current["rewatch"] = False
                current["up_next"] = False
                current["series_watching"] = False
                current["manual_state"] = "not_watched"
            current.pop("pending_confirmation", None)
            store["titles"][key] = current
            self.write_adult_viewing_store(store)
        if action in {"episode_watched", "season_watched"} and \
                payload.get("rewatch") is not True and \
                isinstance(local_title, dict) and local_title.get("kind") == "series":
            series_id = str(local_title.get("series") or "")
            local_series = next(
                (series for series in self.adult_series_library()
                 if series.get("id") == series_id), None)
            if isinstance(local_series, dict):
                if action == "episode_watched":
                    target = next(
                        (value for value in local_series.get("episodes", [])
                         if int(value.get("season", 0) or 0) == season
                         and int(value.get("episode", 0) or 0) == episode), None)
                    if isinstance(target, dict) and target.get("path"):
                        self.set_adult_episode_watched(
                            series_id, str(target["path"]), bool(payload["watched"]))
                else:
                    has_local_season = any(
                        int(value.get("season", 0) or 0) == season
                        for value in local_series.get("episodes", []))
                    if has_local_season:
                        self.set_adult_season_watched(
                            series_id, season, bool(payload["watched"]))
        return {"ok": True, "key": key, "viewing": current}

    def adult_viewing(self) -> dict[str, Any]:
        local = self.adult_local_title_index()
        with self.config_lock:
            store = self.adult_viewing_store()
            changed = False
            for key, local_value in local.items():
                has_local_progress = float(local_value.get("position", 0) or 0) > 0 or (
                    local_value.get("kind") == "series"
                    and int(local_value.get("watched_count", 0) or 0) > 0)
                if not has_local_progress:
                    stored = store["titles"].get(key)
                    if isinstance(stored, dict) and "local_progress" in stored:
                        stored.pop("local_progress", None)
                        changed = True
                    continue
                item = store["titles"].setdefault(key, {})
                if not isinstance(item, dict):
                    item = {}
                    store["titles"][key] = item
                item.update({"media_type": key.split(":", 1)[0],
                             "tmdb_id": int(key.split(":", 1)[1]),
                             "title": local_value.get("title", ""),
                             "local_progress": local_value})
                changed = True
            if changed:
                self.write_adult_viewing_store(store)
            items = []
            for key, item in store["titles"].items():
                if not isinstance(item, dict):
                    continue
                value = dict(item)
                value.update({"key": key, "on_mabeltv": key in local,
                              "local": local.get(key)})
                items.append(value)
        return {"items": items, "watchmode_configured": bool(self.watchmode_key()),
                "region": "GB"}

    @staticmethod
    def tmdb_title_query(value: str) -> tuple[str, int | None]:
        title = re.sub(r"[._]+", " ", str(value or "")).strip()
        # get_iplayer output names can end in a BBC PID plus a quality label.
        # Neither is part of the film title and both make an otherwise exact
        # TMDB search much less reliable.
        title = re.sub(
            r"\s*-\s*[a-z][a-z0-9]{7}\s+(?:original|technical)\s*$",
            "", title, flags=re.IGNORECASE).strip()
        title = re.sub(
            r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
            "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        return title, year

    def channel_film_search(self, item: Path) -> tuple[str, list[dict[str, Any]]]:
        """Return selectable TMDB matches for one MabelTV film."""
        title, year = self.tmdb_title_query(self.display_name(item.name))
        parameters: dict[str, Any] = {
            "query": title, "include_adult": "false", "language": "en-GB",
        }
        if year:
            parameters["year"] = year
        response = self.tmdb_request("search/movie", parameters)
        matches = response.get("results", []) if isinstance(response, dict) else []
        results = []
        for value in matches[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]),
                "title": str(value.get("title", "")),
                "original_title": str(value.get("original_title", "")),
                "year": str(value.get("release_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return title, results

    def channel_film_metadata_for_id(
            self, channel: dict[str, Any], item: Path, tmdb_id: int) -> dict[str, Any]:
        """Cache one explicitly selected TMDB match for a MabelTV film."""
        number = int(channel["number"])
        details = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
        poster_name = self.cache_channel_artwork(
            str(details.get("poster_path") or ""),
            f"mabel-film-{number}-{tmdb_id}.jpg")
        return {
            "tmdb_id": tmdb_id,
            "title": str(details.get("title") or self.display_name(item.name)),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("release_date") or "")[:4],
            "poster": poster_name,
            "updated": time.time(), "provider": "TMDB",
        }

    def channel_film_metadata(self, channel: dict[str, Any], item: Path) -> dict[str, Any] | None:
        """Find and cache the best automatic TMDB match for a bulk refresh."""
        _, matches = self.channel_film_search(item)
        match = next((value for value in matches if value.get("id")), None)
        if not isinstance(match, dict):
            return None
        tmdb_id = int(match["id"])
        return self.channel_film_metadata_for_id(channel, item, tmdb_id)

    def cache_channel_artwork(self, remote_path: str, file_name: str,
                              *, backdrop: bool = False) -> str:
        if (not remote_path or not re.fullmatch(
                r"mabel-(?:show|film)-[0-9]+-[0-9]+\.jpg", file_name)):
            return ""
        destination = self.channel_artwork_root / file_name
        try:
            base = TMDB_BACKDROP_IMAGE_BASE_URL if backdrop else TMDB_IMAGE_BASE_URL
            request = Request(base + remote_path,
                              headers={"User-Agent": "MabelTV/0.2.5"})
            with self._open_url(request, timeout=15) as response:
                data = response.read(10 * 1024 * 1024)
            temporary = destination.with_suffix(".jpg.new")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return file_name
        except (HTTPError, URLError, TimeoutError, OSError):
            return ""

    def channel_show_search(self, channel: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Return parent-selectable TMDB matches for one series channel."""
        query = str(channel.get("name", "")).strip()
        response = self.tmdb_request("search/tv", {
            "query": query, "include_adult": "false", "language": "en-GB",
        })
        matches = response.get("results", []) if isinstance(response, dict) else []
        results = []
        for value in matches[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]),
                "title": str(value.get("name", "")),
                "original_title": str(value.get("original_name", "")),
                "year": str(value.get("first_air_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return query, results

    def channel_show_metadata_for_id(
            self, channel: dict[str, Any], tmdb_id: int) -> dict[str, Any]:
        """Cache one explicitly selected TMDB match for a series channel."""
        number = int(channel["number"])
        details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
        remote_art = str(details.get("backdrop_path") or details.get("poster_path") or "")
        art_name = self.cache_channel_artwork(
            remote_art, f"mabel-show-{number}-{tmdb_id}.jpg",
            backdrop=bool(details.get("backdrop_path")))
        return {
            "tmdb_id": tmdb_id,
            "title": str(details.get("name") or channel.get("name", "")),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("first_air_date") or "")[:4],
            "artwork": art_name,
            "updated": time.time(), "provider": "TMDB",
        }

    def cache_adult_series_artwork(self, remote_path: str, file_name: str,
                                   *, backdrop: bool = False) -> str:
        if not remote_path or not re.fullmatch(
                r"adult-(?:series-[a-f0-9]{32}-[0-9]+|episode-[a-f0-9]{32}-[0-9]+-[0-9]+)\.jpg",
                file_name):
            return ""
        try:
            base = TMDB_BACKDROP_IMAGE_BASE_URL if backdrop else TMDB_IMAGE_BASE_URL
            request = Request(base + remote_path,
                              headers={"User-Agent": "MabelTV/0.2.5"})
            with self._open_url(request, timeout=15) as response:
                data = response.read(10 * 1024 * 1024)
            destination = self.adult_series_artwork_root / file_name
            temporary = destination.with_suffix(".jpg.new")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return file_name
        except (HTTPError, URLError, TimeoutError, OSError):
            return ""

    def adult_series_search(self, payload: dict[str, Any]) -> dict[str, Any]:
        series_id = str(payload.get("series", ""))
        states = self.adult_series_states()
        series = states["series"].get(series_id)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        query = str(payload.get("title") or series.get("title") or "").strip()
        response = self.tmdb_request("search/tv", {
            "query": query, "include_adult": "false", "language": "en-GB",
        })
        results = []
        for value in response.get("results", [])[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]), "title": str(value.get("name", "")),
                "original_title": str(value.get("original_name", "")),
                "year": str(value.get("first_air_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return {"ok": True, "series": series_id, "query": query,
                "results": results}

    def adult_series_apply(self, payload: dict[str, Any]) -> dict[str, Any]:
        series_id = str(payload.get("series", ""))
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            tmdb_id = 0
        if tmdb_id <= 0:
            raise ValueError("Choose a TMDB series match")
        states = self.adult_series_states()
        series = states["series"].get(series_id)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
        poster = self.cache_adult_series_artwork(
            str(details.get("poster_path") or ""),
            f"adult-series-{series_id}-{tmdb_id}.jpg")
        backdrop = self.cache_adult_series_artwork(
            str(details.get("backdrop_path") or ""),
            f"adult-series-{series_id}-{tmdb_id}.jpg", backdrop=True) \
            if not poster else ""
        series["metadata"] = {
            "tmdb_id": tmdb_id,
            "title": str(details.get("name") or series.get("title") or "Series"),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("first_air_date") or "")[:4],
            "poster": poster or backdrop,
            "updated": time.time(), "provider": "TMDB",
        }
        root = self.adult_series_root / series_id
        files = [item for item in root.rglob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS]
        seasons = sorted({self.adult_episode_identity(item)["season"] for item in files})
        episode_details: dict[tuple[int, int], dict[str, Any]] = {}
        for season_number in seasons:
            response = self.tmdb_request(
                f"tv/{tmdb_id}/season/{season_number}", {"language": "en-GB"})
            for episode in response.get("episodes", []):
                if not isinstance(episode, dict):
                    continue
                number = int(episode.get("episode_number") or 0)
                if number <= 0:
                    continue
                still = self.cache_adult_series_artwork(
                    str(episode.get("still_path") or ""),
                    f"adult-episode-{series_id}-{season_number}-{number}.jpg",
                    backdrop=True)
                episode_details[(season_number, number)] = {
                    "title": str(episode.get("name") or f"Episode {number}"),
                    "overview": str(episode.get("overview") or ""),
                    "air_date": str(episode.get("air_date") or ""),
                    "season_number": season_number,
                    "episode_number": number,
                    "still": still,
                }
        for ordinal, source in enumerate(sorted(files), 1):
            parsed = self.adult_episode_identity(source, ordinal)
            metadata = episode_details.get((parsed["season"], parsed["episode"]))
            if metadata:
                relative = source.relative_to(root).as_posix()
                key = f"{series_id}/{relative}"
                episode_state = states["episodes"].get(key, {})
                if not isinstance(episode_state, dict):
                    episode_state = {}
                episode_state["metadata"] = metadata
                states["episodes"][key] = episode_state
        states["series"][series_id] = series
        self.write_adult_series_states(states)
        return {"ok": True, "series": series_id,
                "metadata": series["metadata"],
                "episodes_matched": len(episode_details)}

    def adult_series_artwork(self, name: str) -> Path:
        if not re.fullmatch(
                r"adult-(?:series-[a-f0-9]{32}-[0-9]+|episode-[a-f0-9]{32}-[0-9]+-[0-9]+)\.jpg",
                name):
            raise ValueError("Series artwork not found")
        path = self.adult_series_artwork_root / name
        if not path.is_file():
            raise ValueError("Series artwork not found")
        return path

    def refresh_channel_show_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Search or apply a parent-selected match for one series channel."""
        try:
            channel = self.channel(int(payload.get("channel", 0)))
        except (TypeError, ValueError):
            raise ValueError("Choose a valid show channel") from None
        if self.channel_content_type(channel) != "shows":
            raise ValueError("Channel metadata is only available for show channels")
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            raise ValueError("Choose a TMDB match") from None
        if tmdb_id <= 0:
            query, results = self.channel_show_search(channel)
            return {"ok": True, "channel": int(channel["number"]),
                    "query": query, "results": results}

        metadata = self.channel_show_metadata_for_id(channel, tmdb_id)
        with self.config_lock:
            states = self.channel_media_states()
            channels = states.get("channels", {})
            if not isinstance(channels, dict):
                channels = {}
            channels[str(channel["number"])] = metadata
            states.update({"channels": channels, "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "channel": int(channel["number"]),
                "metadata": metadata}

    def refresh_channel_metadata(self) -> dict[str, Any]:
        """Cache one show image per series channel and posters for film channels."""
        states = self.channel_media_states()
        channels_state = states.get("channels", {})
        programmes_state = states.get("programmes", {})
        if not isinstance(channels_state, dict):
            channels_state = {}
        if not isinstance(programmes_state, dict):
            programmes_state = {}
        updated = 0
        skipped = 0
        for channel in self.channels():
            number = int(channel["number"])
            content_type = self.channel_content_type(channel)
            if content_type != "films":
                _, matches = self.channel_show_search(channel)
                match = next((value for value in matches if value.get("id")), None)
                if not isinstance(match, dict):
                    skipped += 1
                    continue
                tmdb_id = int(match["id"])
                channels_state[str(number)] = self.channel_show_metadata_for_id(
                    channel, tmdb_id)
                updated += 1
                continue

            folder = self.media_root / str(channel["folder"])
            candidates = sorted(
                (item for item in folder.glob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS),
                key=lambda path: path.name.casefold()) if folder.is_dir() else []
            for item in candidates:
                metadata = self.channel_film_metadata(channel, item)
                if metadata is None:
                    skipped += 1
                    continue
                programmes_state[self.channel_programme_key(number, item.name)] = metadata
                updated += 1
        states.update({"channels": channels_state, "programmes": programmes_state,
                       "updated": time.time()})
        self.write_channel_media_states(states)
        return {"ok": True, "updated": updated, "skipped": skipped}

    def refresh_channel_programme_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Search or apply a parent-selected match for one MabelTV film."""
        try:
            channel = self.channel(int(payload.get("channel", 0)))
        except (TypeError, ValueError):
            raise ValueError("Choose a valid film channel") from None
        if self.channel_content_type(channel) != "films":
            raise ValueError("Metadata refresh is only available for film channels")
        source = self.safe_media_path(channel, str(payload.get("file", "")))
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That film is no longer in this channel")
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            raise ValueError("Choose a TMDB match") from None
        if tmdb_id <= 0:
            query, results = self.channel_film_search(source)
            return {"ok": True, "channel": int(channel["number"]),
                    "file": source.name, "query": query, "results": results}

        metadata = self.channel_film_metadata_for_id(channel, source, tmdb_id)
        with self.config_lock:
            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            if not isinstance(programmes, dict):
                programmes = {}
            programmes[self.channel_programme_key(int(channel["number"]), source.name)] = metadata
            states.update({"programmes": programmes, "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "channel": int(channel["number"]),
                "file": source.name, "metadata": metadata}

    def channel_artwork(self, name: str) -> Path:
        if not re.fullmatch(r"mabel-(?:show|film)-[0-9]+-[0-9]+\.jpg", name):
            raise ValueError("Artwork not found")
        path = self.channel_artwork_root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path

    def tmdb_search(self, payload: dict[str, Any]) -> dict[str, Any]:
        file_name = str(payload.get("file", ""))
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        title = str(payload.get("title", "")).strip()
        if not title:
            title = self.display_name(source.name)
            title = re.sub(r"[._]+", " ", title)
            title = re.sub(r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
                           "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        parameters: dict[str, Any] = {"query": title, "include_adult": "false", "language": "en-GB"}
        if year:
            parameters["year"] = year
        response = self.tmdb_request("search/movie", parameters)
        results = []
        for value in response.get("results", [])[:12]:
            results.append({
                "id": int(value.get("id", 0)), "title": str(value.get("title", "")),
                "original_title": str(value.get("original_title", "")),
                "year": str(value.get("release_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return {"file": file_name, "query": title, "results": results}

    def tmdb_apply(self, payload: dict[str, Any]) -> dict[str, Any]:
        file_name = str(payload.get("file", ""))
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        tmdb_id = int(payload.get("tmdb_id", 0))
        if tmdb_id <= 0:
            raise ValueError("Choose a TMDB match")
        value = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
        poster_path = str(value.get("poster_path") or "")
        poster_name = ""
        if poster_path:
            poster_name = f"tmdb-{tmdb_id}.jpg"
            destination = self.adult_artwork_root / poster_name
            try:
                request = Request(TMDB_IMAGE_BASE_URL + poster_path,
                                  headers={"User-Agent": "MabelTV/0.2.5"})
                with self._open_url(request, timeout=15) as response:
                    data = response.read(8 * 1024 * 1024)
                temporary = destination.with_suffix(".jpg.new")
                temporary.write_bytes(data)
                os.replace(temporary, destination)
            except (HTTPError, URLError, TimeoutError, OSError):
                poster_name = ""
        metadata = {
            "tmdb_id": tmdb_id, "title": str(value.get("title", "")),
            "original_title": str(value.get("original_title", "")),
            "year": str(value.get("release_date", ""))[:4],
            "overview": str(value.get("overview", "")),
            "runtime": int(value.get("runtime") or 0), "poster": poster_name,
            "updated": time.time(), "provider": "TMDB",
        }
        metadata["subtitles"] = self.fetch_automatic_subtitle(source, tmdb_id)
        states = self.adult_media_states()
        current = states.get(file_name, {})
        if not isinstance(current, dict):
            current = {}
        current["metadata"] = metadata
        states[file_name] = current
        self.write_adult_media_states(states)
        refreshed = self.refresh_tv()
        return {"ok": True, "file": file_name, "metadata": metadata,
                "refreshed": refreshed}

    def adult_artwork(self, name: str) -> Path:
        if not re.fullmatch(r"(?:tmdb-[1-9][0-9]*|adult-series-[a-f0-9]{32}-[1-9][0-9]*)\.jpg", name):
            raise ValueError("Artwork not found")
        root = self.adult_series_artwork_root if name.startswith("adult-series-") else self.adult_artwork_root
        path = root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path
