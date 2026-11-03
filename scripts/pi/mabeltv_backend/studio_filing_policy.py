"""Deterministic media layout: loose films, collection folders, preserved TV names."""
from pathlib import PurePosixPath
import re

POLICY_VERSION = 4


def component(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(value))
    value = re.sub(r"\s+", " ", value).strip(" .")[:100].rstrip(" .") or "Untitled"
    if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", value):
        value = "_" + value
    return value


def normal(value):
    value = re.sub(r"\b(?:19|20)\d{2}\b|\[[a-f0-9]{8,32}\]", "", str(value), flags=re.I)
    value = re.split(r"(?i)\b(?:480p|720p|1080p|2160p|bluray|web[ -]?dl|x26[45]|hevc)\b", value)[0]
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def collection_members(title, collection, titles, records):
    """Count distinct owned films, including saved links and existing folders."""
    if not collection or not collection.get("id"):
        return ()
    def identity(item):
        metadata = item.get("metadata") or {}
        return "movie:" + str(metadata["tmdb_id"]) if metadata.get("tmdb_id") else normal(PurePosixPath(item["path"]).stem)
    by_id = {item["id"]: item for item in titles}
    members = {identity(title)}
    root = PurePosixPath("Kids/Films" if title.get("category") == "kids" else "Films")
    folder = normal(re.sub(r"\s+Collection$", "", str(collection.get("name", "")), flags=re.I))
    for item in titles:
        path = PurePosixPath(item["path"])
        if len(path.parts) > len(root.parts) + 1 and path.is_relative_to(root) and normal(path.parts[len(root.parts)]) == folder:
            members.add(identity(item))
    for record in records:
        saved = record.get("collection") or {}
        item = by_id.get(record["id"])
        if item and saved.get("id") == collection["id"] and saved.get("matchKey") == identity(item):
            members.add(identity(item))
    return tuple(sorted(members))


def movie_folder(title, details, origin, collection_size=1):
    path = PurePosixPath(origin)
    parts = path.parts
    kids = title.get("category") == "kids" or parts[0].casefold() == "kids"
    genres = {item.get("id") for item in details.get("genres", []) if isinstance(item, dict)}
    releases = details.get("release_dates", {}).get("results", [])
    ratings = {item.get("certification") for region in releases if region.get("iso_3166_1") == "GB"
               for item in region.get("release_dates", [])}
    family = 10762 in genres or 10751 in genres and bool(ratings & {"U", "PG"})
    companies = " ".join(str(item.get("name", "")) for item in details.get("production_companies", [])).casefold()
    writers = {normal(item.get("name", "")) for item in details.get("credits", {}).get("crew", [])
               if item.get("department") == "Writing" or item.get("job") in {"Writer", "Book", "Novel", "Story", "Characters"}}
    brand = "Julia Donaldson" if "juliadonaldson" in writers else (
        "Disney" if "walt disney" in companies or "pixar" in companies else "")
    if brand and (kids or family or brand == "Julia Donaldson"):
        kids = True
    base = PurePosixPath("Kids/Films" if kids else "Films")
    start = 2 if len(parts) > 1 and parts[0].casefold() == "kids" and parts[1].casefold() == "films" else 1
    directories = list(parts[start:-1]) if parts[0].casefold() in {"films", "kids"} else []
    names = {normal(title["metadata"]["title"]), normal(path.stem)}
    while directories and normal(directories[-1]) in names:
        directories.pop()
    directories = [value for value in directories if not re.fullmatch(r"[a-f0-9]{32}|(?:Season|Series)\s*\d+", value, re.I)]
    # Only the owner's explicitly named groups and actual film franchises.
    approved = {"disney": "Disney", "pixar": "Disney", "juliadonaldson": "Julia Donaldson",
                "mcu": "MCU", "marvelcinematicuniverse": "MCU"}
    explicit = next((approved[normal(value)] for value in directories if normal(value) in approved), None)
    if explicit:
        if explicit == "MCU":
            return PurePosixPath("Films/MCU")
        return PurePosixPath("Kids/Films") / explicit
    if brand and kids:
        return base / brand
    collection = details.get("belongs_to_collection")
    if collection_size >= 2 and isinstance(collection, dict) and type(collection.get("id")) is int and collection["id"] > 0 and collection.get("name"):
        name = re.sub(r"\s+Collection$", "", str(collection["name"]), flags=re.I)
        return base / component(name)
    return base


def series_target(title, member, origin, details=None):
    source = PurePosixPath(origin)
    season = next((index for index, part in enumerate(source.parts[:-1])
                   if re.fullmatch(r"(?:Season|Series)\s*\d{1,2}", part, re.I)), None)
    if season is not None and season > 0:
        parent = PurePosixPath(*source.parts[:season + 1])
        if source.parts[0] == "TV" and any(genre.get("id") == 10762 for genre in (details or {}).get("genres", [])):
            parent = PurePosixPath("Kids", *parent.parts)
    else:
        root = "Kids/TV" if title.get("category") == "kids" else "TV"
        parent = PurePosixPath(root, component(title["metadata"]["title"]), f"Season {member['series']:02d}")
    if re.search(r"\bS\d{1,2}E\d{1,3}\b", source.stem, re.I):
        return parent / source.name
    return parent / (f"S{member['series']:02d}E{member['episodeNumber']:02d} - " + component(source.stem) + source.suffix.lower())
