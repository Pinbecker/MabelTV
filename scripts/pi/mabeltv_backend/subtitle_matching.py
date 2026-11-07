"""Bounded exact-file matching; title popularity is not a timing match."""
import struct


def movie_hash(source):
    size = source.stat().st_size
    if size < 131072:
        return ""
    with source.open("rb") as handle:
        first = handle.read(65536)
        handle.seek(-65536, 2)
        last = handle.read(65536)
    return f"{(size + sum(struct.unpack('<8192Q', first)) + sum(struct.unpack('<8192Q', last))) & 0xffffffffffffffff:016x}"


def exact_matches(response):
    if not isinstance(response, dict):
        return {"data": []}
    return {"data": [item for item in response.get("data", [])
                     if item.get("attributes", {}).get("moviehash_match") is True]}
