"""Curated TMDB catalogue browsing for the private My TV organiser."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, timedelta
import time
from typing import Any

from .constants import MY_TV_PROVIDER_CACHE_SECONDS


EXPLORE_LISTS = (
    {"id": "for-you", "label": "Best guesses for you",
     "kicker": "Your history, balanced with a few wildcards"},
    {"id": "popular", "label": "Popular right now", "kicker": "A broad place to start"},
    {"id": "top-rated", "label": "Highly rated", "kicker": "Much-loved films and series"},
    {"id": "new", "label": "Recent releases", "kicker": "The last two years"},
    {"id": "british", "label": "British favourites", "kicker": "Made in Great Britain"},
    {"id": "family", "label": "Family favourites", "kicker": "Big shared-screen titles"},
    {"id": "comedy", "label": "Comedy", "kicker": "Familiar favourites and discoveries"},
    {"id": "drama", "label": "Drama", "kicker": "Acclaimed stories and series"},
    {"id": "crime", "label": "Crime", "kicker": "Cases, capers and thrillers"},
    {"id": "science-fiction", "label": "Science fiction", "kicker": "Other worlds and possible futures"},
    {"id": "animation", "label": "Animation", "kicker": "Animated films and series"},
    {"id": "documentary", "label": "Documentary", "kicker": "Real lives and remarkable stories"},
    {"id": "2020s", "label": "The 2020s", "kicker": "Titles from this decade"},
    {"id": "2010s", "label": "The 2010s", "kicker": "A decade to remember"},
    {"id": "2000s", "label": "The 2000s", "kicker": "Turn-of-the-century favourites"},
    {"id": "1990s", "label": "The 1990s", "kicker": "Nineties films and television"},
    {"id": "1980s", "label": "The 1980s", "kicker": "Eighties films and television"},
    {"id": "classics", "label": "Earlier classics", "kicker": "Before the eighties"},
)

EXPLORE_GENRES = {
    "family": {"movie": 10751, "tv": 10751},
    "comedy": {"movie": 35, "tv": 35},
    "drama": {"movie": 18, "tv": 18},
    "crime": {"movie": 80, "tv": 80},
    "science-fiction": {"movie": 878, "tv": 10765},
    "animation": {"movie": 16, "tv": 16},
    "documentary": {"movie": 99, "tv": 99},
}

EXPLORE_GENRE_NAMES = {
    12: "Adventure", 14: "Fantasy", 16: "Animation", 18: "Drama",
    27: "Horror", 28: "Action", 35: "Comedy", 36: "History",
    37: "Western", 53: "Thriller", 80: "Crime", 99: "Documentary",
    878: "Science Fiction", 9648: "Mystery", 10749: "Romance",
    10751: "Family", 10752: "War", 10759: "Action & Adventure",
    10765: "Sci-Fi & Fantasy", 10768: "War & Politics",
}

# Providers represented by the portal's UK streaming destinations. Recommendation
# shelves use only included, free or ad-supported availability from this set.
MY_TV_STREAMING_PROVIDER_IDS = frozenset({
    8, 9, 29, 38, 39, 41, 103, 337, 350, 531, 591, 1796, 1825, 1899, 2300,
})


class MyTvExploreMixin:
    """Build read-only catalogue pages without consulting Watchmode."""

    @staticmethod
    def my_tv_explore_parameters(list_id: str, media_type: str,
                                  page: int,
                                  available_only: bool = False) -> dict[str, Any]:
        today = date.today()
        parameters: dict[str, Any] = {
            "include_my_tv": "false", "language": "en-GB", "page": page,
            "sort_by": "popularity.desc", "vote_count.gte": 20 if media_type == "tv" else 50,
        }
        date_prefix = "first_air_date" if media_type == "tv" else "primary_release_date"
        if list_id == "top-rated":
            parameters.update({"sort_by": "vote_average.desc",
                               "vote_count.gte": 500 if media_type == "tv" else 1500})
        elif list_id == "new":
            parameters.update({f"{date_prefix}.gte": f"{today.year - 1}-01-01",
                               f"{date_prefix}.lte": today.isoformat()})
        elif list_id == "british":
            parameters["with_origin_country"] = "GB"
        elif list_id in EXPLORE_GENRES:
            parameters["with_genres"] = EXPLORE_GENRES[list_id][media_type]
        elif list_id.endswith("0s") and len(list_id) == 5:
            start = int(list_id[:4])
            parameters.update({f"{date_prefix}.gte": f"{start}-01-01",
                               f"{date_prefix}.lte": f"{start + 9}-12-31"})
        elif list_id == "classics":
            parameters[f"{date_prefix}.lte"] = "1979-12-31"
        if available_only:
            parameters.update({
                "watch_region": "GB",
                "with_watch_monetization_types": "flatrate|free|ads",
                "with_watch_providers": "|".join(
                    str(value) for value in sorted(MY_TV_STREAMING_PROVIDER_IDS)),
            })
        return parameters

    def my_tv_explore_has_included_provider(self, media_type: str,
                                            tmdb_id: Any) -> bool:
        response = self.my_tv_cached_tmdb_request(
            f"{media_type}/{int(tmdb_id)}/watch/providers")
        region = response.get("results", {}).get("GB", {}) \
            if isinstance(response, dict) else {}
        if not isinstance(region, dict):
            return False
        for group in ("flatrate", "free", "ads"):
            for provider in region.get(group, []):
                if isinstance(provider, dict) and int(
                        provider.get("provider_id", 0) or 0) in \
                        MY_TV_STREAMING_PROVIDER_IDS:
                    return True
        return False

    @staticmethod
    def my_tv_explore_is_watched(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        state = value.get("manual_state")
        return state == "watched" or (state not in {"not_watched", "part_watched"}
                                      and bool(value.get("history")))

    @staticmethod
    def my_tv_explore_seed_titles(store: dict[str, Any], media_type: str,
                                  page: int) -> list[dict[str, Any]]:
        watched = [value for value in store.get("titles", {}).values()
                   if MyTvExploreMixin.my_tv_explore_is_watched(value)
                   and value.get("media_type") in {"movie", "tv"}
                   and (media_type == "all" or value.get("media_type") == media_type)]
        if not watched:
            return []
        rated = [value for value in watched
                 if int(value.get("personal_rating", 0) or 0) >= 6]
        pool = rated or watched
        pool.sort(key=lambda value: (
            -int(value.get("personal_rating", 0) or 0),
            -len(value.get("history", [])) if isinstance(value.get("history"), list) else 0,
            str(value.get("title") or "").casefold(),
            int(value.get("tmdb_id", 0) or 0)))
        # Rotate only through the strongest part of the profile. Pages still
        # refresh, without a random low-rated title steering the whole shelf.
        pool = pool[:min(24, len(pool))]
        count = min(4, len(pool))
        start = ((page - 1) * count) % len(pool)
        return [pool[(start + index) % len(pool)] for index in range(count)]

    def my_tv_home_saved_title(self, key: str, value: dict[str, Any],
                               local: dict[str, dict[str, Any]]) \
            -> dict[str, Any] | None:
        try:
            media_type, identifier = key.split(":", 1)
            tmdb_id = int(identifier)
        except (AttributeError, TypeError, ValueError):
            return None
        title = str(value.get("title") or "").strip()
        if media_type not in {"movie", "tv"} or tmdb_id <= 0 or not title:
            return None
        return {
            "key": key, "media_type": media_type, "tmdb_id": tmdb_id,
            "title": title, "year": str(value.get("year") or ""),
            "poster_path": str(value.get("poster_path") or ""),
            "overview": str(value.get("overview") or ""),
            "local": local.get(key), "on_mabeltv": key in local,
            "viewing": deepcopy(value),
        }

    def my_tv_home_what_to_watch(self, page: Any, limit: Any = 12) -> dict[str, Any]:
        """Mix familiar choices with popular unseen titles for the Watch page."""
        try:
            page_number = max(1, min(50, int(page or 1)))
        except (TypeError, ValueError):
            page_number = 1
        try:
            result_limit = max(1, min(24, int(limit or 12)))
        except (TypeError, ValueError):
            result_limit = 12

        store = self.my_tv_viewing_store()
        local = self.my_tv_local_title_index()
        familiar: list[tuple[tuple[float, ...], dict[str, Any]]] = []
        excluded = set()
        for key, value in store.get("titles", {}).items():
            if not isinstance(value, dict) or value.get("up_next") is True:
                continue
            if not (self.my_tv_explore_is_watched(value)
                    or value.get("watchlisted") is True):
                continue
            item = self.my_tv_home_saved_title(key, value, local)
            if item is None:
                continue
            excluded.add(key)
            familiar.append(((
                float(int(value.get("personal_rating", 0) or 0)),
                float(len(value.get("history", [])))
                if isinstance(value.get("history"), list) else 0.0,
                float(value.get("updated", 0) or 0),
            ), item))
        familiar.sort(key=lambda pair: pair[0], reverse=True)
        familiar_values = [item for _, item in familiar]
        if familiar_values:
            offset = ((page_number - 1) * 6) % len(familiar_values)
            familiar_values = familiar_values[offset:] + familiar_values[:offset]

        available = self.settings().get("watchmode_availability_enabled") is not False
        popular = self.my_tv_explore(
            "popular", "all", page_number, available, max(18, result_limit * 2))
        blockbusters = [item for item in popular.get("results", [])
                        if item.get("key") not in excluded
                        and item.get("viewing", {}).get("up_next") is not True]
        results: list[dict[str, Any]] = []
        familiar_target = (result_limit + 1) // 2
        familiar_values = familiar_values[:familiar_target]
        while familiar_values or blockbusters:
            if familiar_values:
                results.append(familiar_values.pop(0))
            if len(results) >= result_limit:
                break
            if blockbusters:
                results.append(blockbusters.pop(0))
            if len(results) >= result_limit:
                break
        return {"page": page_number, "results": results,
                "attribution": "Catalogue and UK availability data from TMDB"}

    @staticmethod
    def my_tv_home_release_date(value: Any) -> date | None:
        try:
            return date.fromisoformat(str(value or "")[:10])
        except ValueError:
            return None

    def my_tv_released_this_week(self, limit: Any = 16) -> dict[str, Any]:
        """Return popular films, new series and season premieres from the last week."""
        try:
            result_limit = max(1, min(24, int(limit or 16)))
        except (TypeError, ValueError):
            result_limit = 16
        today = date.today()
        start = today - timedelta(days=6)
        movie_parameters = self.my_tv_explore_parameters("popular", "movie", 1)
        movie_parameters.update({
            "region": "GB", "release_date.gte": start.isoformat(),
            "release_date.lte": today.isoformat(),
            "with_release_type": "2|3|4|5|6", "vote_count.gte": 5,
        })
        tv_parameters = self.my_tv_explore_parameters("popular", "tv", 1)
        tv_parameters.update({
            "air_date.gte": start.isoformat(), "air_date.lte": today.isoformat(),
            "timezone": "Europe/London", "vote_count.gte": 5,
        })
        movie_response = self.my_tv_cached_tmdb_request("discover/movie", movie_parameters)
        tv_response = self.my_tv_cached_tmdb_request("discover/tv", tv_parameters)
        candidates: list[tuple[float, int, str, str, bool, dict[str, Any]]] = []
        movie_values = [value for value in movie_response.get("results", [])
                        if isinstance(value, dict) and value.get("id")] \
            if isinstance(movie_response, dict) else []

        def movie_release(value: dict[str, Any]) -> tuple[dict[str, Any], bool]:
            released = self.my_tv_home_release_date(value.get("release_date"))
            if not released or not start <= released <= today:
                return value, False
            try:
                detail = self.my_tv_cached_tmdb_request(
                    f"movie/{int(value['id'])}/release_dates")
            except (OSError, TypeError, ValueError):
                return value, False
            regions = detail.get("results", []) if isinstance(detail, dict) else []
            gb_releases = next((region.get("release_dates", []) for region in regions
                                if isinstance(region, dict)
                                and region.get("iso_3166_1") == "GB"), [])
            release_types = {
                int(item.get("type", 0) or 0) for item in gb_releases
                if isinstance(item, dict)
                and (release_date := self.my_tv_home_release_date(
                    item.get("release_date"))) is not None
                and start <= release_date <= today
            }
            theatrical_only = bool(release_types & {2, 3}) \
                and not bool(release_types & {4, 5, 6})
            if not theatrical_only:
                return value, False
            try:
                provider_result = self.my_tv_title_provider_groups(
                    "movie", int(value["id"]))
            except (OSError, TypeError, ValueError):
                return value, False
            if provider_result.get("disabled") is True:
                return value, False
            providers = provider_result.get("providers", [])
            included = any(provider.get("type") in {"flatrate", "free", "ads"}
                           for provider in providers if isinstance(provider, dict))
            return value, not included

        with ThreadPoolExecutor(max_workers=min(6, max(1, len(movie_values)))) as pool:
            movie_releases = list(pool.map(movie_release, movie_values))
        for value, cinema_only in movie_releases:
            released = self.my_tv_home_release_date(value.get("release_date"))
            if not released or not start <= released <= today:
                continue
            candidates.append((float(value.get("popularity", 0) or 0),
                               int(value.get("vote_count", 0) or 0),
                               "movie", "New film", cinema_only, value))
        tv_values = [value for value in tv_response.get("results", [])
                     if isinstance(value, dict) and value.get("id")] \
            if isinstance(tv_response, dict) else []
        tv_values.sort(key=lambda value: float(value.get("popularity", 0) or 0),
                       reverse=True)

        def television_release(value: dict[str, Any]) \
                -> tuple[dict[str, Any], str]:
            first_air = self.my_tv_home_release_date(value.get("first_air_date"))
            if first_air and start <= first_air <= today:
                return value, "New series"
            detail = self.my_tv_cached_tmdb_request(
                f"tv/{int(value['id'])}", {"language": "en-GB"})
            premieres = [season for season in detail.get("seasons", [])
                         if isinstance(season, dict)
                         and int(season.get("season_number", 0) or 0) > 0
                         and (air_date := self.my_tv_home_release_date(
                             season.get("air_date"))) is not None
                         and start <= air_date <= today] \
                if isinstance(detail, dict) else []
            if not premieres:
                return value, ""
            number = max(int(season.get("season_number", 0) or 0)
                         for season in premieres)
            return value, f"Series {number} starts"

        with ThreadPoolExecutor(max_workers=min(6, max(1, len(tv_values[:18])))) as pool:
            television_releases = list(pool.map(television_release, tv_values[:18]))
        for value, label in television_releases:
            if label:
                candidates.append((float(value.get("popularity", 0) or 0),
                                   int(value.get("vote_count", 0) or 0),
                                   "tv", label, False, value))
        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        local = self.my_tv_local_title_index()
        store = self.my_tv_viewing_store()
        results = []
        seen = set()
        for _, _, media_type, label, cinema_only, value in candidates:
            item = self.my_tv_title_summary(value, media_type)
            if not item["tmdb_id"] or not item["title"] or not item["poster_path"]:
                continue
            key = self.my_tv_title_key(media_type, item["tmdb_id"])
            if key in seen:
                continue
            seen.add(key)
            item.update({"key": key, "local": local.get(key),
                         "on_mabeltv": key in local,
                         "viewing": deepcopy(store.get("titles", {}).get(key, {})),
                         "release_label": label, "cinema_only": cinema_only})
            results.append(item)
            if len(results) >= result_limit:
                break
        return {"from": start.isoformat(), "to": today.isoformat(),
                "results": results, "attribution": "Release data from TMDB"}

    def my_tv_home_availability(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Fetch small streaming-only provider summaries for homepage cards.

        TMDB supplies the broad provider list without spending Watchmode
        allowance.  Merge any Watchmode result already cached by a title sheet
        so a homepage card shows the same included services, without turning a
        homepage refresh into dozens of new Watchmode requests.
        """
        requested = payload.get("titles", [])
        if not isinstance(requested, list):
            raise ValueError("Choose valid homepage titles")
        titles: list[tuple[str, str, int]] = []
        seen = set()
        for value in requested[:48]:
            if not isinstance(value, dict):
                continue
            try:
                key = self.my_tv_title_key(value.get("media_type"), value.get("tmdb_id"))
            except ValueError:
                continue
            if key in seen:
                continue
            seen.add(key)
            media_type, identifier = key.split(":", 1)
            titles.append((key, media_type, int(identifier)))

        availability = self.my_tv_viewing_store().get("availability", {})

        def providers_for_title(title: tuple[str, str, int]) -> dict[str, Any]:
            key, media_type, identifier = title
            cached = availability.get(key, {}) if isinstance(availability, dict) else {}
            sources = []
            try:
                cache_is_fresh = (
                    isinstance(cached, dict)
                    and cached.get("link_schema") == 3
                    and time.time() - float(cached.get("checked", 0) or 0)
                    < MY_TV_PROVIDER_CACHE_SECONDS
                )
            except (TypeError, ValueError):
                cache_is_fresh = False
            if cache_is_fresh:
                sources = [
                    {field: source.get(field) for field in ("source_id", "name", "type")}
                    for source in cached.get("sources", [])
                    if isinstance(source, dict)
                    and str(source.get("type") or "").lower()
                    in {"sub", "free", "tve", "ads"}
                ]
            try:
                result = self.my_tv_title_provider_groups(media_type, identifier)
                providers = [provider for provider in result["providers"]
                             if provider.get("type") in {"flatrate", "free", "ads"}]
            except (OSError, TypeError, ValueError):
                return {"key": key, "providers": [], "sources": sources,
                        "available": bool(sources)}
            return {"key": key, "providers": providers, "sources": sources,
                    "available": True}

        if not titles:
            return {"items": [], "region": "GB"}
        with ThreadPoolExecutor(max_workers=min(6, len(titles))) as pool:
            items = list(pool.map(providers_for_title, titles))
        return {"items": items, "region": "GB"}

    def my_tv_explore_genre_profile(self, store: dict[str, Any]) -> dict[str, float]:
        cache_reader = getattr(self, "my_tv_insights_cache", None)
        cache = cache_reader() if callable(cache_reader) else {"titles": {}}
        metadata = cache.get("titles", {}) if isinstance(cache, dict) else {}
        profile: dict[str, float] = {}
        for key, item in store.get("titles", {}).items():
            if not self.my_tv_explore_is_watched(item):
                continue
            try:
                rating = int(item.get("personal_rating", 0) or 0)
            except (TypeError, ValueError):
                rating = 0
            weight = 0.35 if not rating else float((rating - 5) * 2)
            detail = metadata.get(key, {}) if isinstance(metadata, dict) else {}
            for genre in detail.get("genres", []) if isinstance(detail, dict) else []:
                name = str(genre)
                profile[name] = profile.get(name, 0.0) + weight
        return profile

    def my_tv_personal_explore_results(self, store: dict[str, Any], media_type: str,
                                       page: int,
                                       available_only: bool = False) \
            -> tuple[list[tuple[str, dict[str, Any]]], bool]:
        ranked: dict[tuple[str, int], dict[str, Any]] = {}
        has_more = False
        recommendation_page = (page - 1) % 3 + 1
        seeds = self.my_tv_explore_seed_titles(store, media_type, page)
        for seed_index, seed in enumerate(seeds):
            kind = str(seed.get("media_type"))
            response = self.my_tv_cached_tmdb_request(
                f"{kind}/{int(seed.get('tmdb_id', 0))}/recommendations",
                {"language": "en-GB", "page": recommendation_page})
            values = response.get("results", []) if isinstance(response, dict) else []
            seed_rating = int(seed.get("personal_rating", 0) or 0)
            for result_index, value in enumerate(values):
                if not isinstance(value, dict) or not value.get("id"):
                    continue
                identity = (kind, int(value["id"]))
                saved = ranked.setdefault(identity, {
                    "kind": kind, "value": value, "hits": 0,
                    "seed_rating": seed_rating, "source_rank": result_index,
                    "seed_index": seed_index,
                })
                saved["hits"] += 1
                saved["seed_rating"] = max(saved["seed_rating"], seed_rating)
                saved["source_rank"] = min(saved["source_rank"], result_index)
                saved["seed_index"] = min(saved["seed_index"], seed_index)
            if isinstance(response, dict):
                has_more = has_more or recommendation_page < int(
                    response.get("total_pages", 1) or 1)

        genre_profile = self.my_tv_explore_genre_profile(store)

        def score(value: dict[str, Any]) -> tuple[float, ...]:
            candidate = value["value"]
            affinity = sum(genre_profile.get(EXPLORE_GENRE_NAMES.get(
                int(genre_id), ""), 0.0) for genre_id in candidate.get("genre_ids", []))
            quality = float(candidate.get("vote_average", 0) or 0)
            votes = min(5000, int(candidate.get("vote_count", 0) or 0)) / 1000
            return (float(value["seed_rating"]), float(value["hits"]), affinity,
                    quality + votes, -float(value["source_rank"]),
                    -float(value["seed_index"]))

        ordered = sorted(ranked.values(), key=score, reverse=True)[:36]
        return [(value["kind"], value["value"]) for value in ordered], has_more

    def my_tv_explore_feedback(self, payload: dict[str, Any]) -> dict[str, Any]:
        values = payload.get("items", [])
        if not isinstance(values, list):
            raise ValueError("Choose valid Explore feedback")
        now = time.time()
        recorded = 0
        with self.config_lock:
            store = self.my_tv_viewing_store()
            feedback = store.get("explore", {})
            if not isinstance(feedback, dict):
                feedback = {}
            for value in values[:100]:
                try:
                    key = self.my_tv_title_key(value.get("media_type"), value.get("tmdb_id"))
                except (AttributeError, ValueError):
                    continue
                saved = feedback.get(key, {})
                if not isinstance(saved, dict):
                    saved = {}
                saved.update({"last_seen": now,
                              "impressions": min(50, int(saved.get("impressions", 0) or 0) + 1)})
                feedback[key] = saved
                recorded += 1
            cutoff = now - 90 * 86400
            retained = {key: value for key, value in feedback.items()
                        if isinstance(value, dict)
                        and float(value.get("last_seen", 0) or 0) >= cutoff}
            self.save_explore_feedback(retained, retain_since=cutoff)
        return {"ok": True, "recorded": recorded}

    def my_tv_explore(self, list_id: str, media_type: str, page: Any,
                      available_only: bool = False, limit: Any = None) -> dict[str, Any]:
        lists = {value["id"]: value for value in EXPLORE_LISTS}
        list_id = str(list_id or "for-you").strip().lower()
        media_type = str(media_type or "all").strip().lower()
        if list_id not in lists:
            raise ValueError("Choose a valid Explore list")
        if media_type not in {"all", "movie", "tv"}:
            raise ValueError("Choose films, TV series, or all titles")
        try:
            page_number = max(1, min(50, int(page or 1)))
        except (TypeError, ValueError):
            page_number = 1
        default_limit = 24 if media_type == "all" else 20
        try:
            result_limit = max(1, min(default_limit, int(limit or default_limit)))
        except (TypeError, ValueError):
            result_limit = default_limit

        store = self.my_tv_viewing_store()
        local = self.my_tv_local_title_index()
        watched_keys = {key for key, value in store["titles"].items()
                        if self.my_tv_explore_is_watched(value)}
        source: list[tuple[str, dict[str, Any]]] = []
        has_more = False
        personal_source = list_id == "for-you"
        if available_only and self.settings().get(
                "watchmode_availability_enabled") is False:
            return {
                "list": deepcopy(lists[list_id]), "lists": deepcopy(EXPLORE_LISTS),
                "media_type": media_type, "page": page_number, "has_more": False,
                "results": [], "region": "GB", "availability_disabled": True,
                "attribution": "Catalogue and UK availability data from TMDB",
            }
        if list_id == "for-you":
            source, has_more = self.my_tv_personal_explore_results(
                store, media_type, page_number, available_only)
            if not source:
                list_id = "popular"
                personal_source = False
        if list_id != "for-you":
            kinds = ("movie", "tv") if media_type == "all" else (media_type,)
            ranked = []
            for kind in kinds:
                response = self.my_tv_cached_tmdb_request(
                    f"discover/{kind}", self.my_tv_explore_parameters(
                        list_id, kind, page_number, available_only))
                if not isinstance(response, dict):
                    continue
                has_more = has_more or page_number < min(
                    50, int(response.get("total_pages", 1) or 1))
                ranked.extend((float(value.get("popularity", 0) or 0), kind, value)
                              for value in response.get("results", [])
                              if isinstance(value, dict))
            ranked.sort(key=lambda value: -value[0])
            source = [(kind, value) for _, kind, value in ranked]

        feedback = store.get("explore", {})
        now = time.time()

        def pass_over_penalty(candidate: tuple[str, dict[str, Any]]) -> tuple[int, int]:
            kind, value = candidate
            key = f"{kind}:{int(value.get('id', 0) or 0)}"
            saved = feedback.get(key, {}) if isinstance(feedback, dict) else {}
            age = now - float(saved.get("last_seen", 0) or 0) if isinstance(saved, dict) else 10**9
            if age < 86400:
                penalty = 3
            elif age < 7 * 86400:
                penalty = 2
            elif age < 30 * 86400:
                penalty = 1
            else:
                penalty = 0
            return penalty, int(saved.get("impressions", 0) or 0) if isinstance(saved, dict) else 0
        source = [value for _, value in sorted(enumerate(source),
                  key=lambda pair: (*pass_over_penalty(pair[1]), pair[0]))]

        limit = 24 if media_type == "all" else 20
        results = []
        seen = set()
        for kind, value in source:
            if value.get("my_tv") is True:
                continue
            item = self.my_tv_title_summary(value, kind)
            if not item["tmdb_id"] or not item["title"]:
                continue
            key = self.my_tv_title_key(kind, item["tmdb_id"])
            if key in watched_keys or key in seen:
                continue
            if available_only and personal_source and not \
                    self.my_tv_explore_has_included_provider(kind, item["tmdb_id"]):
                continue
            seen.add(key)
            viewing = store["titles"].get(key, {})
            item.update({"key": key, "local": local.get(key),
                         "on_mabeltv": key in local,
                         "viewing": deepcopy(viewing) if isinstance(viewing, dict) else {}})
            results.append(item)
            if len(results) >= result_limit:
                break
        return {
            "list": deepcopy(lists[list_id]), "lists": deepcopy(EXPLORE_LISTS),
            "media_type": media_type, "page": page_number, "has_more": has_more,
            "results": results, "region": "GB",
            "attribution": "Catalogue and UK availability data from TMDB"
            if available_only else "Catalogue metadata from TMDB",
        }
