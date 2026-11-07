"""Current-file identity checks and explicitly chosen TV replacements."""
import hashlib
import re


class StudioPresenceMixin:
    def studio_local_copies(self):
        copies = []
        for name, state in self.my_tv_media_states().items():
            copies.append((state.get("metadata", {}), {"kind": "my_tv", "file": name},
                           "My TV", None, None))
        states = self.my_tv_series_states()
        for key, episode in states["episodes"].items():
            identity, _, name = key.partition("/")
            series = states["series"].get(identity, {})
            number = re.search(r"\bS(\d{1,2})E(\d{1,3})\b", name, re.I)
            copies.append((series.get("metadata", {}), {"kind": "my-tv-series", "series": identity, "file": name},
                "My TV · " + series.get("title", "Series"), int(number[1]) if number else episode.get("season"),
                int(number[2]) if number else episode.get("episode")))
        states = self.channel_media_states()
        for channel in self.channels():
            for key, metadata in states.get("programmes", {}).items():
                prefix = str(channel["number"]) + "/"
                if not key.startswith(prefix):
                    continue
                name = key[len(prefix):]
                number = re.search(r"\bS(\d{1,2})E(\d{1,3})\b", name, re.I)
                copies.append((metadata, {"kind": "channel", "channel": channel["number"], "file": name},
                    "Mabel TV · " + channel["name"], int(number[1]) if number else metadata.get("season"),
                    int(number[2]) if number else metadata.get("episode")))
        result = []
        for metadata, source, location, season, episode in copies:
            if not metadata.get("tmdb_id"):
                continue
            try:
                _, path, title, _, _ = self.remote_source(source)
                stat = path.stat()
            except (ValueError, OSError):
                continue
            key = hashlib.sha256(str(path).encode()).hexdigest()[:24]
            result.append({"key": key, "source": source, "location": location, "name": path.name,
                "title": metadata.get("title") or title, "bytes": stat.st_size,
                "fingerprint": [stat.st_size, str(stat.st_mtime_ns), str(stat.st_ino)],
                "tmdb_id": metadata["tmdb_id"], "media_type": metadata.get("media_type", "tv" if season is not None else "movie"),
                "season": season, "episode": episode})
        return result

    def studio_presence(self, payload):
        identities = payload.get("ids", [])
        if not isinstance(identities, list) or not 1 <= len(identities) <= 100:
            raise ValueError("Choose up to 100 iCloud files")
        copies, results = self.studio_local_copies(), []
        for identity in dict.fromkeys(identities):
            item = self.studio_cloud_item(str(identity))
            title = self.studio_cloud_title_for_file(item["id"])
            match = title.get("metadata") or {}
            matches = [copy for copy in copies if copy["tmdb_id"] == match.get("tmdb_id")
                and copy["media_type"] == match.get("media_type", "movie")
                and (copy["media_type"] == "movie" or type(item.get("episodeNumber")) is int
                     and item.get("series") == copy["season"] and item["episodeNumber"] == copy["episode"])]
            results.append({"id": identity, "copies": matches})
        return {"items": results}

    def studio_choose_existing(self, source, destination):
        """Recheck identity and frozen file before admitting a replace/keep job."""
        choice = source.get("existingCopy")
        if not choice:
            return False
        if not isinstance(choice, dict) or choice.get("mode") not in {"keep", "replace", "alongside"}:
            raise ValueError("Choose whether to keep, replace or keep both copies")
        matches = self.studio_presence({"ids": [source["id"]]})["items"][0]["copies"]
        copy = next((value for value in matches if value["key"] == choice.get("key")), None)
        if not copy or copy["fingerprint"] != choice.get("fingerprint"):
            raise ValueError("The TV copy changed. Check the existing versions again")
        if choice["mode"] == "keep":
            return True
        if choice["mode"] == "alongside":
            return False
        expected = {"film": "my_tv", "series": "my-tv-series", "mabel": "channel"}.get(destination["kind"])
        ref = copy["source"]
        if expected != ref["kind"] or expected == "my-tv-series" and ref["series"] != destination.get("series") or expected == "channel" and ref["channel"] != destination.get("channel"):
            raise ValueError("Choose the same TV library to replace this copy, or keep both")
        _, path, _, _, _ = self.remote_source(ref)
        receipt = {"kind": ref["kind"], "file_name": path.name, "complete": True}
        if expected == "my_tv":
            receipt["folder"] = self.my_tv_relative_path(path).rpartition("/")[0]
        elif expected == "my-tv-series":
            receipt.update(series_id=ref["series"], season=copy["season"])
        else:
            receipt["channel"] = ref["channel"]
        destination.update(recoveryMode="replace", replaceFrozen={"receipt": receipt,
            **dict(zip(("bytes", "mtime", "inode"), map(int, copy["fingerprint"])))})
        return False
