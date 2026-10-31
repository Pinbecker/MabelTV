"""Independent My TV to Mabel TV copies, published by the durable media queue."""
from __future__ import annotations

from copy import deepcopy
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any


class MyTvTransferMixin:
    def _mabel_copy_sources(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        kind = str(payload.get("kind", ""))
        if kind == "my_tv":
            self.remote_source(payload)
            path = str(payload.get("file", ""))
            state = self.my_tv_media_states().get(path, {})
            return [{"source": {"kind": kind, "file": path},
                     "metadata": deepcopy(state.get("metadata", {}))}]
        if kind != "my-tv-series":
            raise ValueError("Choose a local My TV film or episode")
        series = next((s for s in self.my_tv_series_library()
                       if s["id"] == str(payload.get("series", ""))), None)
        if not series:
            raise ValueError("That local show is no longer available")
        episodes = [e for e in series["episodes"]
                    if not payload.get("file") or e["path"] == payload["file"]]
        if not episodes:
            raise ValueError("That local episode is no longer available")
        episode_states = self.my_tv_series_states()["episodes"]
        return [{"source": {"kind": kind, "series": series["id"], "file": e["path"]},
                 "name": f"S{int(e['season']):02d}E{int(e['episode']):02d} - {Path(e['path']).name}",
                 "metadata": deepcopy(episode_states.get(
                     f"{series['id']}/{e['path']}", {}).get("metadata", {})),
                 "show_metadata": deepcopy(series.get("metadata", {}))} for e in episodes]

    def send_my_tv_to_mabel(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.config_lock:
            items = self._mabel_copy_sources(payload)
            content_type = "films" if payload.get("kind") == "my_tv" else "shows"
            new_name = str(payload.get("new_channel", "")).strip()
            if new_name:
                number = max([int(c["number"]) for c in self.channels()] or [0]) + 1
                folder = "channel-" + uuid.uuid4().hex[:12]
                target = {"number": number, "name": new_name, "folder": folder,
                          "aspect": "fit", "content_type": content_type}
                self.normalise_channels([*self.channels(), target])
            else:
                target = self.channel(int(payload.get("channel", 0)))
                number = int(target["number"])
                if self.channel_content_type(target) != content_type:
                    raise ValueError("Choose a film channel" if content_type == "films"
                                     else "Choose an episode channel")
            occupied = self._usb_reserved_destinations()
            total = 0
            for item in items:
                _, source, _, _, _ = self.remote_source(item["source"])
                name = item.get("name", source.name)
                destination = self.safe_media_path(target, name)
                if destination.exists() or destination in occupied:
                    raise ValueError(f"{name} is already in, or being sent to, this channel")
                occupied.add(destination)
                stat = source.stat()
                item.update(file_name=name, size=stat.st_size, source_mtime=stat.st_mtime_ns)
                total += stat.st_size
            outstanding = sum(max(0, int(j["size"]) - int(j["offset"])) for j in self.upload_jobs())
            if shutil.disk_usage(self.media_root).free < total + outstanding + 512 * 1024 * 1024:
                raise ValueError("There is not enough free space for independent copies")
            if new_name:
                self._apply_management({"action": "add-channel", **target})
            jobs = []
            for item in items:
                identity = uuid.uuid4().hex
                metadata = {"id": identity, "kind": "channel", "channel": number,
                            "file_name": item["file_name"], "size": item["size"],
                            "created": time.time(), "updated": time.time(), "status": "queued",
                            "transfer_state": "complete", "source_kind": "my-tv-copy",
                            "source_label": "My TV", "copy_source": item["source"],
                            "copy_mtime": item["source_mtime"], "copy_metadata": item["metadata"],
                            "copy_show_metadata": item.get("show_metadata", {}),
                            "queue_order": self.next_upload_queue_order()}
                self.write_json(self.incoming / f"{identity}.json", metadata)
                jobs.append(identity)
            for identity in jobs:
                self.queue_conversion(identity)
            return {"ok": True, "jobs": jobs, "channel": number,
                    "channel_name": target["name"], "count": len(jobs)}

    def mabel_copy_source_available(self, metadata: dict[str, Any]) -> bool:
        try:
            _, source, _, _, _ = self.remote_source(metadata["copy_source"])
            stat = source.stat()
            return stat.st_size == int(metadata["size"]) and stat.st_mtime_ns == int(metadata["copy_mtime"])
        except (KeyError, OSError, TypeError, ValueError):
            return False

    def prepare_mabel_copy(self, upload_id: str, metadata: dict[str, Any]) -> None:
        destination = self.upload_destination(metadata)
        previous = metadata.get("resume_from_status", metadata.get("status"))
        if destination.is_file() and previous in {"publishing", "finalising", "error"}:
            return
        if not self.mabel_copy_source_available(metadata):
            raise ValueError("The My TV original changed or is no longer available")
        _, source, _, _, _ = self.remote_source(metadata["copy_source"])
        part = self.incoming / f"{upload_id}.part"
        offset = part.stat().st_size if part.is_file() else 0
        size = int(metadata["size"])
        if offset > size:
            raise ValueError("The partial copy is larger than the original")
        metadata.update(status="copying", updated=time.time())
        self.write_json(self.incoming / f"{upload_id}.json", metadata)
        with source.open("rb") as reader, part.open("ab") as writer:
            reader.seek(offset)
            while offset < size:
                if self.conversion_closed.is_set():
                    raise ValueError("Copy paused while the media service stops")
                chunk = reader.read(min(4 * 1024 * 1024, size - offset))
                if not chunk:
                    raise ValueError("The original ended before the copy completed")
                writer.write(chunk)
                offset += len(chunk)
            writer.flush()
            os.fsync(writer.fileno())
        if not self.mabel_copy_source_available(metadata):
            part.unlink(missing_ok=True)
            raise ValueError("The My TV original changed while it was copied")
        metadata.update(status="queued", updated=time.time())
        self.write_json(self.incoming / f"{upload_id}.json", metadata)

    def finish_mabel_copy(self, metadata: dict[str, Any], destination: Path) -> None:
        """Copy descriptive metadata/art, never private progress, favourites or IDs."""
        try:
            _, original, _, _, _ = self.remote_source(metadata["copy_source"])
        except ValueError:
            original = None
        for suffix in ((".srt", ".vtt") if original else ()):
            sidecars = [original.with_suffix(suffix), *original.parent.glob(original.stem + ".*" + suffix)]
            for sidecar in sidecars:
                if sidecar.is_file():
                    target = destination.parent / (destination.stem + sidecar.name[len(original.stem):])
                    if not target.exists(): shutil.copy2(sidecar, target)
        source_kind = metadata["copy_source"]["kind"]
        art_root = self.my_tv_artwork_root if source_kind == "my_tv" else self.my_tv_series_artwork_root
        def describe(value: dict[str, Any]) -> dict[str, Any]:
            result = deepcopy(value)
            for key in list(result):
                if key in {"subtitles", "library_id", "favourite", "watched", "ignored_player_position"} or key.startswith("remote_"):
                    result.pop(key, None)
            for key in ["poster", "still"]:
                name = str(result.get(key, ""))
                if not name:
                    continue
                original = art_root / Path(name).name
                if original.is_file():
                    copy_name = "copy-" + metadata["id"] + "-" + key + original.suffix
                    shutil.copy2(original, self.channel_artwork_root / copy_name)
                    result[key] = copy_name
                else:
                    result.pop(key, None)
            return result
        with self.config_lock:
            states = self.channel_media_states()
            key = self.channel_programme_key(int(metadata["channel"]), destination.name)
            states.setdefault("programmes", {})[key] = describe(metadata.get("copy_metadata", {}))
            show = metadata.get("copy_show_metadata", {})
            channel_key = str(metadata["channel"])
            if show and channel_key not in states.setdefault("channels", {}):
                states["channels"][channel_key] = describe(show)
            self.write_channel_media_states(states)
