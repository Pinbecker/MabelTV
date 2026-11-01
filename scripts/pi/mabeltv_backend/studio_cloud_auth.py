"""Private rclone configuration conversation; passwords never enter argv/logs."""
from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=100)
        self.path = str(path)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class ICloudConversation:
    def __init__(self, root: Path, current: Path):
        self.id = secrets.token_hex(16)
        self.created = time.time()
        self.root = root / self.id
        self.root.mkdir(parents=True, mode=0o700)
        self.config = self.root / "rclone.conf"
        if current.is_file():
            shutil.copyfile(current, self.config)
            os.chmod(self.config, 0o600)
        self.socket = self.root / "rc.sock"
        self.process = subprocess.Popen([
            "rclone", "--config", str(self.config), "rcd", "--rc-addr",
            "unix://" + str(self.socket), "--rc-no-auth"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if self.socket.exists():
                break
            if self.process.poll() is not None:
                raise ValueError("The iCloud connection helper could not start")
            time.sleep(0.03)
        else:
            self.close()
            raise ValueError("The iCloud connection helper did not respond")
        self.state = ""
        self.option = {}
        self.started = False

    def call(self, route, payload):
        connection = UnixConnection(self.socket)
        try:
            connection.request("POST", "/" + route, json.dumps(payload), {"Content-Type": "application/json"})
            response = connection.getresponse()
            data = json.loads(response.read(1024 * 1024))
            if response.status != 200:
                # rclone error bodies can echo input parameters. Never expose them.
                raise ValueError("Apple could not complete this step. Check your details and try connecting again.")
            return data
        finally:
            connection.close()

    def advance(self, answer=""):
        if time.time() - self.created > 900:
            raise ValueError("This sign-in expired. Start Connect iCloud again.")
        if not self.started:
            result = self.call("config/create", {"name": "mabeltv_icloud", "type": "iclouddrive",
                               "parameters": {"service": "drive"}, "opt": {"all": True, "nonInteractive": True}})
            self.started = True
        else:
            result = self.call("config/update", {"name": "mabeltv_icloud", "parameters": {},
                               "opt": {"all": True, "nonInteractive": True, "continue": True,
                                       "state": self.state, "result": str(answer)}})
        # Skip advanced implementation choices, keeping defaults server-side.
        for _ in range(12):
            self.state = result.get("State", "")
            self.option = result.get("Option") or {}
            name = self.option.get("Name", "")
            if not self.state or name in {"apple_id", "password", "config_2fa", "config_otp", "config_verification_code"}:
                break
            default = self.option.get("DefaultStr", str(self.option.get("Default", "")))
            result = self.call("config/update", {"name": "mabeltv_icloud", "parameters": {},
                               "opt": {"all": True, "nonInteractive": True, "continue": True,
                                       "state": self.state, "result": default}})
        else:
            raise ValueError("Apple requested an unsupported sign-in step. Please reconnect.")
        if not self.state:
            return {"id": self.id, "complete": True}
        return {"id": self.id, "complete": False, "field": self.option.get("Name"),
                "password": bool(self.option.get("IsPassword")),
                "help": "Apple Account email" if self.option.get("Name") == "apple_id" else
                        "Apple Account password" if self.option.get("Name") == "password" else "Apple verification code",
                "error": "Check the value and try again." if result.get("Error") else ""}

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        # Only disposable pending credentials are removed; the live config is elsewhere.
        shutil.rmtree(self.root, ignore_errors=True)
