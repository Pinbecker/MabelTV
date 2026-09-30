"""Parent-facing Mabel TV playback queue controls."""

from __future__ import annotations

import socket
from typing import Any


class MabelQueueMixin:
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
        if action == "start":
            if not self.mabel_queue()["items"]:
                raise ValueError("Add a film or episode before starting the queue")
            state = self.read_state("player")
            if isinstance(state, dict) and state.get("standby"):
                self.live_tv_control({"command": "turn-on"})
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(3)
                    client.connect("/run/mabeltv/portal-control.sock")
                    client.sendall(b"start-mabel-queue\n")
                    reply = client.recv(32).decode(errors="replace").strip()
            except OSError as error:
                raise ValueError("The TV player is not ready to start the queue") from error
            if reply != "ok":
                raise ValueError("The TV could not start the queue")
            return {"ok": True}
        raise ValueError("Unknown queue action")
