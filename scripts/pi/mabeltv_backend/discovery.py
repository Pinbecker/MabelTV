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


class AdultExploreMixin:
    """Build read-only catalogue pages without consulting Watchmode."""

    @staticmethod
    def adult_explore_parameters(list_id: str, media_type: str,
                                  page: int) -> dict[str, Any]:
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
        return parameters

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
        watched.sort(key=lambda value: (str(value.get("media_type")),
                                        int(value.get("tmdb_id", 0) or 0)))
        if not watched:
            return []
        start = (date.today().toordinal() * 7 + page * 11) % len(watched)
        positions = [int(index * len(watched) / min(4, len(watched)))
                     for index in range(min(4, len(watched)))]
        return [watched[(start + position) % len(watched)] for position in positions]

    def adult_personal_explore_results(self, store: dict[str, Any], media_type: str,
                                       page: int) -> tuple[list[tuple[str, dict[str, Any]]], bool]:
        buckets: list[list[tuple[str, dict[str, Any]]]] = []
        has_more = False
        recommendation_page = (page - 1) % 3 + 1
        for seed in self.adult_explore_seed_titles(store, media_type, page):
            kind = str(seed.get("media_type"))
            response = self.adult_cached_tmdb_request(
                f"{kind}/{int(seed.get('tmdb_id', 0))}/recommendations",
                {"language": "en-GB", "page": recommendation_page})
            values = response.get("results", []) if isinstance(response, dict) else []
            bucket = [(kind, value) for value in values if isinstance(value, dict)]
            if bucket:
                buckets.append(bucket)
            if isinstance(response, dict):
                has_more = has_more or recommendation_page < int(
                    response.get("total_pages", 1) or 1)

        mixed: list[tuple[str, dict[str, Any]]] = []
        while buckets and len(mixed) < 28:
            remaining = []
            for bucket in buckets:
                if bucket and len(mixed) < 28:
                    mixed.append(bucket.pop(0))
                if bucket:
                    remaining.append(bucket)
            buckets = remaining

        wildcard_lists = ("animation", "documentary", "crime", "science-fiction",
                          "family", "comedy", "drama", "british", "popular")
        wildcard = wildcard_lists[(date.today().toordinal() + page * 3) % len(wildcard_lists)]
        kinds = ("movie", "tv") if media_type == "all" else (media_type,)
        wildcards: list[tuple[str, dict[str, Any]]] = []
        for kind in kinds:
            response = self.adult_cached_tmdb_request(
                f"discover/{kind}", self.adult_explore_parameters(wildcard, kind, page))
            values = response.get("results", []) if isinstance(response, dict) else []
            wildcards.extend((kind, value) for value in values if isinstance(value, dict))
            if isinstance(response, dict):
                has_more = has_more or page < min(50, int(
                    response.get("total_pages", 1) or 1))
        wildcards.sort(key=lambda value: -float(value[1].get("popularity", 0) or 0))
        mixed.extend(wildcards[:20])
        return mixed, has_more

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
            store["explore"] = {key: value for key, value in feedback.items()
                                if isinstance(value, dict)
                                and float(value.get("last_seen", 0) or 0) >= cutoff}
            self.write_adult_viewing_store(store)
        return {"ok": True, "recorded": recorded}

    def adult_explore(self, list_id: str, media_type: str, page: Any) -> dict[str, Any]:
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

        store = self.adult_viewing_store()
        local = self.adult_local_title_index()
        watched_keys = {key for key, value in store["titles"].items()
                        if self.adult_explore_is_watched(value)}
        source: list[tuple[str, dict[str, Any]]] = []
        has_more = False
        if list_id == "for-you":
            source, has_more = self.adult_personal_explore_results(
                store, media_type, page_number)
            if not source:
                list_id = "popular"
        if list_id != "for-you":
            kinds = ("movie", "tv") if media_type == "all" else (media_type,)
            ranked = []
            for kind in kinds:
                response = self.adult_cached_tmdb_request(
                    f"discover/{kind}", self.adult_explore_parameters(
                        list_id, kind, page_number))
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
            seen.add(key)
            viewing = store["titles"].get(key, {})
            item.update({"key": key, "local": local.get(key),
                         "on_mabeltv": key in local,
                         "viewing": deepcopy(viewing) if isinstance(viewing, dict) else {}})
            results.append(item)
            if len(results) >= limit:
                break
        return {
            "list": deepcopy(lists[list_id]), "lists": deepcopy(EXPLORE_LISTS),
            "media_type": media_type, "page": page_number, "has_more": has_more,
            "results": results, "region": "GB",
            "attribution": "Catalogue metadata from TMDB",
        }
