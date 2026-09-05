"""SystemStatus behaviour for the local library service."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
from pathlib import Path
from typing import Any

from .lg import lg_webos_log


class SystemStatusMixin:
    def live_status(self) -> dict[str, Any]:
        """Small polling payload that cannot overwrite an in-progress form."""
        disk = shutil.disk_usage(self.media_root)
        return {
            "uploads": self.upload_jobs(),
            "storage": {"free_gb": disk.free / 1024**3,
                        "used_gb": disk.used / 1024**3,
                        "total_gb": disk.total / 1024**3},
            "system": self.system_status(),
        }

    def activity_status(self) -> dict[str, Any]:
        """Small, durable owner-facing queue for background media work."""
        uploads = self.upload_jobs()
        optimisations = self.adult_optimisations()["items"]
        active_uploads = [item for item in uploads if item.get("status") not in {"error", "refresh-error"}]
        active_optimisations = [item for item in optimisations
                                if item.get("state") in {"queued", "processing", "paused"}]
        temperature = self.cpu_temperature_c()
        return {
            "uploads": uploads,
            "optimisations": optimisations,
            "temperature_c": round(temperature, 1),
            "temperature_warning": temperature >= 65,
            "active": bool(active_uploads or active_optimisations),
        }

    @staticmethod
    def command_output(command: list[str], timeout: int = 4) -> str:
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True,
                                    timeout=timeout)
            return result.stdout.strip() if result.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            return ""

    def wake_connected_tv_only(self) -> None:
        """Queue CEC Image View On without selecting MabelTV's HDMI input."""
        configured = os.environ.get("MABELTV_CEC_DEVICE", "").strip()
        # /dev/cec0 is the verified adapter on this Pi.  Starting cec-client
        # asynchronously matches the original native turn-on flow: the TV is
        # allowed to wake while SSAP keeps retrying the Netflix launch.
        device = configured or "/dev/cec0"
        if not Path(device).exists():
            raise ValueError("MabelTV could not find the connected television's CEC adapter")
        try:
            process = subprocess.Popen(
                ["cec-client", "-s", "-d", "1", "-t", "p", "-o", "MabelTV", device],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                start_new_session=True,
            )
            if process.stdin is None:
                raise OSError("CEC wake process did not provide standard input")
            process.stdin.write("on 0\n")
            process.stdin.close()
        except OSError as exc:
            raise ValueError("MabelTV could not wake the connected television") from exc
        lg_webos_log("CEC wake queued without Active Source")

    def system_status(self) -> dict[str, Any]:
        disk = shutil.disk_usage(self.media_root)
        temperature = self.cpu_temperature_c()
        player_active = self.command_output(
            ["systemctl", "is-active", "mabeltv.service"]) == "active"
        library_active = self.command_output(
            ["systemctl", "is-active", "mabeltv-library.service"]) in {"active", ""}
        throttled_text = self.command_output(["vcgencmd", "get_throttled"])
        try:
            throttled_value = int(throttled_text.partition("=")[2], 16)
        except ValueError:
            throttled_value = 0
        current_throttle = throttled_value & 0xFFFF
        version_path = Path(__file__).with_name("VERSION")
        try:
            version = version_path.read_text(encoding="utf-8").strip()
        except OSError:
            version = "development"
        try:
            uptime_seconds = int(float(Path("/proc/uptime").read_text().split()[0]))
        except (OSError, ValueError, IndexError):
            uptime_seconds = 0
        warnings: list[str] = []
        if not player_active:
            warnings.append("The TV player is not running")
        if temperature >= 75:
            warnings.append("The Raspberry Pi is running hot")
        if current_throttle:
            warnings.append("The Pi is currently reducing performance because of heat or power")
        if disk.free < 2 * 1024**3:
            warnings.append("Less than 2 GB of storage remains")
        if self.owner().get("legacy_default_pin"):
            warnings.append("Change the original default parent PIN")
        worker_running = self.conversion_worker.is_alive()
        if not worker_running:
            warnings.append("The video preparation worker is not running")
        return {
            "healthy": player_active and library_active and temperature < 75
                       and current_throttle == 0 and disk.free >= 2 * 1024**3
                       and worker_running,
            "player": "running" if player_active else "stopped",
            "temperature_c": round(temperature, 1),
            "currently_throttled": current_throttle != 0,
            "historical_throttle": throttled_value != 0,
            "uptime_seconds": uptime_seconds,
            "version": version,
            "device_name": socket.gethostname(),
            "media_worker": "running" if worker_running else "stopped",
            "warnings": warnings,
        }

    def admin_action(self, action: str) -> str:
        if action not in {"restart-player", "reboot", "poweroff", "diagnostics"}:
            raise ValueError("Unknown system action")
        timeout = 330 if action == "diagnostics" else 15
        try:
            result = subprocess.run(
                ["sudo", "-n", "/usr/local/libexec/mabeltv-admin-action", action],
                check=False, capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Mabel TV could not complete that system action") from error
        if result.returncode != 0:
            details = result.stderr.strip()
            raise ValueError(details or "Mabel TV could not complete that system action")
        return result.stdout.strip()
