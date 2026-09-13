"""Adult catalogue metadata and viewing behaviour for the local library service."""

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


class AdultMetadataMixin:
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
        value = self.read_state("adult_viewing")
        if not isinstance(value, dict):
            value = {}
        for field in ("titles", "availability"):
            if not isinstance(value.get(field), dict):
                value[field] = {}
        value["schema_version"] = 1
        # Provider launches and the former rewatch tracker used to leave
        # transient workflow state behind. Lists are now independent manual
        # choices; episode watched state is the only TV progress ledger.
        for item in value["titles"].values():
            if not isinstance(item, dict):
                continue
            item.pop("pending_confirmation", None)
            item.pop("series_watching_mode", None)
            item.pop("rewatch", None)
            item.pop("rewatch_updated", None)
            item.pop("rewatch_episodes", None)
            item.pop("rewatch_completed", None)
            local_progress = item.get("local_progress")
            if isinstance(local_progress, dict) and \
                    local_progress.get("kind") == "channel-film":
                item.pop("local_progress", None)
        # Watchmode's free-data terms require old cached provider data to be
        # removed, rather than retained forever as ordinary application state.
        cutoff = time.time() - ADULT_PROVIDER_MAX_CACHE_SECONDS
        value["availability"] = {
            key: item for key, item in value["availability"].items()
            if isinstance(item, dict) and float(item.get("checked", 0) or 0) >= cutoff
        }
        return value

    def reset_adult_series_viewing_progress(
            self, series_id: str, season: int | None,
            local_episode_keys: set[str]) -> int:
        """Clear TV progress while preserving every manual viewing list."""
        with self.config_lock:
            states = self.adult_series_states()
            series_state = states["series"].get(series_id, {})
            if not isinstance(series_state, dict):
                return len(local_episode_keys)
            metadata = series_state.get("metadata", {})
            if not isinstance(metadata, dict):
                return len(local_episode_keys)
            try:
                key = self.adult_title_key("tv", metadata.get("tmdb_id"))
            except ValueError:
                return len(local_episode_keys)
            store = self.adult_viewing_store()
            current = store["titles"].get(key, {})
            if not isinstance(current, dict):
                current = {}
            episodes = current.get("episodes", {})
            if not isinstance(episodes, dict):
                episodes = {}
            prefix = f"{season}:" if season is not None else None
            reset_keys = set(local_episode_keys)
            reset_keys.update(str(episode_key) for episode_key in episodes
                              if prefix is None or str(episode_key).startswith(prefix))
            now = time.time()
            for episode_key in reset_keys:
                saved = episodes.get(episode_key, {})
                if not isinstance(saved, dict):
                    saved = {}
                saved.update({"watched": False, "updated": now})
                episodes[episode_key] = saved
            current["episodes"] = episodes
            current["manual_state"] = "part_watched" if any(
                isinstance(saved, dict) and saved.get("watched") is True
                for saved in episodes.values()) else "not_watched"
            current["history"] = []
            current["viewing_updated"] = now
            current.update({
                "media_type": "tv", "tmdb_id": int(key.split(":", 1)[1]),
                "title": str(metadata.get("title") or series_state.get("title") or "Series"),
                "year": str(metadata.get("year") or ""), "updated": now,
            })
            current.pop("series_watching_mode", None)
            current.pop("rewatch", None)
            current.pop("rewatch_updated", None)
            current.pop("rewatch_episodes", None)
            current.pop("rewatch_completed", None)
            self.save_adult_titles({key: current})
            return len(reset_keys)

    @staticmethod
    def adult_title_summary(value: dict[str, Any], media_type: str) -> dict[str, Any]:
        date = str(value.get("release_date" if media_type == "movie" else
                             "first_air_date", ""))
        try:
            rating = round(float(value.get("vote_average", 0) or 0), 1)
        except (TypeError, ValueError):
            rating = 0.0
        return {
            "media_type": media_type,
            "tmdb_id": int(value.get("id", 0) or 0),
            "title": str(value.get("title" if media_type == "movie" else "name", "")),
            "original_title": str(value.get("original_title" if media_type == "movie"
                                             else "original_name", "")),
            "year": date[:4],
            "release_date": date[:10] if media_type == "movie" else "",
            "first_air_date": date[:10] if media_type == "tv" else "",
            "rating": rating if rating > 0 else 0,
            "rating_count": int(value.get("vote_count", 0) or 0),
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
        """Map Adult TV files to canonical titles, excluding family channels."""
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
            episodes = series.get("episodes", [])
            if not episodes:
                continue
            try:
                key = self.adult_title_key("tv", metadata.get("tmdb_id"))
            except ValueError:
                continue
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
            if not isinstance(value, dict) or value.get("media_type") not in {"movie", "tv", "person"}:
                continue
            if value.get("media_type") == "person":
                person_id = int(value.get("id", 0) or 0)
                name = str(value.get("name") or "").strip()
                if not person_id or not name:
                    continue
                key = f"person:{person_id}"
                results.append({
                    "key": key, "media_type": "person", "tmdb_id": person_id,
                    "title": name, "name": name,
                    "profile_path": str(value.get("profile_path") or ""),
                    "known_for_department": str(value.get("known_for_department") or ""),
                })
                seen.add(key)
                if len(results) >= 20:
                    break
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
        value = self.adult_cached_tmdb_request(f"{media_type}/{raw_id}", {
            "language": "en-GB", "append_to_response": "credits,release_dates",
        })
        if not isinstance(value, dict):
            raise ValueError("That title could not be loaded")
        summary = self.adult_title_summary(value, media_type)
        if media_type == "movie":
            release_regions = value.get("release_dates", {}).get("results", []) \
                if isinstance(value.get("release_dates"), dict) else []
            gb_releases = next((region.get("release_dates", []) for region in
                                release_regions if isinstance(region, dict)
                                and region.get("iso_3166_1") == "GB"), [])
            dated = [release for release in gb_releases if isinstance(release, dict)
                     and str(release.get("release_date") or "")[:10]]
            theatrical = [release for release in dated
                           if int(release.get("type", 0) or 0) in {2, 3}]
            choices = theatrical or dated
            if choices:
                uk_date = min(str(release["release_date"])[:10]
                              for release in choices)
                summary["release_date"] = uk_date
                summary["year"] = uk_date[:4]
        availability_enabled = self.settings().get(
            "watchmode_availability_enabled") is not False
        providers = self.adult_cached_tmdb_request(
            f"{media_type}/{raw_id}/watch/providers") if availability_enabled else {}
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
        credits = value.get("credits", {}) if isinstance(value.get("credits"), dict) else {}
        creative_leads = []
        if media_type == "movie":
            lead_values = [member for member in credits.get("crew", [])
                           if isinstance(member, dict)
                           and member.get("job") == "Director"
                           and member.get("name")][:3]
            lead_role = "Director"
        else:
            lead_values = [member for member in value.get("created_by", [])
                           if isinstance(member, dict) and member.get("name")][:3]
            lead_role = "Creator"
        for member in lead_values:
            creative_leads.append({
                "tmdb_id": int(member.get("id", 0) or 0),
                "name": str(member.get("name") or ""),
                "role": lead_role,
                "profile_path": str(member.get("profile_path") or ""),
            })
        directors = [member["name"] for member in creative_leads]
        cast = []
        for member in credits.get("cast", []) if isinstance(credits, dict) else []:
            if not isinstance(member, dict) or not member.get("name"):
                continue
            cast.append({
                "tmdb_id": int(member.get("id", 0) or 0),
                "name": str(member.get("name") or ""),
                "character": str(member.get("character") or ""),
                "profile_path": str(member.get("profile_path") or ""),
                "order": int(member.get("order", len(cast)) or 0),
            })
            if len(cast) >= 15:
                break
        collection = None
        collection_summary = value.get("belongs_to_collection")
        if media_type == "movie" and isinstance(collection_summary, dict) and \
                int(collection_summary.get("id", 0) or 0) > 0:
            collection_id = int(collection_summary["id"])
            collection_value = self.adult_cached_tmdb_request(
                f"collection/{collection_id}", {"language": "en-GB"})
            parts = []
            for item in collection_value.get("parts", []) \
                    if isinstance(collection_value, dict) else []:
                if not isinstance(item, dict) or item.get("adult") is True:
                    continue
                part = self.adult_title_summary(item, "movie")
                if not part["tmdb_id"] or not part["title"]:
                    continue
                part["key"] = self.adult_title_key("movie", part["tmdb_id"])
                parts.append(part)
            parts.sort(key=lambda item: (item.get("release_date") or "9999-99-99",
                                         item.get("title") or ""))
            if len(parts) > 1:
                collection = {
                    "tmdb_id": collection_id,
                    "name": str(collection_value.get("name") or
                                collection_summary.get("name") or "Film collection"),
                    "parts": parts,
                }
        local_titles = self.adult_local_title_index()
        if collection:
            for part in collection["parts"]:
                part["on_mabeltv"] = part["key"] in local_titles
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
            "last_air_date": str(value.get("last_air_date") or "")[:10]
            if media_type == "tv" else "",
            "cast": cast, "collection": collection,
            "directors": directors, "creative_leads": creative_leads,
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
            "providers": groups, "availability_enabled": availability_enabled,
            "provider_link": str(region.get("link", ""))
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
        for season in detail["seasons"]:
            season["watched_count"] = sum(
                (isinstance(episode_states.get(f"{season['number']}:{episode}"), dict)
                 and episode_states[f"{season['number']}:{episode}"].get("watched") is True)
                or local_episode_states.get(
                    f"{season['number']}:{episode}", {}).get("watched") is True
                for episode in range(1, int(season.get("episodes", 0) or 0) + 1))
        available = []
        for season in detail["seasons"]:
            for episode in range(1, int(season.get("episodes", 0) or 0) + 1):
                episode_key = f"{season['number']}:{episode}"
                saved = episode_states.get(episode_key, {})
                locally_watched = local_episode_states.get(
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
                "title": "", "source": "streaming",
            }
        detail["next_episode"] = next_episode
        return detail

    def adult_person_detail(self, tmdb_id: Any) -> dict[str, Any]:
        try:
            person_id = int(tmdb_id)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid cast member") from None
        if person_id < 1:
            raise ValueError("Choose a valid cast member")
        value = self.adult_cached_tmdb_request(f"person/{person_id}", {
            "language": "en-GB", "append_to_response": "combined_credits",
        })
        if not isinstance(value, dict) or not value.get("name"):
            raise ValueError("That cast member could not be loaded")
        credits = value.get("combined_credits", {})
        cast_credits = credits.get("cast", []) if isinstance(credits, dict) else []
        crew_credits = credits.get("crew", []) if isinstance(credits, dict) else []
        department = str(value.get("known_for_department") or "Acting")
        source_credits = cast_credits if department == "Acting" else [
            item for item in crew_credits if isinstance(item, dict)
            and str(item.get("department") or "") == department]
        display_credits = []
        for item in source_credits:
            if not isinstance(item, dict):
                continue
            normalised = dict(item)
            normalised["character"] = str(
                item.get("character") or item.get("job") or department).strip()
            display_credits.append(normalised)
        filmography_by_key: dict[str, dict[str, Any]] = {}
        for item in display_credits:
            if not isinstance(item, dict) or item.get("adult") is True:
                continue
            media_type = str(item.get("media_type") or "")
            character = str(item.get("character") or "").strip()
            if media_type not in {"movie", "tv"} or not character or re.search(
                    r"\b(self|himself|herself|archive footage)\b",
                    character.casefold()):
                continue
            summary = self.adult_title_summary(item, media_type)
            if not summary["tmdb_id"] or not summary["title"]:
                continue
            key = self.adult_title_key(media_type, summary["tmdb_id"])
            summary.update({"key": key, "character": character})
            filmography_by_key.setdefault(key, summary)
        filmography = sorted(filmography_by_key.values(), key=lambda item: (
            str(item.get("release_date") or item.get("first_air_date") or
                f"{item.get('year', '')}-00-00"), str(item.get("title") or "").casefold()),
            reverse=True)
        ranked = sorted(
            (item for item in display_credits
             if self.adult_person_credit_score(item) is not None),
            key=lambda item: self.adult_person_credit_score(item) or (),
            reverse=True,
        )
        known_for: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in ranked:
            media_type = str(item.get("media_type") or "")
            if media_type not in {"movie", "tv"} or item.get("adult") is True:
                continue
            summary = self.adult_title_summary(item, media_type)
            if not summary["tmdb_id"] or not summary["title"]:
                continue
            key = self.adult_title_key(media_type, summary["tmdb_id"])
            if key in seen:
                continue
            seen.add(key)
            summary.update({
                "key": key,
                "character": str(item.get("character") or ""),
            })
            known_for.append(summary)
            if len(known_for) >= 15:
                break
        return {
            "tmdb_id": person_id,
            "name": str(value.get("name") or ""),
            "known_for_department": str(value.get("known_for_department") or ""),
            "biography": str(value.get("biography") or ""),
            "birthday": str(value.get("birthday") or "")[:10],
            "deathday": str(value.get("deathday") or "")[:10],
            "place_of_birth": str(value.get("place_of_birth") or ""),
            "profile_path": str(value.get("profile_path") or ""),
            "known_for": known_for,
            "filmography": filmography,
        }

    @staticmethod
    def adult_person_credit_score(item: dict[str, Any]) -> tuple[float, int, float] | None:
        """Rank substantive performances instead of high-traffic guest appearances."""
        media_type = str(item.get("media_type") or "")
        if media_type not in {"movie", "tv"} or item.get("adult") is True:
            return None
        character = str(item.get("character") or "").strip()
        role = character.casefold()
        genres = {int(value) for value in item.get("genre_ids", [])
                  if isinstance(value, int)}
        if not character or re.search(
                r"\b(self|himself|herself|archive footage|uncredited)\b", role):
            return None
        if media_type == "tv" and genres.intersection({10763, 10764, 10767}):
            return None
        votes = max(0, int(item.get("vote_count", 0) or 0))
        popularity = max(0.0, float(item.get("popularity", 0) or 0))
        score = math.log1p(votes) * 12 + min(popularity, 100) * 0.2
        if media_type == "movie":
            order = item.get("order")
            billing = int(order) if isinstance(order, int) and not isinstance(order, bool) else 20
            score += 8 + max(0, 12 - billing) * 2
        else:
            episodes = max(0, int(item.get("episode_count", 0) or 0))
            score += min(episodes, 12) * 1.5
            if episodes <= 2:
                score -= 12
        return score, votes, popularity

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
        seen: set[tuple[str, str, str, str]] = set()
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
            media_format = str(value.get("format") or "")[:20]
            try:
                raw_price = value.get("price")
                price = round(float(raw_price), 2) if raw_price is not None else None
                if price is not None and (price < 0 or price > 10000):
                    price = None
            except (TypeError, ValueError):
                price = None
            marker = (name.casefold(), source_type, media_format.casefold(),
                      str(price))
            if marker in seen:
                continue
            seen.add(marker)
            sources.append({
                "source_id": int(value.get("source_id", 0) or 0),
                "name": name, "type": source_type,
                "region": str(value.get("region") or "GB").upper(),
                "web_url": web_url, "ios_url": ios_url,
                "android_url": android_url,
                "format": media_format, "price": price,
            })
        return sources

    def adult_streaming_links(self, media_type: str, tmdb_id: Any,
                              refresh: bool = False) -> dict[str, Any]:
        key = self.adult_title_key(media_type, tmdb_id)
        if self.settings().get("watchmode_availability_enabled") is False:
            return {"key": key, "region": "GB", "sources": [],
                    "provider": "Watchmode", "disabled": True}
        now = time.time()
        with self.config_lock:
            store = self.adult_viewing_store()
            cached = store["availability"].get(key, {})
            if not refresh and isinstance(cached, dict) and \
                    cached.get("link_schema") == 3 and \
                    now - float(cached.get("checked", 0) or 0) < ADULT_PROVIDER_CACHE_SECONDS:
                return dict(cached)
        external_id = f"{key.split(':', 1)[0]}-{key.split(':', 1)[1]}"
        values = self.watchmode_request(
            f"title/{external_id}/sources/", {"regions": "GB"})
        result = {"key": key, "region": "GB", "checked": now, "link_schema": 3,
                  "sources": self.normalise_watchmode_sources(values),
                  "provider": "Watchmode"}
        with self.config_lock:
            self.save_adult_availability(key, result)
        return result

    def adult_viewing_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        key = self.adult_title_key(payload.get("media_type"), payload.get("tmdb_id"))
        action = str(payload.get("action", ""))
        allowed = {"watchlist", "up_next", "move_up", "move_down",
                   "part_watched", "watched", "not_watched", "dropped",
                   "watching", "launched", "remove", "episode_watched",
                   "season_watched", "rating"}
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
            local_title = self.adult_local_title_index().get(key, {})
            changed_titles = {key: current}
            if action == "watchlist":
                enabled = bool(payload.get("enabled", True))
                current["watchlisted"] = enabled
                current["watchlist_updated"] = now
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
                elif action in {"not_watched", "part_watched"} and \
                        previous_manual_state == "watched":
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
                    changed_titles[other_key] = other
            elif action == "watching":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Watching is available for TV series")
                enabled = bool(payload.get("enabled", True))
                current["series_watching"] = enabled
                current["series_watching_updated"] = now
                current.pop("series_watching_mode", None)
            elif action == "rating":
                rating = payload.get("rating")
                if isinstance(rating, bool):
                    raise ValueError("Choose a rating from 0 to 10")
                try:
                    rating = int(rating)
                except (TypeError, ValueError):
                    raise ValueError("Choose a rating from 0 to 10") from None
                if rating < 0 or rating > 10 or float(payload.get("rating")) != rating:
                    raise ValueError("Choose a whole-number rating from 0 to 10")
                corrected = current.get("manual_state") in {
                    "not_watched", "part_watched", "dropped"}
                watched = current.get("manual_state") == "watched" or (
                    not corrected and bool(current.get("history")))
                if rating and not watched:
                    raise ValueError("Mark this title as watched before rating it")
                if rating:
                    current["personal_rating"] = rating
                else:
                    current.pop("personal_rating", None)
                current["rating_updated"] = now
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
                episodes = current.setdefault("episodes", {})
                if not isinstance(episodes, dict):
                    episodes = {}
                    current["episodes"] = episodes
                episodes[f"{season}:{episode}"] = {"watched": payload["watched"], "updated": now}
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
                episodes = current.setdefault("episodes", {})
                if not isinstance(episodes, dict):
                    episodes = {}
                    current["episodes"] = episodes
                for episode in range(1, episode_count + 1):
                    episodes[f"{season}:{episode}"] = {"watched": watched, "updated": now}
            elif action == "remove":
                current["watchlisted"] = False
                current["up_next"] = False
                current["series_watching"] = False
                current["manual_state"] = "not_watched"
            current.pop("pending_confirmation", None)
            self.save_adult_titles(changed_titles)
        if action in {"episode_watched", "season_watched"} and \
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
            changed_titles: dict[str, dict[str, Any]] = {}
            for key, local_value in local.items():
                has_local_progress = float(local_value.get("position", 0) or 0) > 0 or (
                    local_value.get("kind") == "series"
                    and int(local_value.get("watched_count", 0) or 0) > 0)
                if not has_local_progress:
                    stored = store["titles"].get(key)
                    if isinstance(stored, dict) and "local_progress" in stored:
                        stored.pop("local_progress", None)
                        changed_titles[key] = stored
                    continue
                item = store["titles"].setdefault(key, {})
                if not isinstance(item, dict):
                    item = {}
                    store["titles"][key] = item
                local_fields = {"media_type": key.split(":", 1)[0],
                                "tmdb_id": int(key.split(":", 1)[1]),
                                "title": local_value.get("title", ""),
                                "local_progress": local_value}
                if any(item.get(field) != saved for field, saved in local_fields.items()):
                    item.update(local_fields)
                    changed_titles[key] = item
            if changed_titles:
                self.save_adult_titles(changed_titles)
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
