"""Small standard-library WebOS client used by LG remote control."""

from __future__ import annotations

import base64
import json
import os
import socket
import ssl
import struct
import sys
from typing import Any

from .constants import LG_WEBOS_DEFAULT_PORT


class RemoteTvActiveError(ValueError):
    """Raised when the conservative one-player rule needs an explicit choice."""


class LgWebOsError(ValueError):
    """A bounded, user-safe failure while controlling the connected LG TV."""


def lg_webos_log(event: str) -> None:
    """Keep narrow, redacted SSAP diagnostics in the service journal."""
    print(f"LG SSAP: {event}", file=sys.stderr, flush=True)


LG_WEBOS_PERMISSIONS = [
    "LAUNCH", "READ_INSTALLED_APPS", "READ_RUNNING_APPS",
    "READ_INPUT_DEVICE_LIST", "READ_POWER_STATE", "CONTROL_AUDIO",
    "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_PLAYBACK",
    "CONTROL_INPUT_TV", "CONTROL_MOUSE_AND_KEYBOARD", "CONTROL_POWER",
]
LG_TV_APP_SHORTCUTS = {
    "netflix": {
        "label": "Netflix", "ids": ("netflix",), "titles": ("netflix",),
    },
    "iplayer": {
        "label": "BBC iPlayer", "ids": ("bbc.iplayer", "com.bbc.iplayer"),
        "titles": ("bbc iplayer", "iplayer"),
    },
    "disney": {
        "label": "Disney+", "ids": ("com.disney.disneyplus",),
        "titles": ("disney plus", "disney+"),
    },
    "prime": {
        "label": "Prime Video", "ids": ("com.amazon.amazonvideo.lg",),
        "titles": ("prime video", "amazon prime video"),
    },
    "itvx": {
        "label": "ITVX", "ids": ("itv.hub", "com.itv.itvhub"),
        "titles": ("itvx", "itv hub"),
    },
    "channel4": {
        "label": "Channel 4", "ids": ("com.channel4.ondemand",),
        "titles": ("channel 4", "all 4"),
    },
    "appletv": {
        "label": "Apple TV", "ids": ("com.apple.appletv",),
        "titles": ("apple tv", "apple tv+"),
    },
    "paramount": {
        "label": "Paramount+", "ids": ("com.paramountplus.app",),
        "titles": ("paramount plus", "paramount+"),
    },
}
LG_TV_BUTTONS = {
    "up": "UP", "down": "DOWN", "left": "LEFT", "right": "RIGHT",
    "ok": "ENTER", "back": "BACK", "home": "HOME", "settings": "MENU",
    "guide": "GUIDE", "info": "INFO", "apps": "MYAPPS",
}
LG_TV_MEDIA_ACTIONS = {
    "play": "ssap://media.controls/play",
    "pause": "ssap://media.controls/pause",
    "rewind": "ssap://media.controls/rewind",
    "fast-forward": "ssap://media.controls/fastForward",
    "channel-up": "ssap://tv/channelUp",
    "channel-down": "ssap://tv/channelDown",
}
LG_TV_CATALOG_SECONDS = 5 * 60
LG_WEBOS_REGISTRATION = {
    # Keep the established MabelTV app identity so the TV can reuse its saved
    # client key, while requesting the permissions needed by the full remote.
    "type": "register",
    "payload": {
        "pairingType": "PROMPT",
        "manifest": {
            "manifestVersion": 1, "appVersion": "0.1.0",
            "signed": {"appId": "com.mabeltv.control", "created": "2026-09-03",
                       "localizedAppNames": {"": "MabelTV"},
                       "localizedVendorNames": {"": "MabelTV"},
                       "permissions": LG_WEBOS_PERMISSIONS},
            "permissions": LG_WEBOS_PERMISSIONS,
        },
    },
}


class LgWebOsSocket:
    """Small standards-only WebSocket client for LG SSAP and pointer control.

    Keeping this here avoids a new service dependency and keeps the paired key on
    the Pi. It implements the masked text frames used by local webOS control.
    """
    def __init__(self, host: str, client_key: str = "") -> None:
        self.host = host
        self.client_key = client_key
        self.connection: socket.socket | None = None

    def connect(self, path: str = "/", port: int = LG_WEBOS_DEFAULT_PORT, secure: bool = True) -> None:
        try:
            lg_webos_log("TCP connect started")
            raw = socket.create_connection((self.host, port), timeout=5)
            connection = raw
            if secure:
                context = ssl._create_unverified_context()
                connection = context.wrap_socket(raw, server_hostname=self.host)
                lg_webos_log("TLS established")
            websocket_key = base64.b64encode(os.urandom(16)).decode("ascii")
            handshake = (
                f"GET {path or '/'} HTTP/1.1\r\n"
                f"Host: {self.host}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {websocket_key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode("ascii")
            connection.sendall(handshake)
            response = self._read_headers(connection)
            if not response.startswith("HTTP/1.1 101"):
                lg_webos_log(f"WebSocket upgrade rejected: {response.splitlines()[0] if response else 'empty response'}")
                raise LgWebOsError("The connected TV rejected MabelTV's secure control connection")
            lg_webos_log("WebSocket upgrade complete")
            # Allow a person time to read and accept the television prompt.
            connection.settimeout(90)
            self.connection = connection
        except (OSError, ssl.SSLError) as error:
            lg_webos_log(f"connection exception: {type(error).__name__}: {error}")
            raise LgWebOsError("MabelTV could not reach the connected LG TV") from error

    @staticmethod
    def _read_headers(connection: socket.socket) -> str:
        data = bytearray()
        while b"\r\n\r\n" not in data and len(data) < 16 * 1024:
            chunk = connection.recv(1024)
            if not chunk:
                break
            data.extend(chunk)
        return data.decode("iso-8859-1", "replace")

    def send(self, payload: dict[str, Any]) -> None:
        self._send_frame(0x1, json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    def send_text(self, value: str) -> None:
        self._send_frame(0x1, value.encode("utf-8"))

    def _send_frame(self, opcode: int, data: bytes = b"") -> None:
        if self.connection is None:
            raise LgWebOsError("The connected LG TV control session is not available")
        header = bytearray([0x80 | opcode])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126); header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127); header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        encoded = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
        self.connection.sendall(bytes(header) + mask + encoded)

    def receive(self) -> dict[str, Any]:
        if self.connection is None:
            raise LgWebOsError("The connected LG TV control session is not available")
        first = self._read_exact(2)
        opcode, length = first[0] & 0x0F, first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
        if length > 1024 * 1024:
            raise LgWebOsError("The connected LG TV sent an unexpectedly large control response")
        body = self._read_exact(length)
        if opcode == 0x8:
            code = struct.unpack("!H", body[:2])[0] if len(body) >= 2 else None
            reason = body[2:].decode("utf-8", "replace") if len(body) > 2 else ""
            lg_webos_log(f"CLOSE received: code={code!r} reason={reason!r}")
            try:
                self._send_frame(0x8, body)
            except OSError:
                pass
            raise LgWebOsError("The connected LG TV closed its control session")
        if opcode == 0x9:
            # LG sends WebSocket pings while a first-time pairing prompt is
            # visible. Replying is required before it will send `registered`.
            self._send_frame(0xA, body)
            lg_webos_log("PING received; PONG sent")
            return self.receive()
        if opcode == 0xA:
            lg_webos_log("PONG received")
            return self.receive()
        if opcode != 0x1:
            lg_webos_log(f"non-text WebSocket opcode received: {opcode}")
            return self.receive()
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LgWebOsError("The connected LG TV returned an invalid control response") from error
        if not isinstance(value, dict):
            raise LgWebOsError("The connected LG TV returned an invalid control response")
        lg_webos_log(f"LG JSON received: type={value.get('type')!r} id={value.get('id')!r}")
        return value

    def _read_exact(self, amount: int) -> bytes:
        assert self.connection is not None
        data = bytearray()
        while len(data) < amount:
            chunk = self.connection.recv(amount - len(data))
            if not chunk:
                lg_webos_log("socket EOF")
                raise LgWebOsError("The connected LG TV closed its control session")
            data.extend(chunk)
        return bytes(data)

    def close(self) -> None:
        if self.connection is not None:
            try:
                self.connection.close()
            finally:
                self.connection = None


