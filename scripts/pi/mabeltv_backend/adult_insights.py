"""Personal catalogue insights built from Adult TV viewing records and TMDB."""

from __future__ import annotations

import threading
import time
from collections import Counter, defaultdict
from copy import deepcopy
from typing import Any


class AdultInsightsMixin:
    """Aggregate timeless viewing-history insights without inventing watch dates."""

    @staticmethod
    def adult_insights_watched(item: dict[str, Any]) -> bool:
        state = str(item.get("manual_state") or "")
        if state == "watched":
            return True
        return state not in {"not_watched", "part_watched", "dropped"} and bool(
            item.get("history"))

    def adult_insights_cache(self) -> dict[str, Any]:
        value = self.read_state("adult_insights")
        if not isinstance(value, dict):
            value = {}
        if not isinstance(value.get("titles"), dict):
            value["titles"] = {}
        if not isinstance(value.get("failures"), dict):
            value["failures"] = {}
        value["schema_version"] = 1
        return value

    def write_adult_insights_cache(self, value: dict[str, Any]) -> None:
        value["updated"] = time.time()
        self.save_adult_insights(value)

    @staticmethod
    def adult_insights_metadata(value: dict[str, Any], media_type: str) -> dict[str, Any]:
        credits = value.get("credits", {}) if isinstance(value.get("credits"), dict) else {}
        cast = []
        for person in credits.get("cast", []) if isinstance(credits, dict) else []:
            if not isinstance(person, dict) or not person.get("name"):
                continue
            cast.append({
                "id": int(person.get("id", 0) or 0),
                "name": str(person.get("name") or "")[:160],
                "profile_path": str(person.get("profile_path") or ""),
            })
            if len(cast) >= 12:
                break
        if media_type == "movie":
            leads = [person for person in credits.get("crew", [])
                     if isinstance(person, dict) and person.get("job") == "Director"]
            lead_role = "Director"
        else:
            leads = [person for person in value.get("created_by", [])
                     if isinstance(person, dict)]
            lead_role = "Creator"
        creative = [{
            "id": int(person.get("id", 0) or 0),
            "name": str(person.get("name") or "")[:160],
            "profile_path": str(person.get("profile_path") or ""),
            "role": lead_role,
        } for person in leads if person.get("name")][:4]
        countries = [str(country.get("name") or "")[:100]
                     for country in value.get("production_countries", [])
                     if isinstance(country, dict) and country.get("name")]
        return {
            "genres": [str(genre.get("name") or "")[:80]
                       for genre in value.get("genres", [])
                       if isinstance(genre, dict) and genre.get("name")],
            "cast": cast,
            "creative": creative,
            "original_language": str(value.get("original_language") or "")[:12],
            "countries": countries[:4],
            "checked": time.time(),
        }

    def adult_insights_missing(self, watched: dict[str, dict[str, Any]],
                               cache: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        failures = cache.get("failures", {})
        now = time.time()
        return [(key, item) for key, item in watched.items()
                if key not in cache["titles"] and
                now - float(failures.get(key, 0) or 0) > 6 * 60 * 60]

    def start_adult_insights_enrichment(self) -> None:
        if not self.tmdb_key() or self.adult_insights_closed.is_set():
            return
        with self.adult_insights_lock:
            if self.adult_insights_worker and self.adult_insights_worker.is_alive():
                return
            self.adult_insights_worker = threading.Thread(
                target=self.enrich_adult_insights,
                name="mabeltv-adult-insights", daemon=True)
            self.adult_insights_worker.start()

    def enrich_adult_insights(self) -> None:
        with self.config_lock:
            store = self.adult_viewing_store()
            watched = {key: dict(item) for key, item in store["titles"].items()
                       if isinstance(item, dict) and self.adult_insights_watched(item)}
            cache = self.adult_insights_cache()
            missing = self.adult_insights_missing(watched, cache)
        changed = 0
        for key, item in missing:
            if self.adult_insights_closed.is_set():
                break
            media_type, raw_id = key.split(":", 1)
            try:
                value = self.tmdb_request(f"{media_type}/{raw_id}", {
                    "language": "en-GB", "append_to_response": "credits",
                })
                if not isinstance(value, dict):
                    raise ValueError("TMDB returned no title metadata")
                metadata = self.adult_insights_metadata(value, media_type)
                with self.config_lock:
                    cache["titles"][key] = metadata
                    cache["failures"].pop(key, None)
                changed += 1
            except (OSError, ValueError):
                with self.config_lock:
                    cache["failures"][key] = time.time()
                changed += 1
            if changed % 10 == 0:
                with self.config_lock:
                    self.write_adult_insights_cache(cache)
            self.adult_insights_closed.wait(0.14)
        if changed:
            with self.config_lock:
                self.write_adult_insights_cache(cache)

    @staticmethod
    def adult_insights_people(metadata: dict[str, dict[str, Any]], field: str,
                              ratings: dict[str, int]) -> list[dict[str, Any]]:
        appearances: Counter[tuple[int, str, str]] = Counter()
        scores: defaultdict[tuple[int, str, str], list[int]] = defaultdict(list)
        for key, value in metadata.items():
            for person in value.get(field, []) if isinstance(value, dict) else []:
                if not isinstance(person, dict) or not person.get("name"):
                    continue
                identity = (int(person.get("id", 0) or 0), str(person["name"]),
                            str(person.get("profile_path") or ""))
                appearances[identity] += 1
                if ratings.get(key):
                    scores[identity].append(ratings[key])
        return [{
            "tmdb_id": identity[0], "name": identity[1],
            "profile_path": identity[2], "titles": count,
            "average_rating": round(sum(scores[identity]) / len(scores[identity]), 1)
            if scores[identity] else 0,
        } for identity, count in appearances.most_common(12)]

    @staticmethod
    def adult_insights_breakdown(counter: Counter[str], total: int,
                                 limit: int = 12) -> list[dict[str, Any]]:
        return [{"label": label, "count": count,
                 "share": round(count / total, 4) if total else 0}
                for label, count in counter.most_common(limit)]

    def adult_insights_payload(self, watched: dict[str, dict[str, Any]],
                               cache: dict[str, Any]) -> dict[str, Any]:
        titles = []
        ratings: dict[str, int] = {}
        rating_counts: Counter[str] = Counter()
        media_types: Counter[str] = Counter()
        decades: Counter[str] = Counter()
        genres: Counter[str] = Counter()
        languages: Counter[str] = Counter()
        countries: Counter[str] = Counter()
        genre_scores: defaultdict[str, list[int]] = defaultdict(list)
        metadata = {key: value for key, value in cache["titles"].items()
                    if key in watched and isinstance(value, dict)}
        for key, item in watched.items():
            try:
                rating = int(item.get("personal_rating", 0) or 0)
            except (TypeError, ValueError):
                rating = 0
            if 1 <= rating <= 10:
                ratings[key] = rating
                rating_counts[str(rating)] += 1
            media_type = str(item.get("media_type") or key.split(":", 1)[0])
            media_types["Films" if media_type == "movie" else "Series"] += 1
            year = str(item.get("year") or "")[:4]
            if year.isdigit():
                decades[f"{year[:3]}0s"] += 1
            detail = metadata.get(key, {})
            title_genres = list(dict.fromkeys(str(value)
                                for value in detail.get("genres", []) if value))
            for genre in title_genres:
                genres[str(genre)] += 1
                if rating:
                    genre_scores[str(genre)].append(rating)
            language = str(detail.get("original_language") or "").upper()
            if language:
                languages[language] += 1
            for country in dict.fromkeys(detail.get("countries", [])):
                countries[str(country)] += 1
            titles.append({
                "key": key, "media_type": media_type,
                "tmdb_id": int(item.get("tmdb_id", 0) or 0),
                "title": str(item.get("title") or "Untitled"), "year": year,
                "poster_path": str(item.get("poster_path") or ""),
                "rating": rating, "genres": title_genres,
                "language": language,
                "countries": list(dict.fromkeys(str(value)
                                  for value in detail.get("countries", []) if value)),
                "cast_ids": [int(person.get("id", 0) or 0)
                             for person in detail.get("cast", [])
                             if isinstance(person, dict) and person.get("id")],
                "creative_ids": [int(person.get("id", 0) or 0)
                                 for person in detail.get("creative", [])
                                 if isinstance(person, dict) and person.get("id")],
                "on_mabeltv": bool(item.get("on_mabeltv")),
                "watchlisted": bool(item.get("watchlisted")),
            })
        rating_values = sorted(ratings.values())
        median = 0
        if rating_values:
            middle = len(rating_values) // 2
            median = rating_values[middle] if len(rating_values) % 2 else round(
                (rating_values[middle - 1] + rating_values[middle]) / 2, 1)
        genre_rating = [{"label": label, "average": round(sum(values) / len(values), 1),
                         "rated_titles": len(values)}
                        for label, values in genre_scores.items() if len(values) >= 2]
        genre_rating.sort(key=lambda value: (-value["average"], -value["rated_titles"],
                                             value["label"]))
        highest_rated = sorted((item for item in titles if item["rating"]),
                               key=lambda item: (-item["rating"], item["title"]))[:12]
        total = len(titles)
        enriched = len(metadata)
        return {
            "summary": {
                "watched": total, "films": media_types["Films"],
                "series": media_types["Series"], "rated": len(ratings),
                "unrated": total - len(ratings),
                "rating_coverage": round(len(ratings) / total, 4) if total else 0,
                "average_rating": round(sum(rating_values) / len(rating_values), 1)
                if rating_values else 0,
                "median_rating": median,
                "loved": sum(value >= 8 for value in rating_values),
            },
            "ratings": [{"label": str(value), "count": rating_counts[str(value)]}
                        for value in range(1, 11)],
            "media_types": self.adult_insights_breakdown(media_types, total),
            "genres": self.adult_insights_breakdown(genres, total),
            "decades": [{"label": label, "count": decades[label]}
                        for label in sorted(decades)],
            "languages": self.adult_insights_breakdown(languages, enriched, 8),
            "countries": self.adult_insights_breakdown(countries, enriched, 8),
            "actors": self.adult_insights_people(metadata, "cast", ratings),
            "creative": self.adult_insights_people(metadata, "creative", ratings),
            "genre_ratings": genre_rating[:8],
            "highest_rated": highest_rated,
            "titles": sorted(titles, key=lambda item: item["title"].casefold()),
            "recent_posters": sorted(titles, key=lambda item: item["title"])[:16],
            "enrichment": {
                "complete": enriched >= total, "enriched": enriched, "total": total,
                "tmdb_configured": bool(self.tmdb_key()),
                "failed": sum(key in cache["failures"] for key in watched),
            },
            "basis": "Adult TV watched history and personal ratings",
        }

    def adult_insights(self) -> dict[str, Any]:
        with self.config_lock:
            store = self.adult_viewing_store()
            watched = {key: deepcopy(item) for key, item in store["titles"].items()
                       if isinstance(item, dict) and self.adult_insights_watched(item)}
            cache = self.adult_insights_cache()
            payload = self.adult_insights_payload(watched, cache)
        if not payload["enrichment"]["complete"]:
            self.start_adult_insights_enrichment()
        return payload
