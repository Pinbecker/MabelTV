"""Family-safe audio, photographs and memory playback; never the My TV library."""
from __future__ import annotations

import json
import random
import socket
import threading
import time
import uuid
from pathlib import Path

from .memory_composition import memory_compositions


class FamilyMediaMixin:
    def initialise_family_media(self):
        self.family_root = self.media_root / ".family-media"
        for name in ("originals", "prepared", "artwork"):
            (self.family_root / name).mkdir(parents=True, exist_ok=True)
        self.family_sessions = {}
        self.family_session_lock = threading.RLock()

    def family_path(self, relative):
        root = self.media_root.resolve()
        path = (root / str(relative)).resolve()
        if root not in path.parents or path.is_symlink():
            raise ValueError("Invalid family-media path")
        return path

    def family_media(self):
        data = self.state_database.family_catalogue()
        assets = {}
        for saved in data["assets"]:
            item = {key: value for key, value in saved.items()
                    if key not in {"source_path", "prepared_path", "artwork_path", "channel_id", "upload_id"}}
            item["media_url"] = f"/api/family-media/content?id={item['id']}"
            available = saved["status"] == "ready" and bool(saved["prepared_path"]) and self.family_path(saved["prepared_path"]).is_file()
            if saved["status"] == "ready" and not available:
                item.update(status="error", error="The prepared file is missing. Remove this item and upload the original again.")
            item["available"] = available
            manifest = self.read_json(self.incoming / f"{saved['upload_id']}.json", {}) if item["status"] == "error" else {}
            item["can_retry"] = bool(item["status"] == "error" and manifest.get("status") == "error"
                                     and self.family_upload_source_ready(manifest))
            artwork = self.family_path(saved["artwork_path"]) if available and saved["artwork_path"] else None
            item["artwork_url"] = (f"/api/family-media/content?id={item['id']}&artwork=1&v={artwork.stat().st_mtime_ns}"
                                   if artwork and artwork.is_file() else "")
            assets[item["id"]] = item
        for story in data["stories"]:
            story["audio"] = assets.get(story["audio_id"])
            story["image"] = assets.get(story["image_id"])
            story["ready"] = bool(story["audio"] and story["audio"]["status"] == "ready"
                                  and story["image"] and story["image"]["status"] == "ready")
        return {"assets": list(assets.values()), "stories": data["stories"],
                "memory_settings": data["memory_settings"]}

    def family_content(self, identity, artwork=False):
        item = self.state_database.family_asset(str(identity))
        if item["status"] != "ready":
            raise ValueError("This item is still being prepared")
        relative = item["artwork_path"] if artwork else item["prepared_path"]
        if not relative:
            raise ValueError("This item has no artwork")
        path = self.family_path(relative)
        if not path.is_file():
            raise ValueError("Family media not found")
        return path

    def family_stories_native(self):
        stories = []
        for story in self.family_media()["stories"]:
            image = story["image"]
            illustration = self.family_content(image["id"]).as_uri() if image and image["available"] else ""
            stories.append({"id": story["id"], "title": story["title"], "ready": story["ready"],
                            "position": story["position_seconds"], "illustration": illustration})
        sound = Path(__file__).resolve().parent.parent / "portal/assets/storytime/page-turn.ogg"
        return {"stories": stories, "page_sound": sound.as_uri() if sound.is_file() else ""}

    def family_action(self, payload, *, cancelled_upload=False):
        action = str(payload.get("action", ""))
        if action.startswith("story-"):
            identity = self.state_database.storytime_change(action[6:], payload)
            return {"ok": True, "id": identity, **self.family_media()}
        if action == "memory-settings":
            self.state_database.memory_settings_save(int(payload.get("channel", 0)), payload)
        elif action == "retry":
            item = self.state_database.family_asset(str(payload.get("id", "")))
            self.upload_action(item["upload_id"], "retry")
        elif action == "remove":
            item = self.state_database.family_asset(str(payload.get("id", "")))
            if not cancelled_upload and (item["status"] in {"uploading", "processing"}
                    or (self.incoming / f"{item['upload_id']}.json").is_file()):
                self.family_remove_preparation(item)
                return {"ok": True, **self.family_media()}
            self.state_database.family_asset_delete(item["id"])
            # Originals remain available for recovery. Only our prepared copies
            # may be removed, and never a file in an existing channel folder.
            for key in ("prepared_path", "artwork_path"):
                path = self.family_path(item[key]) if item[key] else None
                if path and self.family_root.resolve() in path.parents:
                    path.unlink(missing_ok=True)
        elif action == "import-channel":
            self.family_import_channel(int(payload.get("channel", 0)))
        else:
            raise ValueError("Unknown family-media action")
        return {"ok": True, **self.family_media()}

    def family_start(self, payload, *, native=False):
        kind = str(payload.get("kind", ""))
        data = self.state_database.family_catalogue()
        assets = {item["id"]: item for item in data["assets"] if item["status"] == "ready"
                  and item["prepared_path"] and self.family_path(item["prepared_path"]).is_file()}
        if kind == "storytime":
            story = next((item for item in data["stories"] if item["id"] == payload.get("id")), None)
            if not story or story["audio_id"] not in assets or story["image_id"] not in assets:
                raise ValueError("Upload the audio and story illustration first")
            scenes = [{"kind": "audio", "items": [assets[story["image_id"]]],
                       "audio": assets[story["audio_id"]], "title": story["title"]}]
            position = 0 if payload.get("restart") else story["position_seconds"]
            settings = {}
            story_id = story["id"]
        elif kind == "memories":
            channel_number = int(payload.get("channel", 0))
            channel = self.channel(channel_number)
            if channel["content_type"] != "memories":
                raise ValueError("Choose a Photos & Videos channel")
            selected = [item for item in assets.values() if item.get("channel_number") == channel_number
                        and item["kind"] in ("photo", "video")]
            settings = next((value for value in data["memory_settings"] if value["channel_number"] == channel_number),
                            {"ordering": "shuffle", "photo_seconds": 10, "music_volume": 25})
            ordering = str(payload.get("ordering", settings["ordering"]))
            if ordering not in ("ordered", "shuffle"):
                raise ValueError("Choose chronological or shuffled playback")
            if ordering == "shuffle":
                random.SystemRandom().shuffle(selected)
                if len(selected) > 1 and selected[0]["id"] == payload.get("avoid_id"):
                    selected = selected[1:] + selected[:1]
            else:
                selected.sort(key=lambda item: (item["captured"] or item["created"], item["id"]))
            start_id = str(payload.get("id", ""))
            if start_id:
                index = next((index for index, item in enumerate(selected) if item["id"] == start_id), None)
                if index is None:
                    raise ValueError("That memory is no longer available")
                selected = selected[index:] + selected[:index]
            if not selected:
                raise ValueError("Upload some photos or videos first")
            scenes = self.memory_scenes(selected, settings["photo_seconds"])
            position = 0
            story_id = ""
            settings = {**settings, "ordering": ordering, "music": assets.get(settings.get("music_id"))}
        else:
            raise ValueError("Choose Storytime or Family Memories")
        token = uuid.uuid4().hex
        session = {"id": token, "kind": kind, "story_id": story_id,
                   "channel": int(payload.get("channel", 0)),
                   "title": story["title"] if kind == "storytime" else channel["name"],
                   "position": position, "scenes": scenes, "settings": settings, "created": time.time()}
        with self.family_session_lock:
            self.family_sessions = {key: value for key, value in self.family_sessions.items()
                                    if time.time() - value["created"] < 86400}
            self.family_sessions[token] = session
            if len(self.family_sessions) > 64:
                oldest = min(self.family_sessions, key=lambda key: self.family_sessions[key]["created"])
                self.family_sessions.pop(oldest, None)
        if payload.get("target", "tv") == "tv" and not native:
            self.family_player_command({"command": "play-family-media", "session": token, "kind": kind})
        return self.family_session(token, native=native)

    @staticmethod
    def memory_scenes(items, photo_seconds):
        return memory_compositions(items, photo_seconds)

    def family_session(self, identity, *, native=False):
        with self.family_session_lock:
            session = self.family_sessions.get(str(identity))
            if not session or time.time() - session["created"] > 86400:
                raise ValueError("This family-media session has ended")
            value = json.loads(json.dumps(session))
        def project(item):
            if not item:
                return None
            public = {key: data for key, data in item.items() if not key.endswith("_path")}
            if native:
                public["source"] = self.family_content(item["id"]).as_uri()
                public["artwork"] = self.family_content(item["id"], True).as_uri() if item["artwork_path"] else ""
            else:
                public["source"] = f"/api/family-media/content?id={item['id']}"
                public["artwork"] = public["source"] + "&artwork=1" if item["artwork_path"] else ""
            return public
        for scene in value["scenes"]:
            scene["items"] = [project(item) for item in scene["items"]]
            if "audio" in scene:
                scene["audio"] = project(scene["audio"])
        value["settings"]["music"] = project(value["settings"].get("music"))
        return value

    @staticmethod
    def family_player_command(command):
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((json.dumps(command) + "\n").encode())
                reply = client.recv(64).decode().strip()
            if reply != "ok":
                raise ValueError("The TV could not accept that family-media control")
        except OSError as error:
            raise ValueError("The TV player is not ready") from error

    def family_control(self, payload):
        action = str(payload.get("action", ""))
        if action == "open-storytime":
            self.family_player_command({"command": "open-storytime"})
        elif action == "progress":
            session = self.family_session(str(payload.get("session", "")))
            if session["story_id"]:
                self.state_database.storytime_change("progress", {"id": session["story_id"],
                    "position": payload.get("position", 0)})
        elif action in ("pause", "next", "previous", "restart", "close", "seek"):
            import math
            position = float(payload.get("position", 0))
            if not math.isfinite(position) or not 0 <= position <= 86400:
                raise ValueError("Invalid listening position")
            self.family_player_command({"command": "family-media-control", "action": action, "position": position})
        else:
            raise ValueError("Unknown family playback control")
        return {"ok": True}
