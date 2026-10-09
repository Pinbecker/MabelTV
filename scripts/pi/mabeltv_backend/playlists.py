"""Programme validation and presentation for reusable MabelTV playlists."""
from __future__ import annotations


class PlaylistsMixin:
    def mabel_playlists(self):
        channels = {value["number"]: value for value in self.channel_library()}
        result = self.state_database.playlists()
        for playlist in result:
            duration = 0
            for item in playlist["items"]:
                channel = channels.get(item["channel_number"], {})
                programme = next((value for value in channel.get("programmes", [])
                                  if value["name"] == item["file_name"]), {})
                metadata = programme.get("metadata") or {}
                item.update(title=metadata.get("title") or programme.get("display_name") or self.display_name(item["file_name"]),
                            artwork=metadata.get("artwork") or metadata.get("poster")
                            or (channel.get("metadata") or {}).get("artwork")
                            or (channel.get("metadata") or {}).get("poster") or "",
                            available=bool(programme and programme.get("enabled") and channel.get("enabled")),
                            duration=float(programme.get("remote_duration") or metadata.get("runtime", 0) * 60 or 0))
                duration += item["duration"]
            playlist["duration"] = duration
        return {"playlists": result}

    def mabel_playlist_action(self, payload):
        action = str(payload.get("action", ""))
        if action == "add":
            channel = self.channel(int(payload.get("channel", 0)))
            file_name = str(payload.get("file", ""))
            if not self.safe_media_path(channel, file_name).is_file():
                raise ValueError("Programme not found")
        if action in ("play", "append"):
            playlist = next((value for value in self.mabel_playlists()["playlists"]
                             if value["id"] == payload.get("id")), None)
            if not playlist:
                raise ValueError("Playlist not found")
            if any(not item["available"] for item in playlist["items"]):
                raise ValueError("Remove unavailable programmes from this playlist before playing it")
            queue = self.state_database.playlist_copy_to_queue(
                playlist["id"], playlist["items"], replace=action == "play",
                confirmed=payload.get("confirmed") is True)
            if action == "play":
                self.play_queue_on_tv(queue["items"][0]["id"])
            return {"ok": True, "queue": self.mabel_queue(), **self.mabel_playlists()}
        identity = self.state_database.playlist_change(action, payload)
        return {"ok": True, "id": identity, **self.mabel_playlists()}
