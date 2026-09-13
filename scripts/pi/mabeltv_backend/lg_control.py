"""LG webOS pairing and remote-control behaviour for the local library service."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

from .constants import (
    EXTERNAL_DOWNLOAD_SESSION_SECONDS,
    EXTERNAL_VLC_SESSION_SECONDS,
    NETFLIX_TV_APP_ID,
    REMOTE_BROWSER_EXTENSIONS,
    REMOTE_COMPLETION_FRACTION,
    REMOTE_COMPLETION_MIN_SECONDS,
    REMOTE_RESUME_MIN_SECONDS,
    REMOTE_SESSION_SECONDS,
    SAFE_NAME,
    SUPPORTED_EXTENSIONS,
)
from .lg import (
    LG_TV_APP_SHORTCUTS,
    LG_TV_BUTTONS,
    LG_TV_CATALOG_SECONDS,
    LG_TV_MEDIA_ACTIONS,
    LG_WEBOS_REGISTRATION,
    LgWebOsError,
    LgWebOsSocket,
    RemoteTvActiveError,
    lg_webos_log,
)


class LgControlMixin:
    def lg_tv_client_key(self) -> str:
        try:
            return self.lg_tv_client_key_path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def save_lg_tv_client_key(self, key: str) -> None:
        if not key or len(key) > 512:
            raise LgWebOsError("The connected LG TV returned an invalid pairing key")
        self.lg_tv_client_key_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.lg_tv_client_key_path.with_name(
            f".{self.lg_tv_client_key_path.name}.{secrets.token_hex(6)}")
        try:
            temporary.write_text(key + "\n", encoding="utf-8")
            temporary.chmod(0o600)
            os.replace(temporary, self.lg_tv_client_key_path)
        finally:
            temporary.unlink(missing_ok=True)

    def lg_tv_session(self) -> LgWebOsSocket:
        if not self.lg_tv_host:
            raise ValueError("Connected TV control has not been configured for this MabelTV yet")
        session = LgWebOsSocket(self.lg_tv_host, self.lg_tv_client_key())
        session.connect()
        registration = json.loads(json.dumps(LG_WEBOS_REGISTRATION))
        if session.client_key:
            registration["payload"]["client-key"] = session.client_key
        lg_webos_log(f"registration JSON sent; stored_client_key={'YES' if session.client_key else 'NO'}")
        session.send(registration)
        first = session.receive()
        if first.get("type") == "response" and \
                first.get("payload", {}).get("pairingType") == "PROMPT":
            lg_webos_log("pairing prompt response received; waiting for user approval")
            first = session.receive()
        if first.get("type") != "registered":
            lg_webos_log("registration did not reach registered state")
            session.close()
            raise LgWebOsError("Approve MabelTV's control request on the LG TV, then try Netflix again")
        key = str(first.get("payload", {}).get("client-key") or "")
        lg_webos_log(f"registered message received; client_key={'YES' if key else 'NO'}")
        if key and key != session.client_key:
            self.save_lg_tv_client_key(key)
            session.client_key = key
        if not session.client_key:
            session.close()
            raise LgWebOsError("Approve MabelTV's control request on the LG TV, then try Netflix again")
        return session

    @staticmethod
    def lg_response_ok(response: dict[str, Any]) -> bool:
        return response.get("type") == "response" and response.get("payload", {}).get("returnValue") is not False

    def lg_tv_session_request(self, session: LgWebOsSocket, uri: str,
                              payload: dict[str, Any] | None = None,
                              request_id: str = "lg-remote") -> dict[str, Any]:
        request: dict[str, Any] = {"id": request_id, "type": "request", "uri": uri}
        if payload is not None:
            request["payload"] = payload
        session.send(request)
        response = session.receive()
        if not self.lg_response_ok(response):
            raise LgWebOsError("The connected LG TV could not complete that command")
        return response.get("payload", {})

    def lg_tv_request(self, uri: str, payload: dict[str, Any] | None = None, request_id: str = "lg-remote") -> dict[str, Any]:
        """Make one authenticated SSAP request, keeping the pairing secret on the Pi."""
        with self.lg_tv_lock:
            session: LgWebOsSocket | None = None
            try:
                session = self.lg_tv_session()
                return self.lg_tv_session_request(session, uri, payload, request_id)
            except LgWebOsError:
                raise
            except (OSError, ssl.SSLError) as error:
                lg_webos_log(f"command connection failed: {type(error).__name__}")
                raise LgWebOsError("Connected TV unavailable") from error
            finally:
                if session is not None:
                    session.close()

    @staticmethod
    def lg_normalised_name(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()

    def lg_tv_catalog(self, session: LgWebOsSocket,
                      force: bool = False) -> dict[str, Any]:
        if self.lg_tv_catalog_cache and not force and \
                time.monotonic() - self.lg_tv_catalog_updated < LG_TV_CATALOG_SECONDS:
            return self.lg_tv_catalog_cache

        cached = self.lg_tv_catalog_cache or {}
        apps = list(cached.get("apps", []))
        inputs = list(cached.get("inputs", []))
        apps_known = bool(cached.get("apps_known", apps))
        inputs_known = bool(cached.get("inputs_known", inputs))
        errors: list[LgWebOsError] = []
        try:
            apps_payload = self.lg_tv_session_request(
                session, "ssap://com.webos.applicationManager/listLaunchPoints",
                request_id="lg-app-catalog")
            apps = [item for item in apps_payload.get("launchPoints", [])
                    if isinstance(item, dict) and item.get("id")]
            apps_known = True
        except LgWebOsError as error:
            errors.append(error)
        try:
            inputs_payload = self.lg_tv_session_request(
                session, "ssap://tv/getExternalInputList", request_id="lg-input-catalog")
            inputs = [item for item in inputs_payload.get("devices", [])
                      if isinstance(item, dict)]
            inputs_known = True
        except LgWebOsError as error:
            errors.append(error)
        if not apps_known and not inputs_known and errors:
            raise errors[0]
        resolved: dict[str, str] = {}
        by_id = {str(item.get("id")): item for item in apps}
        for key, definition in LG_TV_APP_SHORTCUTS.items():
            app_id = next((candidate for candidate in definition["ids"]
                           if candidate in by_id), "")
            if not app_id:
                wanted = {self.lg_normalised_name(title)
                          for title in definition["titles"]}
                for item in apps:
                    title = self.lg_normalised_name(
                        item.get("title") or item.get("name") or item.get("appDescription"))
                    if title in wanted or any(value and value in title for value in wanted):
                        app_id = str(item["id"])
                        break
            if app_id:
                resolved[key] = app_id
        catalog = {
            "apps": apps, "inputs": inputs, "shortcuts": resolved,
            "apps_known": apps_known, "inputs_known": inputs_known,
        }
        self.lg_tv_catalog_cache = catalog
        self.lg_tv_catalog_updated = time.monotonic()
        return catalog

    def lg_tv_app_label(self, app_id: str, catalog: dict[str, Any]) -> tuple[str, str]:
        for item in catalog.get("inputs", []):
            if str(item.get("appId") or "") == app_id:
                label = str(item.get("label") or item.get("inputId") or "HDMI")
                return label, label
        for item in catalog.get("apps", []):
            if str(item.get("id") or "") == app_id:
                return str(item.get("title") or item.get("name") or app_id), ""
        for definition in LG_TV_APP_SHORTCUTS.values():
            if app_id in definition["ids"]:
                return str(definition["label"]), ""
        if app_id == "com.webos.app.livetv":
            return "Live TV", "Live TV"
        return app_id, ""

    def lg_tv_status(self) -> dict[str, Any]:
        status = {
            "configured": bool(self.lg_tv_host), "connected": False,
            "power": "off", "app": "", "app_id": "", "input": "",
            "volume": None, "muted": False, "catalog_known": False,
            "available_apps": [],
        }
        if not self.lg_tv_host:
            return status
        try:
            with self.lg_tv_lock:
                session = self.lg_tv_session()
                try:
                    app = self.lg_tv_session_request(
                        session,
                        "ssap://com.webos.applicationManager/getForegroundAppInfo",
                        request_id="lg-status-app")
                    volume = self.lg_tv_session_request(
                        session, "ssap://audio/getVolume",
                        request_id="lg-status-volume")
                    try:
                        catalog = self.lg_tv_catalog(session)
                        catalog_known = bool(catalog.get(
                            "apps_known", catalog.get("apps")))
                    except LgWebOsError:
                        catalog = self.lg_tv_catalog_cache
                        catalog_known = bool(catalog)
                finally:
                    session.close()
            app_id = str(app.get("appId") or app.get("appName") or "")
            app_label, input_label = self.lg_tv_app_label(app_id, catalog)
            volume_status = volume.get("volumeStatus", volume)
            status.update({
                "connected": True, "power": "on", "app": app_label,
                "app_id": app_id, "input": input_label,
                "volume": volume_status.get("volume"),
                "muted": bool(volume_status.get(
                    "muteStatus", volume_status.get("mute", False))),
                "catalog_known": catalog_known,
                "available_apps": sorted(catalog.get("shortcuts", {})),
            })
        except (LgWebOsError, OSError, ssl.SSLError):
            pass
        return status

    def close_lg_tv_pointer(self) -> None:
        if self.lg_tv_pointer_socket is not None:
            self.lg_tv_pointer_socket.close()
            self.lg_tv_pointer_socket = None

    def open_lg_tv_pointer(self) -> LgWebOsSocket:
        if self.lg_tv_pointer_socket is not None and \
                self.lg_tv_pointer_socket.connection is not None:
            return self.lg_tv_pointer_socket
        control: LgWebOsSocket | None = None
        try:
            control = self.lg_tv_session()
            response = self.lg_tv_session_request(
                control, "ssap://com.webos.service.networkinput/getPointerInputSocket",
                request_id="lg-pointer-socket")
            socket_path = str(response.get("socketPath") or "")
            parsed = urlsplit(socket_path)
            if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
                raise LgWebOsError("The connected LG TV did not provide pointer control")
            pointer = LgWebOsSocket(parsed.hostname)
            path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            pointer.connect(path, parsed.port or (443 if parsed.scheme == "wss" else 3000),
                            parsed.scheme == "wss")
            self.lg_tv_pointer_socket = pointer
            return pointer
        finally:
            if control is not None:
                control.close()

    def lg_tv_pointer(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send one command through LG's reusable pointer-input socket."""
        if action == "pointer-click":
            message = "type:click\n\n"
        elif action == "pointer-scroll":
            message = (f"type:scroll\ndx:{int(payload.get('dx', 0))}"
                       f"\ndy:{int(payload.get('dy', 0))}\n\n")
        elif action == "pointer-move":
            message = (f"type:move\ndx:{int(payload.get('dx', 0))}"
                       f"\ndy:{int(payload.get('dy', 0))}\ndown:0\n\n")
        elif action == "button":
            name = str(payload.get("name") or "")
            if name not in {*LG_TV_BUTTONS.values(), "CHANNELUP", "CHANNELDOWN",
                            "PLAY", "PAUSE", "REWIND", "FASTFORWARD"}:
                raise ValueError("That connected TV button is not available")
            message = f"type:button\nname:{name}\n\n"
        else:
            raise ValueError("That pointer command is not available")

        with self.lg_tv_lock:
            error: Exception | None = None
            for attempt in range(2):
                try:
                    self.open_lg_tv_pointer().send_text(message)
                    return {"ok": True, "message": "Command sent to connected TV"}
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                    self.close_lg_tv_pointer()
                    if attempt == 0:
                        lg_webos_log("pointer session lost; reconnecting")
            raise LgWebOsError("TV control session lost. Please try again.") from error

    def lg_tv_launch_shortcut(self, shortcut: str) -> dict[str, Any]:
        definition = LG_TV_APP_SHORTCUTS.get(shortcut)
        if not definition:
            raise ValueError("That TV app is not available in MabelTV")
        mode = self.player_mode_status()
        waking = str(mode.get("connected_tv_power") or "").lower() not in {"on", "active"}
        if waking:
            self.wake_connected_tv_only()
        deadline = time.monotonic() + (20 if waking else 5)
        error: Exception | None = None
        with self.lg_tv_lock:
            while time.monotonic() < deadline:
                session: LgWebOsSocket | None = None
                try:
                    session = self.lg_tv_session()
                    catalog = self.lg_tv_catalog(session, force=True)
                    app_id = str(catalog.get("shortcuts", {}).get(shortcut) or "")
                    if not app_id:
                        raise LgWebOsError(f"{definition['label']} is not installed on the connected TV")
                    self.lg_tv_session_request(
                        session, "ssap://system.launcher/launch", {"id": app_id},
                        request_id="lg-launch")
                    return {"ok": True, "message": f"Opening {definition['label']} on TV…",
                            "waking": waking}
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                    if isinstance(caught, LgWebOsError) and "not installed" in str(caught):
                        break
                finally:
                    if session is not None:
                        session.close()
                time.sleep(1)
        raise LgWebOsError(str(error or "Connected TV unavailable"))

    def lg_tv_switch_to_mabeltv(self) -> dict[str, Any]:
        preferred = os.environ.get("MABELTV_LG_TV_INPUT_ID", "HDMI_1").strip() or "HDMI_1"
        with self.lg_tv_lock:
            session: LgWebOsSocket | None = None
            try:
                session = self.lg_tv_session()
                catalog = self.lg_tv_catalog(session, force=True)
                inputs = catalog.get("inputs", [])
                selected = next((item for item in inputs
                                 if "mabeltv" in self.lg_normalised_name(item.get("label"))), None)
                selected = selected or next((item for item in inputs
                                             if str(item.get("inputId") or "").casefold()
                                             == preferred.casefold()), None)
                input_id = str((selected or {}).get("inputId") or preferred)
                self.lg_tv_session_request(
                    session, "ssap://tv/switchInput", {"inputId": input_id},
                    request_id="lg-mabeltv-input")
                return {"ok": True, "message": "Switching to MabelTV…"}
            finally:
                if session is not None:
                    session.close()

    def lg_tv_open_input_picker(self) -> dict[str, Any]:
        error: Exception | None = None
        for app_id in ("com.webos.app.inputpicker", "com.webos.app.inputmgr"):
            try:
                self.lg_tv_request(
                    "ssap://system.launcher/launch", {"id": app_id},
                    request_id="lg-input-picker")
                return {"ok": True, "message": "Opening TV inputs…"}
            except LgWebOsError as caught:
                error = caught
        raise LgWebOsError("The connected TV could not open its input picker") from error

    def lg_tv_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = str(payload.get("action") or "").strip().lower()
        if action == "power-on":
            self.wake_connected_tv_only()
            return {"ok": True, "message": "Turning on connected TV…", "waking": True}
        if action == "power-off":
            self.lg_tv_request("ssap://system/turnOff", request_id="lg-power-off")
            self.close_lg_tv_pointer()
            return {"ok": True, "message": "Turning off connected TV…"}
        if action == "launch":
            shortcut = str(payload.get("app") or "").strip().lower()
            if shortcut == "live-tv":
                self.lg_tv_request(
                    "ssap://system.launcher/launch", {"id": "com.webos.app.livetv"},
                    request_id="lg-live-tv")
                return {"ok": True, "message": "Opening Live TV…"}
            if shortcut == "mabeltv":
                return self.lg_tv_switch_to_mabeltv()
            return self.lg_tv_launch_shortcut(shortcut)
        if action == "input":
            return self.lg_tv_open_input_picker()
        if action in {"pointer-move", "pointer-click", "pointer-scroll"}:
            return self.lg_tv_pointer(action, payload)
        if action in LG_TV_BUTTONS:
            return self.lg_tv_pointer("button", {"name": LG_TV_BUTTONS[action]})
        if action in LG_TV_MEDIA_ACTIONS:
            self.lg_tv_request(LG_TV_MEDIA_ACTIONS[action], request_id=f"lg-{action}")
            return {"ok": True, "message": "Command sent to connected TV"}
        if action == "volume-up":
            uri, command = "ssap://audio/volumeUp", None
        elif action == "volume-down":
            uri, command = "ssap://audio/volumeDown", None
        elif action == "mute":
            uri, command = "ssap://audio/setMute", {"mute": bool(payload.get("mute", True))}
        else:
            raise ValueError("That connected TV command is not available")
        self.lg_tv_request(uri, command, f"lg-{action}")
        return {"ok": True, "message": "Command sent to connected TV"}

    def play_netflix_on_tv(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Wake the connected display when necessary, then launch one Netflix title."""
        self.adult_title_key(str(payload.get("media_type", "")), payload.get("tmdb_id"))
        content_id = self.netflix_content_id(payload.get("destination"))
        title = str(payload.get("title") or "this Netflix title").strip()[:180]
        mode = self.player_mode_status()
        waking = str(mode.get("connected_tv_power") or "").lower() not in {"on", "active"}
        lg_webos_log(f"Netflix Play on TV request received; waking={waking}")
        if waking:
            self.wake_connected_tv_only()
        # Queue the wake and immediately begin the bounded SSAP retry loop.
        # This preserves the proven wake-and-launch timing while deliberately
        # avoiding CEC Active Source, which would switch the TV to HDMI 1.
        deadline = time.monotonic() + (20 if waking else 5)
        error: Exception | None = None
        with self.lg_tv_lock:
            while time.monotonic() < deadline:
                session: LgWebOsSocket | None = None
                try:
                    session = self.lg_tv_session()
                    lg_webos_log("Netflix launch request sent")
                    session.send({"id": "netflix-launch", "type": "request",
                                  "uri": "ssap://system.launcher/launch",
                                  "payload": {"id": NETFLIX_TV_APP_ID,
                                              "contentId": content_id}})
                    response = session.receive()
                    lg_webos_log(
                        "Netflix launch response received; "
                        f"returnValue={response.get('payload', {}).get('returnValue')!r}")
                    if response.get("type") == "response" and \
                            response.get("payload", {}).get("returnValue") is True:
                        return {"ok": True, "message": f"Opening {title} on Netflix",
                                "waking": waking}
                    error = LgWebOsError("The LG TV could not open that Netflix title")
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                finally:
                    if session is not None:
                        session.close()
                time.sleep(1)
        raise ValueError(str(error or "The connected LG TV could not open Netflix"))
