"""Curated TMDB catalogue browsing for the private Adult TV organiser."""

from __future__ import annotations

from copy import deepcopy
from datetime import date
import time
from typing import Any


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
ADULT_STREAMING_PROVIDER_IDS = frozenset({
    8, 9, 29, 38, 39, 41, 103, 337, 350, 531, 591, 1796, 1825, 1899, 2300,
})


class AdultExploreMixin:
    """Build read-only catalogue pages without consulting Watchmode."""

    @staticmethod
    def adult_explore_parameters(list_id: str, media_type: str,
                                  page: int,
                                  available_only: bool = False) -> dict[str, Any]:
        today = date.today()
        parameters: dict[str, Any] = {
            "include_adult": "false", "language": "en-GB", "page": page,
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
                    str(value) for value in sorted(ADULT_STREAMING_PROVIDER_IDS)),
            })
        return parameters

    def adult_explore_has_included_provider(self, media_type: str,
                                            tmdb_id: Any) -> bool:
        response = self.adult_cached_tmdb_request(
            f"{media_type}/{int(tmdb_id)}/watch/providers")
        region = response.get("results", {}).get("GB", {}) \
            if isinstance(response, dict) else {}
        if not isinstance(region, dict):
            return False
        for group in ("flatrate", "free", "ads"):
            for provider in region.get(group, []):
                if isinstance(provider, dict) and int(
                        provider.get("provider_id", 0) or 0) in \
                        ADULT_STREAMING_PROVIDER_IDS:
                    return True
        return False

    @staticmethod
    def adult_explore_is_watched(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        state = value.get("manual_state")
        return state == "watched" or (state not in {"not_watched", "part_watched"}
                                      and bool(value.get("history")))

    @staticmethod
    def adult_explore_seed_titles(store: dict[str, Any], media_type: str,
                                  page: int) -> list[dict[str, Any]]:
        watched = [value for value in store.get("titles", {}).values()
                   if AdultExploreMixin.adult_explore_is_watched(value)
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

    def adult_explore_genre_profile(self, store: dict[str, Any]) -> dict[str, float]:
        cache_reader = getattr(self, "adult_insights_cache", None)
        cache = cache_reader() if callable(cache_reader) else {"titles": {}}
        metadata = cache.get("titles", {}) if isinstance(cache, dict) else {}
        profile: dict[str, float] = {}
        for key, item in store.get("titles", {}).items():
            if not self.adult_explore_is_watched(item):
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

    def adult_personal_explore_results(self, store: dict[str, Any], media_type: str,
                                       page: int,
                                       available_only: bool = False) \
            -> tuple[list[tuple[str, dict[str, Any]]], bool]:
        ranked: dict[tuple[str, int], dict[str, Any]] = {}
        has_more = False
        recommendation_page = (page - 1) % 3 + 1
        seeds = self.adult_explore_seed_titles(store, media_type, page)
        for seed_index, seed in enumerate(seeds):
            kind = str(seed.get("media_type"))
            response = self.adult_cached_tmdb_request(
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

        genre_profile = self.adult_explore_genre_profile(store)

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

    def adult_explore_feedback(self, payload: dict[str, Any]) -> dict[str, Any]:
        values = payload.get("items", [])
        if not isinstance(values, list):
            raise ValueError("Choose valid Explore feedback")
        now = time.time()
        recorded = 0
        with self.config_lock:
            store = self.adult_viewing_store()
            feedback = store.get("explore", {})
            if not isinstance(feedback, dict):
                feedback = {}
            for value in values[:100]:
                try:
                    key = self.adult_title_key(value.get("media_type"), value.get("tmdb_id"))
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

    def adult_explore(self, list_id: str, media_type: str, page: Any,
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

        store = self.adult_viewing_store()
        local = self.adult_local_title_index()
        watched_keys = {key for key, value in store["titles"].items()
                        if self.adult_explore_is_watched(value)}
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
            source, has_more = self.adult_personal_explore_results(
                store, media_type, page_number, available_only)
            if not source:
                list_id = "popular"
                personal_source = False
        if list_id != "for-you":
            kinds = ("movie", "tv") if media_type == "all" else (media_type,)
            ranked = []
            for kind in kinds:
                response = self.adult_cached_tmdb_request(
                    f"discover/{kind}", self.adult_explore_parameters(
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
            if value.get("adult") is True:
                continue
            item = self.adult_title_summary(value, kind)
            if not item["tmdb_id"] or not item["title"]:
                continue
            key = self.adult_title_key(kind, item["tmdb_id"])
            if key in watched_keys or key in seen:
                continue
            if available_only and personal_source and not \
                    self.adult_explore_has_included_provider(kind, item["tmdb_id"]):
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
