"""Parent-facing Mabel TV playback queue controls."""

from __future__ import annotations

import socket
from typing import Any


class MabelQueueMixin:
    def queue_programme(self, identity: str) -> dict[str, Any]:
        item = next((value for value in self.mabel_queue()["items"]
                     if value["id"] == identity), None)
        if not item:
            raise ValueError("That programme is no longer in the queue")
        channel = self.channel(item["channel_number"])
        source = self.safe_media_path(channel, item["file_name"])
        library_channel = next((value for value in self.library()["channels"]
                                if value["number"] == item["channel_number"]), None)
        programme = next((value for value in (library_channel or {}).get("programmes", [])
                          if value["name"] == item["file_name"]), None)
        if not source.is_file() or not library_channel or not library_channel["enabled"] \
                or not programme or not programme["enabled"]:
            raise ValueError("That queued programme is not available. Remove it or choose another one.")
        return item

    @staticmethod
    def queue_socket_command(command: bytes) -> None:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall(command + b"\n")
                reply = client.recv(32).decode(errors="replace").strip()
        except OSError as error:
            raise ValueError("The TV player is not ready for queue playback") from error
        if reply != "ok":
            raise ValueError("The TV could not accept the queue command")

    def play_queue_on_tv(self, identity: str) -> dict[str, Any]:
        item = self.queue_programme(identity)
        player = self.read_state("player")
        if isinstance(player, dict) and player.get("standby"):
            self.live_tv_control({"command": "turn-on"})
        self.state_database.mabel_queue_select(identity, "tv")
        with self.remote_stream_lock:
            if self.remote_stream and self.remote_stream.get("queue_id"):
                self.remote_stream = None
        try:
            self.queue_socket_command(b"start-mabel-queue")
        except ValueError as error:
            self.state_database.mabel_queue_event("failed", "tv", identity, error=str(error))
            raise
        return {"ok": True, "message": f"Starting {item['title']} from Up Next"}

    def mabel_queue(self) -> dict[str, Any]:
        return self.state_database.mabel_queue()

    def mabel_queue_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = str(payload.get("action", ""))
        if action == "add":
            try:
                number = int(payload.get("channel"))
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a channel programme") from error
            filename = str(payload.get("file") or "")
            channel = next((value for value in self.library()["channels"]
                            if value["number"] == number), None)
            if channel is None or not channel["enabled"]:
                raise ValueError("That channel is not available on TV")
            programme = next((value for value in channel["programmes"]
                              if value["name"] == filename), None)
            if programme is None or not programme["enabled"]:
                raise ValueError("That programme is not available on TV")
            source = self.media_root / channel["folder"] / filename
            if not source.is_file():
                raise ValueError("That programme is no longer on the TV")
            metadata = programme.get("metadata") or {}
            return self.state_database.mabel_queue_change("add", {
                "channel_number": number,
                "file_name": filename,
                "title": str(metadata.get("title") or programme["display_name"])[:180],
                "artwork": str(metadata.get("poster") or (channel.get("metadata") or {}).get("artwork")
                               or "")[:250],
                "channel_name": channel["name"][:80],
            })
        if action in {"remove", "up", "down"}:
            return self.state_database.mabel_queue_change(
                action, {"id": str(payload.get("id") or "")})
        if action == "ending":
            return self.state_database.mabel_queue_change(
                action, {"ending": payload.get("ending")})
        if action == "clear":
            return self.state_database.mabel_queue_change(action)
        if action in {"started", "finish", "failed", "pause"}:
            owner = "device:" + str(payload.get("stream") or "")
            session = self.remote_session(str(payload.get("stream") or ""))
            identity = str(payload.get("id") or "")
            if action in {"started", "finish"} and session.get("queue_id") != identity:
                raise ValueError("That playback session is not for this queue entry")
            return self.state_database.mabel_queue_event(
                action, owner, identity, error=str(payload.get("error") or ""))
        if action == "start":
            items = self.mabel_queue()["items"]
            if not items:
                raise ValueError("Add a film or episode before starting the queue")
            return self.play_queue_on_tv(str(payload.get("id") or items[0]["id"]))
        raise ValueError("Unknown queue action")
