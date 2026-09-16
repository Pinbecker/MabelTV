#!/usr/bin/env python3
"""Receive private Alexa commands from AWS IoT and control the local TV."""

from __future__ import annotations

import json
import logging
import os
import re
import socket
import sqlite3
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


CONTROL_SOCKET = "/run/mabeltv/portal-control.sock"
COMMAND_TOPIC = "mabeltv/alexa/commands"
DATABASE_PATH = "/var/lib/mabeltv/mabeltv.db"
WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
CONTROL_COMMANDS = {
    "turn_on": "turn-on",
    "turn_off": "turn-off",
    "open_my_tv": "enter-my-tv-mode",
    "return_to_mabeltv": "return-to-mabeltv",
    "show_tv_guide": "open-tv-guide",
    "show_channel_menu": "open-channel-menu",
    "open_menu": "open-parent-menu",
    "close": "close-overlay",
    "pause": "toggle-pause",
    "resume": "toggle-pause",
    "next_channel": "channel-down",
    "previous_channel": "channel-up",
    "next_programme": "next-programme",
    "previous_programme": "previous-programme",
    "volume_up": "volume-up",
    "volume_down": "volume-down",
    "mute": "toggle-mute",
}


class CommandError(ValueError):
    """A recognised voice action could not be safely completed."""


@dataclass(frozen=True)
class BridgeConfig:
    endpoint: str
    certificate: Path
    private_key: Path
    root_ca: Path
    client_id: str = "mabeltv-alexa-bridge"
    topic: str = COMMAND_TOPIC
    database: Path = Path(DATABASE_PATH)
    control_socket: str = CONTROL_SOCKET

    @classmethod
    def from_environment(cls) -> "BridgeConfig":
        required = {
            "endpoint": "MABELTV_AWS_IOT_ENDPOINT",
            "certificate": "MABELTV_AWS_IOT_CERTIFICATE",
            "private_key": "MABELTV_AWS_IOT_PRIVATE_KEY",
            "root_ca": "MABELTV_AWS_IOT_ROOT_CA",
        }
        values = {name: os.environ.get(variable, "").strip()
                  for name, variable in required.items()}
        missing = [variable for name, variable in required.items() if not values[name]]
        if missing:
            raise CommandError("Missing Alexa bridge configuration: " + ", ".join(missing))
        endpoint = values["endpoint"].removeprefix("https://").rstrip("/")
        return cls(
            endpoint=endpoint,
            certificate=Path(values["certificate"]),
            private_key=Path(values["private_key"]),
            root_ca=Path(values["root_ca"]),
            client_id=os.environ.get("MABELTV_AWS_IOT_CLIENT_ID", "mabeltv-alexa-bridge"),
            topic=os.environ.get("MABELTV_AWS_IOT_COMMAND_TOPIC", COMMAND_TOPIC),
            database=Path(os.environ.get("MABELTV_DATABASE", DATABASE_PATH)),
            control_socket=os.environ.get("MABELTV_CONTROL_SOCKET", CONTROL_SOCKET),
        )


def normalise(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.casefold()).split())


class ChannelResolver:
    def __init__(self, database: Path):
        self.database = database

    def channels(self) -> list[tuple[int, str]]:
        uri = f"file:{self.database}?mode=ro"
        connection = None
        try:
            connection = sqlite3.connect(uri, uri=True)
            rows = connection.execute(
                "SELECT number, name FROM channels ORDER BY number"
            ).fetchall()
        except sqlite3.Error as error:
            raise CommandError("The Mabel TV channel list is not available") from error
        finally:
            if connection is not None:
                connection.close()
        return [(int(number), str(name)) for number, name in rows]

    def resolve(self, query: str) -> tuple[int, str] | None:
        value = normalise(query)
        if not value:
            return None
        numeric = re.fullmatch(r"(?:channel )?(\d{1,3})", value)
        if numeric:
            number = int(numeric.group(1))
            return next((channel for channel in self.channels() if channel[0] == number), None)
        words = value.removeprefix("channel ")
        if words in WORD_NUMBERS:
            number = WORD_NUMBERS[words]
            return next((channel for channel in self.channels() if channel[0] == number), None)
        matches = [(number, name) for number, name in self.channels()
                   if normalise(name) == value]
        if len(matches) == 1:
            return matches[0]
        matches = [(number, name) for number, name in self.channels()
                   if value in normalise(name)]
        return matches[0] if len(matches) == 1 else None


class LocalControl:
    def __init__(self, socket_path: str):
        self.socket_path = socket_path

    def send(self, command: str | dict[str, Any]) -> None:
        wire = command if isinstance(command, str) else json.dumps(
            command, separators=(",", ":"), ensure_ascii=False)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3)
            client.connect(self.socket_path)
            client.sendall((wire + "\n").encode("utf-8"))
            reply = client.recv(128).decode("utf-8", errors="replace").strip()
        if reply != "ok":
            raise CommandError("The Mabel TV player could not accept that command")


class AlexaCommandDispatcher:
    def __init__(self, control: LocalControl, resolver: ChannelResolver):
        self.control = control
        self.resolver = resolver

    def dispatch(self, payload: dict[str, Any]) -> str:
        action = str(payload.get("action") or "")
        if action in CONTROL_COMMANDS:
            self.control.send(CONTROL_COMMANDS[action])
            return action
        if action == "tune":
            channel = self.resolver.resolve(str(payload.get("channel") or ""))
            if channel is None:
                raise CommandError("I could not find that Mabel TV channel")
            self.control.send({"command": "tune-channel", "channel": channel[0]})
            return f"channel:{channel[0]}:{channel[1]}"
        if action == "play":
            title = str(payload.get("title") or "").strip()
            if not title:
                raise CommandError("Choose something to play")
            channel = self.resolver.resolve(title)
            if channel is not None:
                self.control.send({"command": "tune-channel", "channel": channel[0]})
                return f"channel:{channel[0]}:{channel[1]}"
            self.control.send("enter-my-tv-mode")
            self.control.send({"command": "text-input", "text": title[:120]})
            return f"search:{title}"
        raise CommandError("That Alexa command is not supported")


def validate_config(config: BridgeConfig) -> None:
    for path in (config.certificate, config.private_key, config.root_ca):
        if not path.is_file():
            raise CommandError(f"Alexa bridge credential is missing: {path}")
    if not re.fullmatch(r"[a-z0-9-]+\.iot\.[a-z0-9-]+\.amazonaws\.com", config.endpoint):
        raise CommandError("The AWS IoT endpoint is not valid")
    if not re.fullmatch(r"[A-Za-z0-9._:/-]{1,256}", config.topic):
        raise CommandError("The AWS IoT command topic is not valid")


def run_bridge(config: BridgeConfig, dispatcher: AlexaCommandDispatcher) -> None:
    try:
        import paho.mqtt.client as mqtt
    except ImportError as error:
        raise CommandError("Install python3-paho-mqtt before starting Alexa control") from error

    logger = logging.getLogger("mabeltv.alexa")
    client = mqtt.Client(client_id=config.client_id, protocol=mqtt.MQTTv311)
    client.tls_set(ca_certs=str(config.root_ca), certfile=str(config.certificate),
                   keyfile=str(config.private_key), cert_reqs=ssl.CERT_REQUIRED,
                   tls_version=ssl.PROTOCOL_TLS_CLIENT)
    client.tls_insecure_set(False)

    def on_connect(_client: Any, _userdata: Any, _flags: Any, code: int) -> None:
        if code != 0:
            logger.error("AWS IoT connection was rejected: %s", code)
            return
        _client.subscribe(config.topic, qos=0)
        logger.info("Connected to AWS IoT command topic")

    def on_message(_client: Any, _userdata: Any, message: Any) -> None:
        try:
            payload = json.loads(message.payload.decode("utf-8"))
            if not isinstance(payload, dict):
                raise CommandError("Command payload must be an object")
            result = dispatcher.dispatch(payload)
            logger.info("Completed Alexa command: %s", result)
        except (UnicodeDecodeError, json.JSONDecodeError, CommandError, OSError) as error:
            logger.warning("Rejected Alexa command: %s", error)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect_async(config.endpoint, port=8883, keepalive=60)
    client.loop_forever(retry_first_connection=True)


def main() -> None:
    logging.basicConfig(level=os.environ.get("MABELTV_ALEXA_LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(message)s")
    config = BridgeConfig.from_environment()
    validate_config(config)
    run_bridge(config, AlexaCommandDispatcher(
        LocalControl(config.control_socket), ChannelResolver(config.database)))


if __name__ == "__main__":
    main()
