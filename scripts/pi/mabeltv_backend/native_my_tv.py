"""Loopback-only TV projections; persistent state remains in Library/SQLite."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
from typing import Any
from urllib.parse import quote


class NativeMyTvMixin:
    @staticmethod
    def _native_service(value: dict[str, Any]) -> dict[str, Any]:
        name = str(value.get("name") or "Streaming service")
        lowered = name.casefold()
        brands = (
            ("netflix", "Netflix", "netflix", "netflix-app.jpg"),
            ("apple", "Apple TV", "appletv", "apple-tv-app.jpg"),
            ("hbo", "Max", "", ""), ("max", "Max", "", ""),
            ("disney", "Disney+", "disney", "disney-plus-app.jpg"),
            ("paramount", "Paramount+", "paramount", "paramount-plus-app.jpg"),
            ("prime", "Prime Video", "prime", "prime-video-app.jpg"),
            ("amazon", "Prime Video", "prime", "prime-video-app.jpg"),
            ("iplayer", "BBC iPlayer", "iplayer", "bbc-iplayer-app.jpg"),
            ("bbc", "BBC iPlayer", "iplayer", "bbc-iplayer-app.jpg"),
            ("channel 4", "Channel 4", "channel4", "channel-4-app.jpg"),
            ("all 4", "Channel 4", "channel4", "channel-4-app.jpg"),
            ("itv", "ITVX", "itvx", "itvx-app.jpg"),
            ("sky", "Sky Go", "", "sky-go-app.jpg"),
            ("now", "NOW", "", "now-app.jpg"),
        )
        match = next((brand for brand in brands if brand[0] in lowered), None)
        label, shortcut, asset = match[1:] if match else (name, "", "")
        return {"name": label, "shortcut": shortcut, "asset": asset,
                "logo_path": str(value.get("logo_path") or ""),
                "destination": str(value.get("android_url") or value.get("web_url") or "")}

    def _native_service_choices(self, value: dict[str, Any]) -> dict[str, Any]:
        choices: dict[str, dict[str, Any]] = {}
        for source in value.get("provider_result", {}).get("sources", []) + value.get("providers", []):
            if not isinstance(source, dict) or str(source.get("type") or "").lower() \
                    not in {"sub", "free", "tve", "ads", "flatrate"}:
                continue
            entry = self._native_service(source)
            if entry["shortcut"] == "netflix" and entry["destination"]:
                try:
                    self.netflix_content_id(entry["destination"])
                except ValueError:
                    entry["destination"] = ""
            key = entry["shortcut"] or entry["name"].casefold()
            old = choices.get(key)
            if old is None or (not old["destination"] and entry["destination"]):
                choices[key] = entry
            elif not old["logo_path"]:
                old["logo_path"] = entry["logo_path"]
        services, other = [], []
        for entry in choices.values():
            installed = not value.get("apps_known") or entry["shortcut"] in value.get("available_apps", [])
            if entry["shortcut"] and installed:
                entry["action"] = "Open title" if entry["shortcut"] == "netflix" and entry["destination"] else "Open app"
                services.append(entry)
            else:
                entry["action"] = "Not installed on this TV" if entry["shortcut"] else "No supported TV app"
                entry["shortcut"] = ""
                other.append(entry)
        services.sort(key=lambda entry: (entry["name"] != "Netflix", entry["name"]))
        return {"services": services, "other_services": other}

    def native_my_tv_backdrop(self, media_type: str, tmdb_id: Any) -> dict[str, Any]:
        """Enrich a Continue card separately; home never waits for TMDB."""
        key = self.my_tv_title_key(media_type, tmdb_id)
        cache = getattr(self, "_native_my_tv_backdrops", {})
        if key not in cache:
            value = self.my_tv_cached_tmdb_request(key.replace(":", "/"), {"language": "en-GB"})
            cache[key] = str(value.get("backdrop_path") or "") if isinstance(value, dict) else ""
            self._native_my_tv_backdrops = cache
        return {"key": key, "backdrop_path": cache[key]}

    @staticmethod
    def _native_art_url(name: str, kind: str) -> str:
        return f"/api/native/my-tv/local-artwork/{kind}/{quote(name)}" if name else ""

    def native_my_tv_local_artwork(self, kind: str, name: str) -> Path:
        # Older metadata filenames are retained. Only images within these two
        # private artwork roots are allowed, never paths supplied by a client.
        if kind not in {"film", "series", "channel"} or not re.fullmatch(
                r"[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)", name):
            raise ValueError("Artwork not found")
        root = (self.my_tv_artwork_root if kind == "film" else
                self.my_tv_series_artwork_root if kind == "series" else self.channel_artwork_root)
        path = root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path

    def _native_episode(self, value: dict[str, Any], series_id: str,
                        player: dict[str, Any]) -> dict[str, Any]:
        library_id = str(value.get("library_id") or "")
        return {
            "season": int(value.get("season", 1) or 1),
            "number": int(value.get("episode", 1) or 1),
            "episode": int(value.get("episode", 1) or 1),
            "name": str(value.get("display_name") or value.get("name") or "Episode"),
            "overview": str(value.get("overview") or ""),
            "library_id": library_id,
            "series_id": series_id,
            "path": str(value.get("path") or ""),
            "source": (self.my_tv_series_root / series_id
                       / str(value.get("path") or "")).resolve().as_uri(),
            "poster_url": self._native_art_url(str(value.get("still") or ""), "series"),
            "watched": value.get("watched") is True,
            "watched_updated": float(value.get("watched_updated", 0) or 0),
            "remote_position": self.remote_resume_position(library_id, value, player),
            "remote_duration": self.remote_resume_duration(library_id, value, player),
            "remote_last_watched": self.remote_last_watched(library_id, value, player),
        }

    def _native_local_title(self, value: dict[str, Any], kind: str) -> dict[str, Any]:
        """Project one local item into the native My TV card contract."""
        metadata = value.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
        tmdb_id = int(metadata.get("tmdb_id", 0) or 0)
        media_type = "tv" if kind == "series" else "movie"
        result = {
            "key": f"{media_type}:{tmdb_id}" if tmdb_id else f"local:{value.get('id') or value.get('library_id')}",
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "title": str(metadata.get("title") or value.get("title")
                         or value.get("display_name") or value.get("name") or "Untitled"),
            "year": str(metadata.get("year") or ""),
            "overview": str(metadata.get("overview") or ""),
            "poster_path": str(metadata.get("poster_path") or ""),
            "backdrop_path": str(metadata.get("backdrop_path") or getattr(
                self, "_native_my_tv_backdrops", {}).get(f"{media_type}:{tmdb_id}") or ""),
            "on_mabeltv": True,
            "poster_url": self._native_art_url(str(metadata.get("poster") or ""), kind),
            "local": {"kind": kind, "id": value.get("id"),
                      "library_id": value.get("library_id"), "path": value.get("path")},
            "local_kind": kind,
        }
        if kind == "film":
            result["source"] = (self.my_tv_root / str(value.get("path") or "")).resolve().as_uri()
            result["progress"] = {
                "position": float(value.get("remote_position", 0) or 0),
                "duration": float(value.get("remote_duration", 0) or 0),
                "updated": float(value.get("remote_last_watched", 0) or 0),
            }
        else:
            episodes = value.get("episodes", []) if isinstance(value.get("episodes"), list) else []
            player = self.read_state("player")
            episodes = [self._native_episode(episode, str(value.get("id") or ""), player)
                        for episode in episodes if isinstance(episode, dict)]
            if not hasattr(self, "_native_my_tv_episodes"):
                self._native_my_tv_episodes = {}
            self._native_my_tv_episodes[result["key"]] = episodes
            result["episode_count"] = len(episodes)
            resumable = [episode for episode in episodes
                         if (not episode["watched"] or episode["watched_updated"] > 0
                             and episode["remote_last_watched"] > episode["watched_updated"])
                         and float(episode.get("remote_position", 0) or 0) >= 30]
            next_episode = max(resumable,
                               key=lambda episode: float(episode.get("remote_last_watched", 0) or 0),
                               default=None)
            result["progress"] = {
                "position": float((next_episode or {}).get("remote_position", 0) or 0),
                "duration": float((next_episode or {}).get("remote_duration", 0) or 0),
                "updated": float((next_episode or {}).get("remote_last_watched", 0) or 0),
                "episode": next_episode,
            }
            watched = [episode for episode in episodes if episode["watched"]]
            last_watched = max(watched, key=lambda item: (item["season"], item["number"]), default=None)
            candidate = next_episode or self.my_tv_next_episode_after_progress(episodes)
            result["series_progress"] = {
                "state": "resume" if next_episode else "next" if watched and candidate
                else "complete" if watched and not candidate else "new",
                "current_episode": next_episode,
                "last_watched_episode": last_watched,
                "next_episode": candidate,
            }
            if not next_episode and watched:
                result["progress"]["updated"] = max(
                    episode["watched_updated"] for episode in watched)
            result["next_playable"] = candidate or (episodes[0] if episodes else None)
            result["seasons"] = [{"number": number, "name": f"Season {number}"}
                                 for number in sorted({item["season"] for item in episodes})]
        return result

    def native_my_tv_home(self) -> dict[str, Any]:
        """Return the TV home payload without waiting on external providers."""
        self._native_my_tv_episodes = {}
        films = [self._native_local_title(value, "film")
                 for value in self.my_tv_library()]
        series = [self._native_local_title(value, "series")
                  for value in self.my_tv_series_library()]
        local_by_key = {value["key"]: value for value in films + series}
        self._native_my_tv_local_cards = local_by_key
        store = self.my_tv_viewing_store()
        tracked = []
        for key, saved in store.get("titles", {}).items():
            if not isinstance(saved, dict):
                continue
            value = dict(saved)
            value.update({"key": key, "on_mabeltv": key in local_by_key})
            tracked.append(value)
        for value in tracked:
            local = local_by_key.get(str(value.get("key") or ""))
            if local:
                value.update({field: saved for field, saved in local.items()
                              if saved not in (None, "", [], {})})
        up_next = sorted((value for value in tracked if value.get("up_next") is True),
                         key=lambda value: int(value.get("up_next_rank", 999999)))
        continue_watching = sorted(
            (value for value in films + series
             if float(value.get("progress", {}).get("position", 0) or 0) >= 30
             or value.get("series_progress", {}).get("state") == "next"),
            key=lambda value: float(value.get("progress", {}).get("updated", 0) or 0),
            reverse=True)
        cards = continue_watching + up_next + films + series
        self._native_attach_cached_sources(cards, store.get("availability", {}))
        return {
            "tv_name": self.tv_identity()[1],
            "continue": continue_watching[:8],
            "up_next": up_next[:16],
            "recommended": [],
            "library": films + series,
        }

    def _native_attach_cached_sources(
            self, values: list[dict[str, Any]],
            availability: dict[str, Any] | None = None) -> None:
        """Attach persisted Watchmode results without network requests."""
        if availability is None:
            availability = self.my_tv_viewing_store().get("availability", {})
        if not isinstance(availability, dict):
            return
        for value in values:
            cached = availability.get(str(value.get("key") or ""), {})
            if not isinstance(cached, dict):
                continue
            value["provider_sources"] = [
                deepcopy(source) for source in cached.get("sources", [])
                if isinstance(source, dict) and str(source.get("type") or "").lower()
                in {"sub", "free", "tve", "ads"}
            ]

    def native_my_tv_recommendations(self) -> dict[str, Any]:
        """Load a modest recommendation shelf after the home screen is visible."""
        result = self.my_tv_explore("popular", "all", 1, False, 12)
        values = list(result.get("results", []))[:12]
        self._native_attach_cached_sources(values)
        return {"results": values}

    def native_my_tv_search(self, query: str) -> dict[str, Any]:
        """Search TMDB without rescanning local media for every keystroke."""
        query = str(query or "").strip()
        if len(query) < 3:
            return {"query": query, "results": []}
        response = self.my_tv_cached_tmdb_request("search/multi", {
            "query": query[:120], "include_my_tv": "false",
            "language": "en-GB", "page": 1,
        })
        local = getattr(self, "_native_my_tv_local_cards", {})
        if not isinstance(local, dict):
            local = {}
        store = self.my_tv_viewing_store()
        results = []
        seen = set()
        for value in response.get("results", []) if isinstance(response, dict) else []:
            if not isinstance(value, dict) or value.get("media_type") not in {"movie", "tv"}:
                continue
            item = self.my_tv_title_summary(value, str(value["media_type"]))
            if not item["tmdb_id"] or not item["title"]:
                continue
            key = self.my_tv_title_key(item["media_type"], item["tmdb_id"])
            if key in seen:
                continue
            seen.add(key)
            local_item = local.get(key)
            item.update({
                "key": key, "local": local_item.get("local")
                if isinstance(local_item, dict) else None,
                "on_mabeltv": key in local,
                "viewing": deepcopy(store.get("titles", {}).get(key, {})),
            })
            if isinstance(local_item, dict):
                item.update({field: local_item[field] for field in (
                    "poster_url", "source", "local_kind", "progress", "next_playable", "series_progress")
                    if field in local_item})
            results.append(item)
            if len(results) >= 20:
                break
        self._native_attach_cached_sources(results, store.get("availability", {}))
        return {"query": query, "results": results,
                "attribution": "Catalogue data from TMDB"}

    def native_my_tv_detail(self, media_type: str, tmdb_id: Any) -> dict[str, Any]:
        detail = self.my_tv_title_detail(media_type, tmdb_id, include_providers=False)
        local = getattr(self, "_native_my_tv_local_cards", {}).get(detail.get("key"))
        if local:
            # Keep the richer catalogue text and hydrate playback only here.
            detail.update({field: local[field] for field in (
                "local", "local_kind", "source", "poster_url", "progress", "next_playable", "series_progress")
                if field in local})
            detail["local_episodes"] = getattr(self, "_native_my_tv_episodes", {}).get(
                detail["key"], [])
            detail["on_mabeltv"] = True
        self._native_attach_cached_sources([detail])
        detail["provider_result"] = {
            "sources": detail.pop("provider_sources", []), "cached": True,
        }
        detail.update(self._native_service_choices(detail))
        return detail

    def native_my_tv_local_detail(self, key: str) -> dict[str, Any]:
        card = getattr(self, "_native_my_tv_local_cards", {}).get(key)
        if not card:
            raise ValueError("That local title is no longer available")
        return deepcopy(card) | {"local_episodes": deepcopy(
            getattr(self, "_native_my_tv_episodes", {}).get(key, []))}

    def native_my_tv_episode_complete(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Finish one validated local episode through the existing viewing owner."""
        series_id = str(payload.get("series_id") or "")
        library_id = str(payload.get("library_id") or "")
        if not series_id or not library_id:
            raise ValueError("Choose a local episode to finish")
        series = next((value for value in self.my_tv_series_library()
                       if value.get("id") == series_id), None)
        episode = next((value for value in (series or {}).get("episodes", [])
                        if value.get("library_id") == library_id), None)
        if not episode:
            raise ValueError("That episode is no longer in this series")
        return self.set_my_tv_episode_watched(series_id, str(episode["path"]), True)

    def native_my_tv_mabel_channels(self) -> dict[str, Any]:
        """Browse family channels without loading the private My TV catalogue."""
        cards = []
        for channel in sorted(self.channel_library(), key=lambda value: value["number"]):
            if not channel["enabled"]:
                continue
            programmes = [value for value in channel["programmes"] if value["enabled"]]
            metadata = channel["metadata"]
            artwork = metadata.get("artwork") or next((value["metadata"].get("poster")
                        for value in programmes if value["metadata"].get("poster")), "")
            films = channel["content_type"] == "films"
            cards.append({"key": f"mabel-channel:{channel['number']}",
                          "title": channel["name"], "media_type": "movie" if films else "tv",
                          "channel_number": channel["number"], "family_channel": True,
                          "content_type": channel["content_type"],
                          "poster_url": self._native_art_url(str(artwork), "channel"),
                          "subtitle": f"CH {channel['number']} · {len(programmes)} {'films' if films else 'episodes'}"})
        return {"channels": cards}

    def native_my_tv_mabel_channel(self, number: Any) -> dict[str, Any]:
        try:
            number = int(number)
        except (TypeError, ValueError) as error:
            raise ValueError("Choose a channel") from error
        channel = next((value for value in self.channel_library()
                        if value["number"] == number and value["enabled"]), None)
        if not channel:
            raise ValueError("That channel is not available")
        player = self.read_state("player")
        items = []
        for ordinal, programme in enumerate(channel["programmes"], 1):
            if not programme["enabled"]:
                continue
            metadata = programme["metadata"]
            identity = self.my_tv_episode_identity(Path(programme["name"]), ordinal)
            library_id = f"mabel:{number}/{programme['name']}"
            films = channel["content_type"] == "films"
            position = float(programme.get("remote_position", 0) or 0) if films else float(
                player.get("my_tv_positions", {}).get(library_id, 0) or 0)
            duration = float(programme.get("remote_duration", 0) or 0) if films else float(
                player.get("my_tv_durations", {}).get(library_id, 0) or 0)
            artwork = metadata.get("poster") or metadata.get("still") or channel["metadata"].get("artwork") or ""
            items.append({"key": library_id, "library_id": library_id,
                          "title": metadata.get("title") or programme["display_name"],
                          "name": metadata.get("title") or programme["display_name"],
                          "media_type": "movie", "borrowed": True, "on_mabeltv": True,
                          "source": (self.media_root / channel["folder"] / programme["name"]).resolve().as_uri(),
                          "poster_url": self._native_art_url(str(artwork), "channel"),
                          "overview": metadata.get("overview") or "", "year": metadata.get("year") or "",
                          "rating": metadata.get("rating") or metadata.get("vote_average") or 0,
                          "runtime": metadata.get("runtime") or 0,
                          "season": int(metadata.get("season_number") or identity["season"]),
                          "number": int(metadata.get("episode_number") or identity["episode"]),
                          "remote_position": position, "remote_duration": duration,
                          "progress": {"position": position, "duration": duration},
                          "local": {"kind": "mabel", "library_id": library_id},
                          "mabel": {"channel": number, "file": programme["name"], "kind": channel["content_type"]}})
        return {"number": number, "title": channel["name"], "content_type": channel["content_type"], "items": items}

    def native_my_tv_season(self, tmdb_id: Any, season: Any) -> dict[str, Any]:
        result = self.my_tv_title_season(tmdb_id, season)
        local = {item["number"]: item for item in getattr(
            self, "_native_my_tv_episodes", {}).get(result["key"], [])
            if item["season"] == int(season)}
        for episode in result["episodes"]:
            saved = local.pop(episode["number"], None)
            if saved:
                episode.update({field: saved[field] for field in (
                    "library_id", "source", "poster_url", "remote_position",
                    "remote_duration", "remote_last_watched", "watched")})
        result["episodes"].extend(local.values())
        result["episodes"].sort(key=lambda item: item["number"])
        return result

    def native_my_tv_providers(self, media_type: str, tmdb_id: Any) -> dict[str, Any]:
        # Only the selected title loads availability, using the existing TTL.
        self.my_tv_title_key(media_type, tmdb_id)
        groups = {"providers": []}
        result = {"sources": []}
        errors = []
        try:
            groups = self.my_tv_title_provider_groups(media_type, tmdb_id)
        except (ValueError, OSError) as error:
            errors.append(str(error))
        try:
            result = self.my_tv_streaming_links(media_type, tmdb_id)
        except (ValueError, OSError) as error:
            errors.append(str(error))
        # Reuse the TV's already-known catalogue; browsing never wakes it.
        catalog = getattr(self, "lg_tv_catalog_cache", {}) or {}
        response = {"provider_result": result, "providers": groups.get("providers", []),
                    "apps_known": catalog.get("apps_known") is True,
                    "available_apps": sorted(catalog.get("shortcuts", {})), "errors": errors}
        return response | self._native_service_choices(response)

    def native_my_tv_launch(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Open an available service on the paired television."""
        shortcut = self._native_service({"name": payload.get("provider")})["shortcut"]
        if not shortcut:
            raise ValueError("That streaming app is not available on the connected TV")
        if shortcut == "netflix" and payload.get("destination"):
            return self.play_netflix_on_tv(payload)
        return self.lg_tv_launch_shortcut(shortcut)
