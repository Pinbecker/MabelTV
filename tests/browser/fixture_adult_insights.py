"""Deterministic Adult TV insight data for browser contracts."""

from __future__ import annotations

from typing import Any


def adult_insights_fixture() -> dict[str, Any]:
    title_specs = (
        (1001, "Snowy Adventure", "1990", "movie", 10,
         ("Drama", "Adventure"), ("Canada",), "EN"),
        (1002, "The Long Way Home", "1998", "movie", 9,
         ("Drama",), ("Canada", "United Kingdom"), "EN"),
        (1003, "Northern Lights", "2004", "tv", 9,
         ("Drama", "Mystery"), ("Canada",), "EN"),
        (1004, "Midnight City", "2012", "movie", 8,
         ("Thriller", "Crime"), ("United States",), "EN"),
        (1005, "A Small Fortune", "2017", "movie", 8,
         ("Comedy", "Romance"), ("United Kingdom",), "EN"),
        (1006, "Blue Harbour", "2020", "tv", 8,
         ("Drama",), ("France",), "FR"),
        (1007, "The Last Signal", "2021", "movie", 7,
         ("Thriller",), ("United States",), "EN"),
        (1008, "Summer House", "2022", "tv", 7,
         ("Comedy",), ("United Kingdom",), "EN"),
        (1009, "Parallel Lines", "2023", "movie", 6,
         ("Drama",), ("United States",), "EN"),
        (1010, "Night Train", "2024", "movie", 0,
         ("Crime",), ("Germany",), "DE"),
        (1011, "The Great Escape Plan", "2025", "tv", 0,
         ("Action",), ("United States",), "EN"),
        (1012, "After the Rain", "2026", "movie", 0,
         ("Romance",), ("France",), "FR"),
    )
    titles = [{
        "key": f"{media_type}:{identifier}", "media_type": media_type,
        "tmdb_id": identifier, "title": title, "year": year,
        "poster_path": "", "rating": rating,
        "genres": list(genres), "countries": list(countries),
        "language": language, "cast_ids": [1, 2],
        "creative_ids": [20], "on_mabeltv": False, "watchlisted": False,
    } for identifier, title, year, media_type, rating, genres, countries,
        language in title_specs]
    return {
        "summary": {"watched": 146, "films": 104, "series": 42,
                    "rated": 38, "unrated": 108, "rating_coverage": .2603,
                    "average_rating": 7.4, "median_rating": 8, "loved": 24},
        "ratings": [{"label": str(score), "count": count} for score, count in
                    enumerate([0, 0, 1, 1, 2, 3, 5, 8, 11, 5, 2]) if score],
        "media_types": [{"label": "Films", "count": 104, "share": .7123},
                        {"label": "Series", "count": 42, "share": .2877}],
        "genres": [{"label": label, "count": count, "share": count / 146}
                   for label, count in (("Drama", 68), ("Comedy", 51),
                                        ("Thriller", 33), ("Action", 29),
                                        ("Crime", 24), ("Romance", 19))],
        "decades": [{"label": label, "count": count} for label, count in
                    (("1980s", 12), ("1990s", 29), ("2000s", 38),
                     ("2010s", 44), ("2020s", 23))],
        "languages": [{"label": "EN", "count": 129, "share": .88},
                      {"label": "FR", "count": 8, "share": .05}],
        "countries": [{"label": "United States", "count": 88, "share": .6},
                      {"label": "United Kingdom", "count": 41, "share": .28},
                      {"label": "Canada", "count": 3, "share": .02}],
        "actors": [{"tmdb_id": index + 1, "name": name, "profile_path": "",
                    "titles": 12 - index, "average_rating": 0}
                   for index, name in enumerate(("Michael Caine", "Olivia Colman",
                                                "Tom Hanks", "Kate Winslet",
                                                "Hugh Jackman", "Emma Thompson",
                                                "Daniel Craig", "Julie Walters"))],
        "creative": [{"tmdb_id": index + 20, "name": name, "profile_path": "",
                      "titles": 8 - index, "average_rating": 0}
                     for index, name in enumerate(("Steven Spielberg", "Christopher Nolan",
                                                  "Greta Gerwig", "Martin Scorsese"))],
        "genre_ratings": [],
        "highest_rated": [value for value in titles if value["rating"]][:9],
        "titles": titles,
        "recent_posters": [],
        "enrichment": {"complete": True, "enriched": 146, "total": 146,
                       "tmdb_configured": True, "failed": 0},
        "basis": "Adult TV watched history and personal ratings",
    }
