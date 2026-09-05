"""Authentication behaviour for the local library service."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import socket
import sys
import time
from pathlib import Path
from typing import Any

from .constants import (
    DEFAULT_CHANNELS,
    PBKDF2_ITERATIONS,
    PIN_PATTERN,
    PRODUCT_NAME,
    SAFE_NAME,
    SESSION_SECONDS,
)


class AuthenticationMixin:
    @staticmethod
    def read_config(path: Path) -> dict[str, str]:
        values: dict[str, str] = {}
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator and key.strip():
                    values[key.strip()] = value.strip()
        except OSError:
            pass
        return values

    @staticmethod
    def pin_record(pin: str) -> dict[str, Any]:
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, PBKDF2_ITERATIONS)
        return {
            "pin_salt": salt.hex(),
            "pin_hash": digest.hex(),
            "pin_iterations": PBKDF2_ITERATIONS,
        }

    def owner(self) -> dict[str, Any]:
        value = self.read_json(self.owner_path, {})
        return value if isinstance(value, dict) else {}

    @staticmethod
    def normalise_tv_identity(value: Any) -> tuple[str, str]:
        """Return the child's plain name and the friendly TV name.

        The setup form asks for "Mabel", rather than asking a grown-up to
        decide whether a space belongs before TV. Be forgiving if they type
        "Mabel TV" or "MabelTV" anyway, but never accept an empty/control
        character name into the owner record or QML display.
        """
        child_name = " ".join(str(value or "").split())
        if child_name.casefold().endswith("tv"):
            child_name = child_name[:-2].rstrip()
        if not 1 <= len(child_name) <= 40 or any(ord(char) < 32 for char in child_name):
            raise ValueError("Enter the child's name, up to 40 characters")
        return child_name, f"{child_name}TV"

    def tv_identity(self) -> tuple[str, str]:
        owner = self.owner()
        try:
            return self.normalise_tv_identity(owner.get("child_name", ""))
        except ValueError:
            # Existing MabelTV installations have no child-name field. Their
            # internal service/update identity stays untouched, while their
            # owner-facing display starts from the generic product name.
            return "", PRODUCT_NAME

    def configured(self) -> bool:
        owner = self.owner()
        return bool(owner.get("setup_complete") and owner.get("pin_hash")
                    and owner.get("pin_salt"))

    def portal_pin_required(self) -> bool:
        """Keep existing installations private unless their owner opts out."""
        return bool(self.owner().get("portal_pin_required", True))

    def migrate_legacy_owner(self) -> None:
        if self.owner_path.exists():
            return
        legacy_pin = self.read_config(self.config_path).get("MABELTV_LIBRARY_PIN", "")
        if not PIN_PATTERN.fullmatch(legacy_pin):
            return
        owner = {
            "schema_version": 1,
            "setup_complete": True,
            "owner_name": "Owner",
            "tv_name": PRODUCT_NAME,
            "legacy_default_pin": legacy_pin == "0973",
            "portal_pin_required": True,
            **self.pin_record(legacy_pin),
        }
        self.write_json(self.owner_path, owner)

    def verify_pin(self, pin: str) -> bool:
        owner = self.owner()
        try:
            salt = bytes.fromhex(str(owner["pin_salt"]))
            expected = bytes.fromhex(str(owner["pin_hash"]))
            iterations = int(owner.get("pin_iterations", PBKDF2_ITERATIONS))
        except (KeyError, TypeError, ValueError):
            return False
        actual = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)

    def public_setup(self) -> dict[str, Any]:
        existing_channels = self.channels()
        try:
            setup_channels = self.normalise_channels(existing_channels) \
                if existing_channels else DEFAULT_CHANNELS
        except ValueError:
            setup_channels = DEFAULT_CHANNELS
        return {
            "configured": self.configured(),
            "device_name": socket.gethostname(),
            "product_name": PRODUCT_NAME,
            "tv_name": self.tv_identity()[1],
            "portal_pin_required": self.portal_pin_required(),
            "setup_code_required": True,
            # Recovery is an explicit state written by the physical boot-marker
            # service. A fresh install also seeds channels.json, so the mere
            # presence of channels cannot distinguish setup from recovery.
            "default_channels": setup_channels,
            "recovering_owner": self.owner_recovery_path.is_file(),
        }

    def verify_setup_code(self, supplied_code: str) -> bool:
        expected_code = self.read_config(self.config_path).get("MABELTV_SETUP_CODE", "")
        return bool(expected_code and hmac.compare_digest(supplied_code.strip(), expected_code))

    @staticmethod
    def channel_content_type(value: dict[str, Any]) -> str:
        content_type = str(value.get("content_type", "")).strip().lower()
        if content_type:
            return content_type
        name = str(value.get("name", "")).strip().lower()
        folder = str(value.get("folder", "")).strip().lower()
        return "films" if name in {"films", "movies"} \
            or folder in {"films", "movies"} else "shows"

    @staticmethod
    def normalise_channels(values: Any) -> list[dict[str, Any]]:
        if not isinstance(values, list) or not values or len(values) > 20:
            raise ValueError("Create between 1 and 20 channels")
        channels: list[dict[str, Any]] = []
        numbers: set[int] = set()
        folders: set[str] = set()
        for raw in values:
            if not isinstance(raw, dict):
                raise ValueError("A channel entry is invalid")
            try:
                number = int(raw.get("number"))
            except (TypeError, ValueError):
                raise ValueError("Every channel needs a number") from None
            name = str(raw.get("name", "")).strip()
            folder = SAFE_NAME.sub("", str(raw.get("folder", "")).strip()).strip(". ")
            aspect = str(raw.get("aspect", "crop"))
            content_type = AuthenticationMixin.channel_content_type(raw)
            if not 1 <= number <= 999 or number in numbers:
                raise ValueError("Channel numbers must be unique and between 1 and 999")
            if not name or len(name) > 60 or not folder or folder in folders:
                raise ValueError("Every channel needs a unique name and folder")
            if aspect not in {"crop", "fit", "stretch"}:
                raise ValueError("Channel picture mode must be crop, fit, or stretch")
            if content_type not in {"shows", "films"}:
                raise ValueError("Channel content must be shows or films")
            numbers.add(number)
            folders.add(folder)
            channels.append({"number": number, "name": name, "folder": folder,
                             "aspect": aspect, "content_type": content_type})
        return sorted(channels, key=lambda channel: channel["number"])

    def complete_setup(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.config_lock:
            if self.configured():
                raise ValueError("Mabel TV has already been set up")
            supplied_code = str(payload.get("setup_code", "")).strip()
            if not self.verify_setup_code(supplied_code):
                raise ValueError("That setup code is not correct")
            pin = str(payload.get("pin", "")).strip()
            if not PIN_PATTERN.fullmatch(pin):
                raise ValueError("Choose a PIN containing 4 to 8 numbers")
            existing_channels = self.channels()
            recovering_owner = self.owner_recovery_path.is_file()
            # Physical PIN recovery must never reinterpret editable browser
            # channel fields and accidentally orphan existing media folders.
            channels = self.normalise_channels(existing_channels) \
                if recovering_owner else self.normalise_channels(payload.get(
                    "channels", existing_channels or DEFAULT_CHANNELS))
            for channel in channels:
                (self.media_root / channel["folder"]).mkdir(mode=0o750, exist_ok=True)
            self.write_json(self.channels_path, {"schema_version": 1, "channels": channels})
            owner_name = str(payload.get("owner_name", "Owner")).strip()[:60] or "Owner"
            if recovering_owner:
                child_name, tv_name = self.tv_identity()
            else:
                child_name, tv_name = self.normalise_tv_identity(
                    payload.get("child_name", "Kids"))
            self.write_json(self.owner_path, {
                "schema_version": 1,
                "setup_complete": True,
                "owner_name": owner_name,
                "child_name": child_name,
                "tv_name": tv_name,
                "legacy_default_pin": False,
                "portal_pin_required": True,
                "created_at": int(time.time()),
                **self.pin_record(pin),
            })
            self.unlink_with_retry(self.owner_recovery_path)
            self.sessions.clear()
        try:
            self.admin_action("restart-player")
            restarted = True
        except ValueError as error:
            # Setup itself is safely committed. A stopped player can be fixed
            # from the dashboard or by the next boot without making the user
            # repeat the ownership step.
            print(f"Setup completed, but the TV player was not restarted: {error}",
                  file=sys.stderr, flush=True)
            restarted = False
        return {"ok": True, "login_required": True, "player_restarted": restarted}

    def change_pin(self, payload: dict[str, Any]) -> None:
        current = str(payload.get("current_pin", ""))
        new_pin = str(payload.get("new_pin", ""))
        if not self.verify_pin(current):
            raise ValueError("The current PIN is not correct")
        if not PIN_PATTERN.fullmatch(new_pin):
            raise ValueError("Choose a PIN containing 4 to 8 numbers")
        with self.config_lock:
            owner = self.owner()
            owner.update(self.pin_record(new_pin))
            owner["legacy_default_pin"] = False
            owner["pin_changed_at"] = int(time.time())
            self.write_json(self.owner_path, owner)
            self.sessions.clear()

    def set_portal_pin_required(self, payload: dict[str, Any]) -> bool:
        """Change the sign-in gate without ever exposing or replacing the PIN."""
        current = str(payload.get("current_pin", ""))
        required = payload.get("required")
        if not self.verify_pin(current):
            raise ValueError("The current PIN is not correct")
        if not isinstance(required, bool):
            raise ValueError("Choose whether the portal should require a PIN")
        with self.config_lock:
            owner = self.owner()
            owner["portal_pin_required"] = required
            owner["portal_pin_changed_at"] = int(time.time())
            self.write_json(self.owner_path, owner)
            self.sessions.clear()
        return required

    def change_tv_name(self, payload: dict[str, Any]) -> dict[str, str | bool]:
        child_name, tv_name = self.normalise_tv_identity(payload.get("child_name"))
        with self.config_lock:
            owner = self.owner()
            if not self.configured():
                raise ValueError("Finish first-time setup before naming this TV")
            owner["child_name"] = child_name
            owner["tv_name"] = tv_name
            owner["tv_name_changed_at"] = int(time.time())
            self.write_json(self.owner_path, owner)
        try:
            self.admin_action("restart-player")
            restarted = True
        except ValueError:
            restarted = False
        return {"child_name": child_name, "tv_name": tv_name,
                "player_restarted": restarted}

    def login_allowed(self, address: str) -> bool:
        with self.config_lock:
            now = time.time()
            attempts = [value for value in self.login_failures.get(address, [])
                        if value > now - 5 * 60]
            self.login_failures[address] = attempts
            return len(attempts) < 5

    def record_login_failure(self, address: str) -> None:
        with self.config_lock:
            self.login_failures.setdefault(address, []).append(time.time())

    def clear_login_failures(self, address: str) -> None:
        with self.config_lock:
            self.login_failures.pop(address, None)

    def create_session(self) -> str:
        with self.config_lock:
            now = time.time()
            self.sessions = {token: expiry for token, expiry in self.sessions.items()
                             if expiry > now}
            token = secrets.token_urlsafe(32)
            self.sessions[token] = now + SESSION_SECONDS
            return token

    def valid_session(self, token: str | None) -> bool:
        if not token:
            return False
        with self.config_lock:
            # A parent actively using the portal should not be sent back to
            # the PIN screen halfway through an evening.  Sessions remain
            # memory-only (so a real service restart still signs out safely),
            # but each authenticated request renews the eight-hour window.
            if self.sessions.get(token, 0) <= time.time():
                return False
            self.sessions[token] = time.time() + SESSION_SECONDS
            return True

    def revoke_session(self, token: str | None) -> None:
        if token:
            with self.config_lock:
                self.sessions.pop(token, None)
