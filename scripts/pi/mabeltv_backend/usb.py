"""Usb behaviour for the local library service."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .constants import (
    CHUNK_LIMIT,
    SAFE_NAME,
    SUPPORTED_EXTENSIONS,
    USB_IMPORT_RESERVE_BYTES,
    USB_MAX_SELECTION_FILES,
    USB_POWER_POLL_SECONDS,
)


class UsbMixin:
    @staticmethod
    def usb_identity(value: str) -> str:
        identity = re.sub(r"[^A-Za-z0-9._-]", "", value)
        if not identity or identity != value:
            raise ValueError("That USB drive identity is not valid")
        return identity

    def usb_mount_path(self, identity: str) -> Path:
        path = self.usb_root / self.usb_identity(identity)
        try:
            resolved = path.resolve(strict=True)
        except OSError as error:
            raise ValueError("That USB drive is not mounted") from error
        if (resolved.parent != self.usb_root or not resolved.is_dir()
                or (self.usb_requires_mount and not resolved.is_mount())):
            raise ValueError("That USB drive is not mounted")
        return resolved

    @staticmethod
    def _flatten_lsblk(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
        flattened: list[dict[str, Any]] = []
        for value in values:
            flattened.append(value)
            children = value.get("children", [])
            if isinstance(children, list):
                flattened.extend(UsbMixin._flatten_lsblk(children))
        return flattened

    def usb_touch(self, identity: str, when: float | None = None) -> None:
        """Record real USB use so standby starts one minute after it finishes."""
        identity = self.usb_identity(identity)
        with self.usb_power_lock:
            self.usb_last_activity[identity] = time.time() if when is None else when
            self.usb_sleeping.discard(identity)

    def _usb_identity_for_source(self, source: Path) -> str | None:
        try:
            relative = source.resolve(strict=False).relative_to(self.usb_root)
        except (OSError, ValueError):
            return None
        return relative.parts[0] if relative.parts else None

    def _usb_source_matches(self, source: Path, identity: str) -> bool:
        return self._usb_identity_for_source(source) == identity

    def _usb_volume(self, identity: str) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        volume = next((item for item in self.usb_volumes()["volumes"]
                       if item.get("id") == identity), None)
        if not volume:
            raise ValueError("That USB drive is no longer connected")
        return volume

    @staticmethod
    def _run_usb_helper(action: str, device: str, timeout: float = 30.0) -> str:
        result = subprocess.run(
            ["sudo", "-n", "/usr/local/libexec/mabeltv-admin-action", action, device],
            capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            fallback = {
                "usb-mount": "The USB drive could not be opened",
                "usb-sleep": "The USB drive could not enter sleep mode",
                "usb-eject": "The USB drive could not be fully ejected",
            }.get(action, "The USB drive action did not complete")
            raise ValueError(result.stderr.strip() or fallback)
        return result.stdout.strip()

    def usb_busy_reason(self, identity: str, include_processes: bool = True) -> str | None:
        """Return why a drive must stay awake, or None when standby is safe."""
        identity = self.usb_identity(identity)
        with self.usb_import_lock:
            if any(job.get("volume") == identity
                   and job.get("status") not in {"complete", "error"}
                   for job in self.usb_imports.values()):
                return "Wait for the USB import to finish"
        with self.remote_stream_lock:
            stream = self.remote_stream
            if stream and float(stream.get("expires", 0)) > time.time() \
                    and self._usb_source_matches(Path(stream.get("source", "")), identity):
                return "Stop watching the USB video on this device"
        with self.external_stream_lock:
            self._cleanup_external_streams_locked()
            for stream in self.external_streams.values():
                if int(stream.get("active", 0)) > 0 \
                        and self._usb_source_matches(Path(stream.get("source", "")), identity):
                    return "Wait for phone playback or downloading to finish"
        with self.offline_preparation_lock:
            for job in self.offline_preparations.values():
                if job.get("status") in {"queued", "preparing"} \
                        and self._usb_source_matches(Path(job.get("source", "")), identity):
                    return "Wait for offline preparation to finish"
        mount_path = self.usb_root / identity
        if include_processes and self.usb_requires_mount and mount_path.is_mount():
            try:
                in_use = subprocess.run(
                    ["fuser", "-m", str(mount_path)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=3, check=False).returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                # A failed inspection must never make automatic unmounting less safe.
                return "The USB drive activity could not be checked"
            if in_use:
                return "Stop the video currently playing from this USB drive"
        return None

    def usb_sleep(self, identity: str, automatic: bool = False) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        with self.usb_action_lock:
            volume = self._usb_volume(identity)
            reason = self.usb_busy_reason(identity, include_processes=bool(volume.get("mounted")))
            if reason:
                if automatic:
                    self.usb_touch(identity)
                    return {"ok": False, "busy": True, "message": reason}
                raise ValueError(f"{reason} before putting the drive to sleep")
            message = self._run_usb_helper("usb-sleep", str(volume.get("device", "")))
            with self.usb_power_lock:
                self.usb_sleeping.add(identity)
                self.usb_last_activity.pop(identity, None)
        return {"ok": True, "sleeping": True, "message": message}

    def usb_power_tick(self, now: float | None = None) -> None:
        """Put every connected drive into standby after one idle minute."""
        current = time.time() if now is None else now
        volumes = self.usb_volumes()["volumes"]
        present = {str(volume.get("id", "")) for volume in volumes}
        with self.usb_power_lock:
            self.usb_sleeping.intersection_update(present)
            self.usb_last_activity = {
                identity: last for identity, last in self.usb_last_activity.items()
                if identity in present
            }
            for identity in present:
                if identity and identity not in self.usb_sleeping:
                    self.usb_last_activity.setdefault(identity, current)
            due = [volume for volume in volumes
                   if str(volume.get("id", "")) not in self.usb_sleeping
                   and current - self.usb_last_activity.get(
                       str(volume.get("id", "")), current) >= self.usb_idle_seconds]
        for volume in due:
            identity = str(volume.get("id", ""))
            try:
                self.usb_sleep(identity, automatic=True)
            except (OSError, subprocess.TimeoutExpired, ValueError) as error:
                self.usb_touch(identity, current)
                print(f"USB automatic sleep failed for {identity}: {error}", file=sys.stderr)

    def run_usb_power_worker(self) -> None:
        interval = min(USB_POWER_POLL_SECONDS, max(1.0, self.usb_idle_seconds / 4))
        while not self.usb_power_closed.wait(interval):
            try:
                self.usb_power_tick()
            except Exception as error:
                print(f"USB power manager failed: {error}", file=sys.stderr)

    def usb_volumes(self) -> dict[str, Any]:
        volumes: list[dict[str, Any]] = []
        seen: set[str] = set()
        try:
            result = subprocess.run([
                "lsblk", "--json", "--bytes", "-o",
                "NAME,PATH,LABEL,MODEL,UUID,FSTYPE,SIZE,TYPE,RM,TRAN,MOUNTPOINTS,PKNAME",
            ], capture_output=True, text=True, check=True, timeout=5)
            devices = self._flatten_lsblk(json.loads(result.stdout).get("blockdevices", []))
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            devices = []
        parents = {str(item.get("name", "")): item for item in devices}
        # USB hard disks commonly report RM=0 even though they are genuinely
        # external.  Transport is the useful boundary here.  Exclude an entire
        # parent disk if any of its partitions backs the running system so a
        # USB-booted Pi can never offer its own boot drive in the portal.
        system_parents = {
            str(item.get("pkname", ""))
            for item in devices
            if item.get("type") == "part"
            and any(str(point) == "/" or str(point).startswith("/boot")
                    for point in (item.get("mountpoints") or []) if point)
        }
        for item in devices:
            if item.get("type") != "part":
                continue
            parent = parents.get(str(item.get("pkname", "")), {})
            if (str(parent.get("tran", "")) != "usb"
                    or str(item.get("pkname", "")) in system_parents):
                continue
            device = str(item.get("path", ""))
            raw_identity = str(item.get("uuid") or Path(device).name)
            identity = re.sub(r"[^A-Za-z0-9._-]", "", raw_identity)
            if not identity or identity in seen:
                continue
            seen.add(identity)
            mountpoints = item.get("mountpoints") or []
            if isinstance(mountpoints, str):
                mountpoints = [mountpoints]
            expected = self.usb_root / identity
            mounted = any(Path(str(point)).resolve() == expected
                          for point in mountpoints if point)
            volumes.append({
                "id": identity,
                "device": device,
                "label": str(item.get("label") or parent.get("model") or "USB drive").strip(),
                "filesystem": str(item.get("fstype") or "unknown"),
                "size": int(item.get("size") or 0),
                "mounted": mounted and expected.is_dir(),
            })
        # Test/development mounts can exist without a real lsblk device.
        if not self.usb_requires_mount and self.usb_root.is_dir():
            for path in self.usb_root.iterdir():
                if path.is_dir() and path.name not in seen:
                    volumes.append({"id": path.name, "device": "", "label": path.name,
                                    "filesystem": "directory", "size": 0, "mounted": True})
        with self.usb_power_lock:
            for volume in volumes:
                volume["sleeping"] = volume["id"] in self.usb_sleeping
        volumes.sort(key=lambda value: (not value["mounted"], value["label"].lower()))
        with self.usb_import_lock:
            jobs = [dict(job) for job in self.usb_imports.values()
                    if job.get("status") not in {"complete", "error"}]
        return {"volumes": volumes, "imports": jobs}

    def usb_resolve(self, identity: str, relative: str = "") -> Path:
        root = self.usb_ensure_awake(identity)
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("That USB path is not valid")
        candidate = root.joinpath(relative_path)
        try:
            resolved = candidate.resolve(strict=True)
        except OSError as error:
            raise ValueError("That item is no longer on the USB drive") from error
        if resolved != root and root not in resolved.parents:
            raise ValueError("That USB path is not valid")
        return resolved

    def usb_browse(self, identity: str, relative: str = "") -> dict[str, Any]:
        directory = self.usb_resolve(identity, relative)
        root = self.usb_mount_path(identity)
        if not directory.is_dir():
            raise ValueError("Choose a folder on the USB drive")
        entries: list[dict[str, Any]] = []
        for item in sorted(directory.iterdir(), key=lambda path: (not path.is_dir(), path.name.lower())):
            if (item.is_symlink() or item.name.startswith(".")
                    or item.name.casefold() in {"$recycle.bin", "system volume information", "lost+found"}):
                continue
            is_directory = item.is_dir()
            if not is_directory and (not item.is_file()
                                     or item.suffix.lower() not in SUPPORTED_EXTENSIONS):
                continue
            child_relative = item.relative_to(root).as_posix()
            entries.append({
                "name": item.name,
                "path": child_relative,
                "type": "folder" if is_directory else "video",
                "size": 0 if is_directory else item.stat().st_size,
                "browser_ready": is_directory or self.remote_browser_ready(item),
            })
            if len(entries) >= 500:
                break
        parent = Path(relative).parent.as_posix() if relative else ""
        if parent == ".":
            parent = ""
        return {"volume": identity, "path": Path(relative).as_posix() if relative else "",
                "parent": parent, "entries": entries, "truncated": len(entries) >= 500}

    def usb_mount(self, device: str) -> dict[str, Any]:
        if not re.fullmatch(r"/dev/sd[a-z][0-9]+", device):
            raise ValueError("Choose a removable USB partition")
        with self.usb_action_lock:
            self._run_usb_helper("usb-mount", device)
            result = self.usb_volumes()
            mounted = next((volume for volume in result["volumes"]
                            if volume.get("device") == device and volume.get("mounted")), None)
            if not mounted:
                raise ValueError("The USB drive did not become ready in time")
            self.usb_touch(str(mounted["id"]))
            mounted["sleeping"] = False
            return result

    def usb_ensure_awake(self, identity: str) -> Path:
        identity = self.usb_identity(identity)
        try:
            root = self.usb_mount_path(identity)
            self.usb_touch(identity)
            return root
        except ValueError:
            if not self.usb_requires_mount:
                raise
        volume = self._usb_volume(identity)
        self.usb_mount(str(volume.get("device", "")))
        return self.usb_mount_path(identity)

    def usb_eject(self, identity: str) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        with self.usb_action_lock:
            volume = self._usb_volume(identity)
            reason = self.usb_busy_reason(
                identity, include_processes=bool(volume.get("mounted")))
            if reason:
                raise ValueError(f"{reason} before fully ejecting the drive")
            message = self._run_usb_helper("usb-eject", str(volume.get("device", "")))
            with self.usb_power_lock:
                self.usb_sleeping.discard(identity)
                self.usb_last_activity.pop(identity, None)
        return {"ok": True, "message": message}

    def usb_play(self, identity: str, relative: str) -> dict[str, Any]:
        source = self.usb_resolve(identity, relative)
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("Choose a supported video to play")
        command = json.dumps({"command": "play-external", "path": str(source),
                              "title": self.display_name(source.name)}, separators=(",", ":"))
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((command + "\n").encode())
                reply = client.recv(32).decode(errors="replace").strip()
        except OSError as error:
            raise ValueError("The TV player is not ready for USB playback") from error
        if reply != "ok":
            raise ValueError("The TV could not start that USB video")
        self.usb_touch(identity)
        return {"ok": True, "message": f"Playing {self.display_name(source.name)} from USB"}

    def _usb_selected_files(self, identity: str, selected: list[Any]) -> list[Path]:
        files: list[Path] = []
        for raw in selected:
            item = self.usb_resolve(identity, str(raw))
            candidates = [item] if item.is_file() else sorted(item.rglob("*"))
            for candidate in candidates:
                if candidate.is_symlink() or not candidate.is_file() \
                        or candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                files.append(candidate)
                if len(files) > USB_MAX_SELECTION_FILES:
                    raise ValueError("Choose fewer than 2,000 videos at a time")
        unique = list(dict.fromkeys(files))
        if not unique:
            raise ValueError("Choose at least one video or folder to import")
        return unique

    def _usb_series_selected_files(
            self, identity: str, selected: list[Any]) -> list[tuple[Path, Path]]:
        values: list[tuple[Path, Path]] = []
        for raw in selected:
            item = self.usb_resolve(identity, str(raw))
            if item.is_file():
                candidates = [(item, Path(item.name))]
            else:
                prefix = Path(item.name) if re.search(
                    r"(?i)\b(?:series|season)\s*\d+\b", item.name) else Path()
                candidates = [
                    (candidate, prefix / candidate.relative_to(item))
                    for candidate in sorted(item.rglob("*"))
                    if candidate.is_file()
                ]
            for candidate, relative in candidates:
                if candidate.is_symlink() or candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                clean_parts = [
                    SAFE_NAME.sub("", part).strip(". ") or "Episode"
                    for part in relative.parts
                ]
                values.append((candidate, Path(*clean_parts)))
                if len(values) > USB_MAX_SELECTION_FILES:
                    raise ValueError("Choose fewer than 2,000 episodes at a time")
        unique: dict[Path, Path] = {}
        for source, relative in values:
            unique.setdefault(source, relative)
        if not unique:
            raise ValueError("Choose at least one episode or series folder")
        return list(unique.items())

    @staticmethod
    def unique_destination(folder: Path, name: str) -> Path:
        clean = SAFE_NAME.sub("", Path(name).stem).strip(". ") or "USB video"
        suffix = Path(name).suffix.lower()
        destination = folder / f"{clean}{suffix}"
        index = 2
        while destination.exists() or destination.with_name(destination.name + ".part").exists():
            destination = folder / f"{clean} ({index}){suffix}"
            index += 1
        return destination

    def start_usb_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        identity = self.usb_identity(str(payload.get("volume", "")))
        selected = payload.get("paths")
        if not isinstance(selected, list):
            raise ValueError("Choose the USB videos to import")
        target = str(payload.get("target", ""))
        channel_number: int | None = None
        relative_destinations: dict[Path, Path] | None = None
        if target == "adult":
            files = self._usb_selected_files(identity, selected)
            destination_root = self.adult_root
        elif target == "series":
            pairs = self._usb_series_selected_files(identity, selected)
            requested_title = str(payload.get("series_name", "")).strip()
            if not requested_title and len(selected) == 1:
                requested_title = self.usb_resolve(identity, str(selected[0])).stem
            series_id = self.create_adult_series(requested_title)
            destination_root = self.adult_series_root / series_id
            files = [source for source, _relative in pairs]
            relative_destinations = dict(pairs)
        elif target == "channel":
            files = self._usb_selected_files(identity, selected)
            channel_number = int(payload.get("channel"))
            channel = self.channel(channel_number)
            destination_root = self.media_root / str(channel["folder"])
        else:
            raise ValueError("Choose Adult mode or a children’s channel")
        destination_root.mkdir(mode=0o750, exist_ok=True)
        total = sum(path.stat().st_size for path in files)
        if shutil.disk_usage(self.media_root).free < total + USB_IMPORT_RESERVE_BYTES:
            raise ValueError("There is not enough free space to import those USB videos")
        job_id = uuid.uuid4().hex
        job = {"id": job_id, "volume": identity, "target": target,
               "channel": channel_number, "status": "queued", "files_total": len(files),
               "files_done": 0, "bytes_total": total, "bytes_done": 0,
               "current": "", "message": "Waiting to copy"}
        with self.usb_import_lock:
            completed = [key for key, value in self.usb_imports.items()
                         if value.get("status") in {"complete", "error"}]
            for key in completed[:-20]:
                self.usb_imports.pop(key, None)
            self.usb_imports[job_id] = job
        if target == "series":
            job["series"] = series_id
        threading.Thread(target=self._run_usb_import,
                         args=(job_id, files, destination_root, relative_destinations),
                         name=f"mabeltv-usb-{job_id[:8]}", daemon=True).start()
        return dict(job)

    def _run_usb_import(self, job_id: str, files: list[Path], destination_root: Path,
                        relative_destinations: dict[Path, Path] | None = None) -> None:
        try:
            with self.usb_import_lock:
                job = self.usb_imports[job_id]
                job.update(status="copying", message="Copying from USB")
            for index, source in enumerate(files):
                if relative_destinations is None:
                    destination = self.unique_destination(destination_root, source.name)
                else:
                    relative = relative_destinations[source]
                    parent = destination_root.joinpath(*relative.parts[:-1])
                    parent.mkdir(parents=True, mode=0o750, exist_ok=True)
                    destination = self.unique_destination(parent, relative.name)
                partial = self.incoming / f"usb-{job_id}-{index}.part"
                with self.usb_import_lock:
                    job["current"] = source.name
                try:
                    with source.open("rb") as reader, partial.open("xb") as writer:
                        while True:
                            chunk = reader.read(CHUNK_LIMIT)
                            if not chunk:
                                break
                            writer.write(chunk)
                            with self.usb_import_lock:
                                job["bytes_done"] += len(chunk)
                        writer.flush()
                        os.fsync(writer.fileno())
                    os.replace(partial, destination)
                finally:
                    partial.unlink(missing_ok=True)
                with self.usb_import_lock:
                    job["files_done"] += 1
            refreshed = True if job.get("target") == "series" else self.refresh_tv()
            with self.usb_import_lock:
                job.update(status="complete", current="",
                           message="Import complete" if refreshed else
                           "Copied successfully; TV refresh is still pending")
            self.usb_touch(str(job.get("volume", "")))
        except Exception as error:
            with self.usb_import_lock:
                job = self.usb_imports[job_id]
                job.update(status="error", message=str(error), current="")
            self.usb_touch(str(job.get("volume", "")))

    def usb_import_status(self, job_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("USB import not found")
        with self.usb_import_lock:
            job = self.usb_imports.get(job_id)
            if job is None:
                raise ValueError("USB import not found")
            return dict(job)
