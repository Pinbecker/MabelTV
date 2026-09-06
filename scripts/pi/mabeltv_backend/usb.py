"""Usb behaviour for the local library service."""

from __future__ import annotations

import json
import re
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from .constants import (
    CHUNK_LIMIT,
    MAX_UPLOAD_BYTES,
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
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            job = self.read_json(manifest, {})
            if (isinstance(job, dict) and job.get("source_kind") == "usb"
                    and job.get("source_volume") == identity
                    and job.get("status", "uploading") not in {"error"}):
                try:
                    part = self.incoming / f"{job['id']}.part"
                    if not part.is_file() or part.stat().st_size < int(job.get("size", 0)):
                        return "Finish or cancel the USB transfer"
                except (KeyError, OSError, TypeError, ValueError):
                    return "Finish or cancel the USB transfer"
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
            try:
                free = shutil.disk_usage(expected).free if mounted and expected.is_dir() else None
            except OSError:
                free = None
            volumes.append({
                "id": identity,
                "device": device,
                "label": str(item.get("label") or parent.get("model") or "USB drive").strip(),
                "filesystem": str(item.get("fstype") or "unknown"),
                "size": int(item.get("size") or 0),
                "mounted": mounted and expected.is_dir(),
                "free": free,
            })
        # Test/development mounts can exist without a real lsblk device.
        if not self.usb_requires_mount and self.usb_root.is_dir():
            for path in self.usb_root.iterdir():
                if path.is_dir() and path.name not in seen:
                    volumes.append({"id": path.name, "device": "", "label": path.name,
                                    "filesystem": "directory", "size": 0, "mounted": True,
                                    "free": shutil.disk_usage(path).free})
        with self.usb_power_lock:
            for volume in volumes:
                volume["sleeping"] = volume["id"] in self.usb_sleeping
        volumes.sort(key=lambda value: (not value["mounted"], value["label"].lower()))
        jobs = self.usb_import_jobs(active_only=True)
        with self.usb_import_lock:
            jobs.extend(dict(job) for job in self.usb_imports.values()
                        if job.get("status") not in {"complete", "error"}
                        and not any(value.get("id") == job.get("id") for value in jobs))
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

    def start_usb_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.config_lock:
            plan, specifications = self._usb_import_plan(payload)
            if not plan["enough_space"]:
                raise ValueError("There is not enough free space to copy those USB videos")

            series_id = plan.get("series")

            batch_id = uuid.uuid4().hex
            batch = {
                "id": batch_id,
                "volume": plan["volume"],
                "target": plan["target"],
                "channel": plan.get("channel"),
                "folder": plan.get("folder"),
                "series": series_id,
                "series_name": plan.get("series_name"),
                "season": plan.get("season"),
                "created": time.time(),
                "files_total": len(specifications),
                "bytes_total": int(plan["bytes_total"]),
                "upload_ids": [],
            }
            batch_path = self.usb_import_root / f"{batch_id}.json"
            self.write_json(batch_path, batch)

            for specification in specifications:
                upload_id = uuid.uuid4().hex
                metadata = {
                    "id": upload_id,
                    "kind": specification["kind"],
                    "file_name": specification["file_name"],
                    "size": specification["size"],
                    "created": time.time(),
                    "source_kind": "usb",
                    "source_volume": plan["volume"],
                    "source_path": specification["source_path"],
                    "source_label": plan["source_label"],
                    "batch_id": batch_id,
                }
                if specification.get("channel") is not None:
                    metadata["channel"] = specification["channel"]
                if specification.get("folder"):
                    metadata["folder"] = specification["folder"]
                if specification.get("series_id"):
                    metadata["series_id"] = specification["series_id"]
                    metadata["season"] = specification["season"]
                self.initialise_upload_queue(metadata, "")
                metadata["source_seen"] = time.time()
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                batch["upload_ids"].append(upload_id)
                self.write_json(batch_path, batch)

            self.usb_transfer_wakeup.set()
        return self.usb_import_status(batch_id)

    def usb_import_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Resolve a USB selection into a safe, owner-readable copy preview."""
        with self.config_lock:
            plan, _specifications = self._usb_import_plan(payload)
            return plan

    def _usb_import_plan(
            self, payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        identity = self.usb_identity(str(payload.get("volume", "")))
        selected = payload.get("paths")
        if not isinstance(selected, list):
            raise ValueError("Choose the USB videos to copy")
        target = str(payload.get("target", ""))
        channel_number: int | None = None
        series_name = ""
        series_id = ""
        season_number: int | None = None
        adult_folder = ""
        if target == "series":
            series_id = str(payload.get("series", ""))
            series_root = self.adult_series_path(series_id)
            try:
                season_number = int(payload.get("season"))
            except (TypeError, ValueError) as error:
                raise ValueError("Choose an existing series") from error
            if season_number < 1 or season_number > 99 \
                    or not (series_root / f"Season {season_number}").is_dir():
                raise ValueError("Choose an existing series")
            states = self.adult_series_states()
            series_state = states["series"].get(series_id, {})
            if not isinstance(series_state, dict):
                raise ValueError("Choose an existing Adult TV series")
            metadata = series_state.get("metadata", {})
            series_name = str(metadata.get("title", "")) \
                if isinstance(metadata, dict) else ""
            series_name = series_name or str(series_state.get("title", "Series"))
            files = self._usb_selected_files(identity, selected)
            candidates = [(source, Path(source.name)) for source in files]
        elif target in {"adult", "channel"}:
            files = self._usb_selected_files(identity, selected)
            candidates = [(source, Path(source.name)) for source in files]
            if target == "adult":
                requested_folder = str(payload.get("folder", "")).strip()
                if requested_folder:
                    adult_folder = self.normalise_adult_folder(requested_folder)
                    if adult_folder not in self.adult_folders():
                        raise ValueError("Choose an existing Adult TV collection")
            else:
                channel_number = int(payload.get("channel"))
                self.channel(channel_number)
        else:
            raise ValueError("Choose Adult TV or a children’s channel")

        volume = self._usb_volume(identity)
        root = self.usb_mount_path(identity)
        occupied = self._usb_reserved_destinations()
        specifications: list[dict[str, Any]] = []
        renamed: list[dict[str, str]] = []
        total = 0
        for ordinal, (source, relative) in enumerate(candidates, start=1):
            size = source.stat().st_size
            if size <= 0 or size > MAX_UPLOAD_BYTES:
                raise ValueError(f"{source.name} has a file size MabelTV cannot copy")
            clean_stem = SAFE_NAME.sub("", source.stem).strip(". ") or "USB video"
            clean_name = f"{clean_stem}{source.suffix.lower()}"
            specification: dict[str, Any] = {
                "source_path": source.relative_to(root).as_posix(),
                "size": size,
                "kind": "channel",
            }
            if target == "adult":
                destination_root = self.adult_folder_path(adult_folder) \
                    if adult_folder else self.adult_root
                specification["kind"] = "adult"
                if adult_folder:
                    specification["folder"] = adult_folder
            elif target == "series":
                destination_root = self.adult_series_root / series_id / \
                    f"Season {season_number}"
                specification.update(
                    kind="adult-series", series_id=series_id,
                    season=season_number)
            else:
                channel = self.channel(int(channel_number))
                destination_root = self.media_root / str(channel["folder"])
                specification["channel"] = channel_number

            destination = destination_root / clean_name
            index = 2
            while destination.exists() or destination in occupied:
                destination = destination_root / f"{clean_stem} ({index}){source.suffix.lower()}"
                index += 1
            occupied.add(destination)
            specification["file_name"] = destination.name
            if destination.name != source.name:
                renamed.append({"from": source.name, "to": destination.name})
            specifications.append(specification)
            total += size

        free = shutil.disk_usage(self.media_root).free
        destination_label = (f"Adult TV films · {adult_folder} collection"
                             if adult_folder else
                             "Adult TV films · All films (no collection)") \
            if target == "adult" else \
            f"Adult TV series · {series_name} · Series {season_number}" \
            if target == "series" else \
            str(self.channel(int(channel_number))["name"])
        plan = {
            "volume": identity,
            "source_label": str(volume.get("label") or "USB drive"),
            "target": target,
            "channel": channel_number,
            "folder": adult_folder,
            "series": series_id,
            "series_name": series_name,
            "season": season_number,
            "destination_label": destination_label,
            "files_total": len(specifications),
            "bytes_total": total,
            "free_bytes": free,
            "enough_space": free >= total + USB_IMPORT_RESERVE_BYTES,
            "rename_count": len(renamed),
            "renames": renamed[:20],
            "truncated_renames": len(renamed) > 20,
        }
        return plan, specifications

    def _usb_reserved_destinations(self) -> set[Path]:
        destinations: set[Path] = set()
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            metadata = self.read_json(manifest, {})
            if not isinstance(metadata, dict):
                continue
            try:
                destinations.add(self.upload_destination(metadata))
            except (TypeError, ValueError):
                continue
        return destinations

    def _next_usb_transfer(self) -> tuple[str, dict[str, Any]] | None:
        candidates: list[tuple[int, str, dict[str, Any]]] = []
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            metadata = self.read_json(manifest, {})
            if (not isinstance(metadata, dict) or metadata.get("source_kind") != "usb"
                    or metadata.get("status", "uploading") != "uploading"
                    or metadata.get("transfer_state") != "active"):
                continue
            candidates.append((int(metadata.get("queue_order", 0) or 0),
                               str(metadata.get("id", "")), metadata))
        if not candidates:
            return None
        _order, upload_id, metadata = min(candidates, key=lambda value: value[0])
        return upload_id, metadata

    def run_usb_transfer_worker(self) -> None:
        """Feed Pi-owned USB bytes into the durable upload publication queue."""
        while not self.usb_transfer_closed.is_set():
            job = self._next_usb_transfer()
            if job is None:
                self.usb_transfer_wakeup.wait(0.5)
                self.usb_transfer_wakeup.clear()
                continue
            upload_id, metadata = job
            self._copy_usb_upload(upload_id, metadata)

    def _copy_usb_upload(self, upload_id: str, metadata: dict[str, Any]) -> None:
        try:
            volume = str(metadata.get("source_volume", ""))
            source = self.usb_resolve(volume, str(metadata.get("source_path", "")))
            expected_size = int(metadata.get("size", 0))
            if not source.is_file() or source.stat().st_size != expected_size:
                raise ValueError("The USB source file changed or is no longer available")
            part = self.incoming / f"{upload_id}.part"
            offset = part.stat().st_size if part.is_file() else 0
            if offset > expected_size:
                raise ValueError("The saved partial copy is larger than the USB source")
            with source.open("rb") as reader:
                reader.seek(offset)
                while offset < expected_size and not self.usb_transfer_closed.is_set():
                    current = self.read_json(self.incoming / f"{upload_id}.json", None)
                    if not isinstance(current, dict):
                        return
                    if (current.get("status", "uploading") != "uploading"
                            or current.get("transfer_state") != "active"):
                        return
                    chunk = reader.read(min(CHUNK_LIMIT, expected_size - offset))
                    if not chunk:
                        raise ValueError("The USB source ended before copying completed")
                    result = self.append_upload(upload_id, offset, chunk)
                    offset = int(result["offset"])
            self.usb_touch(volume)
        except Exception as error:
            manifest = self.incoming / f"{upload_id}.json"
            with self.config_lock:
                current = self.read_json(manifest, None)
                if not isinstance(current, dict):
                    return
                if current.get("status") in {"paused", "error"}:
                    return
                current["status"] = "paused"
                current["transfer_state"] = "source-missing"
                current["error"] = str(error)
                current["updated"] = time.time()
                self.write_json(manifest, current)
                self.promote_next_upload()

    def usb_source_available(self, metadata: dict[str, Any]) -> bool:
        identity = str(metadata.get("source_volume", ""))
        if not identity:
            return False
        try:
            self.usb_mount_path(identity)
            return True
        except ValueError:
            return False

    def usb_import_jobs(self, active_only: bool = False) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        for manifest in self.usb_import_root.glob("*.json"):
            try:
                job = self.usb_import_status(manifest.stem)
            except ValueError:
                continue
            if not active_only or job.get("status") not in {"complete", "error"}:
                jobs.append(job)
        return sorted(jobs, key=lambda value: float(value.get("created", 0)))

    def usb_import_status(self, job_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            with self.usb_import_lock:
                legacy = self.usb_imports.get(job_id)
            if legacy is not None:
                return dict(legacy)
            raise ValueError("USB import not found")
        batch = self.read_json(self.usb_import_root / f"{job_id}.json", None)
        if not isinstance(batch, dict):
            with self.usb_import_lock:
                legacy = self.usb_imports.get(job_id)
            if legacy is not None:
                return dict(legacy)
            raise ValueError("USB import not found")

        states: list[dict[str, Any]] = []
        missing = 0
        for upload_id in batch.get("upload_ids", []):
            try:
                states.append(self.upload_status(str(upload_id)))
            except ValueError:
                missing += 1
        bytes_done = sum(int(state.get("offset", 0) or 0) for state in states)
        files_done = sum(bool(state.get("complete")) for state in states)
        failures = [state for state in states
                    if state.get("status") in {"error", "refresh-error"}]
        active = [state for state in states if not state.get("complete")
                  and state.get("status") not in {"error", "refresh-error"}]
        if active:
            status = "paused" if all(state.get("status") == "paused" for state in active) \
                else "copying"
            message = "Waiting for the USB drive" if status == "paused" else "Copying through Uploads"
        elif failures or missing:
            status = "error"
            message = str(failures[0].get("error") or "One or more transfers need attention") \
                if failures else "One or more transfers were cancelled"
        else:
            status = "complete"
            message = "Copy complete"
        current = next((str(state.get("file_name", "")) for state in states
                        if not state.get("complete")), "")
        return {
            **batch,
            "status": status,
            "files_done": files_done,
            "bytes_done": bytes_done,
            "current": current,
            "message": message,
        }
