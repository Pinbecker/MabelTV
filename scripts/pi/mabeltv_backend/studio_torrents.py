"""Checked torrent search/inspection requests; media transfers stay in Studio."""
from pathlib import PurePosixPath
import re
import time
import uuid
from urllib.parse import parse_qs, urlencode, urlsplit

VIDEO_SUFFIXES = {".mp4", ".mkv", ".m4v", ".mov", ".avi", ".webm", ".mpg", ".mpeg", ".ts"}


class StudioTorrentsMixin:
    @staticmethod
    def studio_torrent_files(values):
        if not isinstance(values, list) or len(values) > 5000:
            raise ValueError("The download file list is unavailable")
        result, indexes, names = [], set(), set()
        for value in values:
            index, name, size = value.get("index"), str(value.get("path", "")), value.get("bytes")
            path = PurePosixPath(name)
            if type(index) is not int or index < 0 or index in indexes or type(size) is not int or not 0 <= size <= 4 * 1024 ** 4:
                raise ValueError("The download file details changed")
            if not name or len(name) > 700 or path.is_absolute() or re.search(r'[\\:<>"|?*\x00-\x1f]', name) or any(part in {"", ".", ".."} or part.endswith((".", " ")) for part in name.split("/")) or name.casefold() in names:
                raise ValueError("The download file path is unsupported")
            item = {"index": index, "path": name, "bytes": size}
            episode = re.search(r"\bS(\d{1,2})E(\d{1,3})(?!\d)|\b(\d{1,2})x(\d{1,3})(?!\d)", name, re.I)
            if episode:
                item.update(series=int(episode[1] or episode[3]), episodeNumber=int(episode[2] or episode[4]))
            result.append(item)
            indexes.add(index)
            names.add(name.casefold())
        return result

    @staticmethod
    def studio_torrent_magnet(value, expected_hash):
        parsed = urlsplit(str(value))
        if len(str(value)) > 16000 or parsed.scheme != "magnet" or parsed.netloc or parsed.fragment:
            raise ValueError("Choose a valid download result")
        query = parse_qs(parsed.query)
        if len(query.get("xt", [])) != 1 or query["xt"][0].casefold() != "urn:btih:" + expected_hash:
            raise ValueError("The download identity changed. Search again.")
        # Admit identity and the reviewed plugin's public trackers, never
        # provider-supplied file URLs, executable hooks or webseed addresses.
        trackers = {"tracker.opentrackr.org", "open.stealth.si", "exodus.desync.com",
                    "tracker.openbittorrent.com", "tracker.torrent.eu.org", "www.torrent.eu.org",
                    "tracker.internetwarriors.net", "p4p.arenabg.ch", "retracker.lanta-net.ru", "tracker.tiny-vps.com"}
        parameters = [("xt", "urn:btih:" + expected_hash)]
        if query.get("dn"):
            parameters.append(("dn", str(query["dn"][0])[:240]))
        for tracker in query.get("tr", [])[:16]:
            address = urlsplit(tracker)
            if address.scheme in {"udp", "http", "https"} and address.hostname in trackers and not address.username and not address.password:
                parameters.append(("tr", tracker))
        return "magnet:?" + urlencode(parameters)

    def _studio_torrent_request(self, kind, query, source=None, refresh=False):
        requests = self.state_database.studio_records("request")
        if not refresh:
            existing = next((item for item in requests if item["kind"] == kind and
                item["query"].casefold() == query.casefold() and item.get("source") == source and
                item["status"] in {"queued", "active", "complete"} and time.time() - item["created"] < 900), None)
            if existing:
                return self._studio_public_request(existing)
        value = {"id": uuid.uuid4().hex, "kind": kind, "query": query, "source": source,
                 "status": "queued", "created": time.time(), "updated": time.time()}
        self.state_database.studio_add("request", value)
        return self._studio_public_request(value)

    def studio_torrent_search(self, payload):
        query = str(payload.get("query", "")).strip()
        if not 2 <= len(query) <= 160 or any(ord(letter) < 32 for letter in query):
            raise ValueError("Enter a film or TV title")
        return self._studio_torrent_request("torrent-search", query, refresh=payload.get("refresh") is True)

    def _studio_torrent_result(self, identity, kind):
        record = next((item for item in self.state_database.studio_records("request") if
                       item["id"] == identity and item["kind"] == kind and item["status"] == "complete"), None)
        if not record or not isinstance(record.get("result"), dict):
            raise ValueError("Those download details expired. Search again.")
        return record

    def studio_torrent_inspect(self, payload):
        search = self._studio_torrent_result(str(payload.get("request", "")), "torrent-search")
        identity = str(payload.get("hash", "")).lower()
        if not re.fullmatch(r"[a-f0-9]{40}", identity):
            raise ValueError("Choose a download result")
        item = next((item for item in search["result"].get("items", []) if item.get("hash") == identity), None)
        if not item:
            raise ValueError("Choose a result from this search")
        source = {"hash": identity, "magnet": self.studio_torrent_magnet(item.get("magnet"), identity),
                  "title": str(item.get("title", search["query"]))[:240]}
        return self._studio_torrent_request("torrent-inspect", identity, source, payload.get("refresh") is True)

    def studio_torrent_source(self, value):
        request = self._studio_torrent_result(str(value.get("request", "")), "torrent-inspect")
        result, frozen = request["result"], request["source"]
        if result.get("hash") != frozen["hash"]:
            raise ValueError("The download identity changed. Get its details again.")
        selected = value.get("files")
        if not isinstance(selected, list) or not 1 <= len(selected) <= 200 or any(type(index) is not int or index < 0 for index in selected) or len(set(selected)) != len(selected):
            raise ValueError("Choose between 1 and 200 video files")
        available = result.get("files")
        if not isinstance(available, list) or len(available) > 5000:
            raise ValueError("The download file list is unavailable")
        files = []
        for index in selected:
            item = next((item for item in available if item.get("index") == index), None)
            if not item:
                raise ValueError("A selected file is no longer in this download")
            name = str(item.get("path", ""))
            path = PurePosixPath(name)
            if not name or len(name) > 700 or path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name or path.suffix.lower() not in VIDEO_SUFFIXES:
                raise ValueError("Choose supported film or TV video files")
            size = item.get("bytes")
            if type(size) is not int or not 1 <= size <= 4 * 1024 ** 4:
                raise ValueError("The file size could not be confirmed")
            files.append({"index": index, "path": name, "bytes": size})
        return {"type": "torrent", **frozen, "files": sorted(files, key=lambda item: item["index"]),
                "bytes": sum(item["bytes"] for item in files), "inspection": request["id"]}

    def studio_torrent_worker_responses(self, responses):
        """Bound provider content before storing or rendering it."""
        requests = {item["id"]: item for item in self.state_database.studio_records("request")}
        checked = []
        for response in responses:
            current = requests.get(response.get("id"), {})
            kind = current.get("kind")
            if not str(kind).startswith("torrent-") or response.get("error"):
                checked.append(response)
                continue
            try:
                data = response.get("result")
                if not isinstance(data, dict):
                    raise ValueError("Download search returned invalid details. Try again.")
                if kind == "torrent-search":
                    items = []
                    for item in data.get("items", [])[:100]:
                        identity = str(item.get("hash", "")).lower()
                        if not re.fullmatch(r"[a-f0-9]{40}", identity):
                            continue
                        title = str(item.get("title", "")).strip()[:240]
                        if not title or any(ord(letter) < 32 for letter in title):
                            continue
                        size = item.get("bytes")
                        if type(size) is not int or not 0 < size <= 4 * 1024 ** 4:
                            continue
                        items.append({"hash": identity, "title": title, "bytes": size,
                            "seeders": max(0, min(10000000, int(item.get("seeders", 0)))),
                            "leechers": max(0, min(10000000, int(item.get("leechers", 0)))),
                            "magnet": self.studio_torrent_magnet(item.get("magnet"), identity)})
                    unique = {item["hash"]: item for item in items}
                    result = {"items": sorted(unique.values(), key=lambda item: (-item["seeders"], item["title"]))[:10]}
                else:
                    if data.get("hash") != current["source"]["hash"] or not isinstance(data.get("files"), list) or len(data["files"]) > 5000:
                        raise ValueError("Download file details did not match. Try again.")
                    files = self.studio_torrent_files(data["files"])
                    result = {"hash": data["hash"], "title": str(data.get("title", current["source"]["title"]))[:240],
                              "files": files, "bytes": sum(item["bytes"] for item in files)}
                checked.append({**response, "result": result})
            except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
                checked.append({"id": response.get("id"), "claim": response.get("claim"),
                                "error": "Download details could not be verified. Try again."})
        return checked
