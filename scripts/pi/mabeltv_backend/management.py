"""Administrative mutations for channels, settings and media organisation."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from .constants import SAFE_NAME, SUPPORTED_EXTENSIONS


class ManagementMixin:
    def reconcile_recycle_items(self) -> None:
        """Resolve a power loss on either side of a recycle-bin move."""
        for manifest_path in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest_path, {})
            file_name = Path(str(item.get("file_name", ""))).name
            folder = str(item.get("folder", ""))
            if not file_name or not folder:
                continue
            recycled = manifest_path.parent / file_name
            original = self.media_root / folder / file_name
            if recycled.is_file():
                # The intent record was durable before the atomic move, so a
                # crash after the move still leaves a visible restorable item.
                continue
            if original.is_file():
                # Crash/failure occurred before the move. The programme never
                # left its channel, so discard only the empty intent record.
                try:
                    shutil.rmtree(manifest_path.parent)
                except OSError as error:
                    print(f"Could not clear incomplete recycle item {manifest_path.parent}: {error}",
                          file=sys.stderr, flush=True)

    def recycle_items(self) -> list[dict[str, str]]:
        values = []
        for manifest in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest, {})
            file_name = Path(str(item.get("file_name", ""))).name
            if item.get("id") and file_name \
                and (manifest.parent / file_name).is_file():
                values.append({"id": item["id"], "display_name": self.display_name(item["file_name"]), "channel_name": item.get("channel_name", "Unknown channel")})
        return sorted(values, key=lambda value: value["id"], reverse=True)

    def update_settings(self, mutator: Any) -> None:
        with self.config_lock:
            settings = self.settings()
            library = settings.setdefault("library", {})
            library.setdefault("disabled_channels", [])
            library.setdefault("disabled_programmes", {})
            mutator(library)
            self.merge_state_fields("settings", {"library": library})

    def refresh_tv(self) -> bool:
        for attempt in range(3):
            try:
                if subprocess.run(
                        ["sudo", "-n", "/usr/local/libexec/mabeltv-library-refresh"],
                        check=False, capture_output=True, timeout=15).returncode == 0:
                    database = getattr(self, "state_database", None)
                    if database is not None:
                        database.bump_revision("library")
                    return True
            except (OSError, subprocess.TimeoutExpired):
                pass
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        return False

    def manage(self, payload: dict[str, Any]) -> bool:
        """Serialise administrative filesystem and state mutations."""
        # Channel changes and upload admission share the same lock so a channel
        # cannot be renumbered or deleted between an upload check and creation.
        if payload.get("action") == "refresh":
            return self.refresh_tv()
        with self.config_lock:
            self._apply_management(payload)
        if payload.get("action") in {
                "optimise-adult", "set-remote-simultaneous",
                "set-watchmode-availability",
                "create-adult-series", "create-adult-season",
                "trash-adult-series", "optimisation-action"}:
            # These settings belong to the portal/library service.  In
            # particular, allowing a browser stream alongside the television
            # must never refresh or otherwise disturb the TV player.
            return True
        return self.refresh_tv()

    def _apply_management(self, payload: dict[str, Any]) -> None:
        action = payload.get("action")
        if action == "optimisation-action":
            self.adult_optimisation_action(str(payload.get("file", "")),
                                           str(payload.get("operation", "")))
            return
        if action == "create-adult-series":
            self.create_adult_series(str(payload.get("name", "")))
            return
        if action == "create-adult-season":
            self.create_adult_season(
                str(payload.get("series", "")), payload.get("season"))
            return
        if action == "trash-adult-series":
            self.trash_adult_series_items(payload)
            return
        if action == "set-parent-overlay-style":
            style = str(payload.get("style", ""))
            if style not in {"classic", "modern"}:
                raise ValueError("Choose the classic or modern parent-control design")
            self.merge_state_fields("settings", {"parent_overlay_style": style})
            return
        if action == "set-tv-guide-enabled":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether the TV guide is on or off")
            self.merge_state_fields("settings", {"tv_guide_enabled": enabled})
            return
        if action == "set-remote-simultaneous":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether simultaneous viewing is allowed")
            self.merge_state_fields("settings", {"remote_allow_simultaneous": enabled})
            return
        if action == "set-watchmode-availability":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether Watchmode availability is on or off")
            self.merge_state_fields(
                "settings", {"watchmode_availability_enabled": enabled})
            return
        if action == "set-tv-settings":
            requested = payload.get("settings")
            if not isinstance(requested, dict):
                raise ValueError("Choose the TV settings to save")

            settings = self.settings()
            playback_mode = requested.get("playback_mode")
            picture_mode = requested.get("picture_mode")
            tv_border = requested.get("tv_border")
            display_resolution = requested.get("display_resolution")
            episode_reset_minutes = requested.get("episode_reset_minutes")
            crt_glass = requested.get("crt_glass")
            video_distortion = requested.get("video_distortion")
            maximum_volume = requested.get("maximum_volume")
            volume_limit_enabled = requested.get("volume_limit_enabled")
            sound_effects_enabled = requested.get("sound_effects_enabled")
            # An already-open, older portal page can submit the rest of the
            # form without this newer field. Retain its current value instead
            # of rejecting an otherwise valid TV-settings save.
            scrubbing_enabled = requested.get(
                "scrubbing_enabled", settings.get("scrubbing_enabled") is True)

            if playback_mode not in {"continuous", "resume"}:
                raise ValueError("Choose a playback behaviour")
            if picture_mode not in {"channel", "crop", "fit", "stretch"}:
                raise ValueError("Choose a picture mode")
            if tv_border not in {"slim-black", "silver-90s", "charcoal-90s", "vintage-black", "dinosaur-den", "ocean-club", "finding-nemo"}:
                raise ValueError("Choose a TV cabinet")
            if display_resolution not in {"720p", "1080p", "native"}:
                raise ValueError("Choose a display resolution")
            if episode_reset_minutes not in {0, 5, 20, 60, 180}:
                raise ValueError("Choose a valid episode reset time")
            if any(isinstance(value, bool) or not isinstance(value, int)
                   for value in (crt_glass, video_distortion, maximum_volume)):
                raise ValueError("TV setting values must be whole numbers")
            if not 0 <= crt_glass <= 100 or not 0 <= video_distortion <= 100:
                raise ValueError("CRT glass and distortion must be between 0 and 100")
            if not 5 <= maximum_volume <= 100:
                raise ValueError("Maximum volume must be between 5 and 100")
            if (not isinstance(volume_limit_enabled, bool)
                    or not isinstance(sound_effects_enabled, bool)
                    or not isinstance(scrubbing_enabled, bool)):
                raise ValueError("Choose whether volume limits, sound effects, and scrubbing are on")

            volume = settings.get("volume")
            if not isinstance(volume, dict):
                volume = {}
            volume["maximum"] = maximum_volume
            volume["limit_enabled"] = volume_limit_enabled
            updates = {
                "playback_mode": playback_mode,
                "episode_reset_minutes": episode_reset_minutes,
                "picture_mode": picture_mode,
                "tv_border": tv_border,
                "crt_glass": crt_glass,
                "video_distortion": video_distortion,
                "display_resolution": display_resolution,
                "sound_effects_enabled": sound_effects_enabled,
                "scrubbing_enabled": scrubbing_enabled,
                "volume": volume,
            }
            self.merge_state_fields("settings", updates)
            return
        if action == "add-channel":
            requested = {
                "number": payload.get("number"),
                "name": payload.get("name"),
                "folder": payload.get("folder"),
                "aspect": payload.get("aspect", "crop"),
                "content_type": payload.get("content_type", "shows"),
            }
            with self.config_lock:
                channels = self.normalise_channels([*self.channels(), requested])
                channel = next(value for value in channels
                               if value["number"] == int(payload.get("number")))
                self.insert_channel(channel)
            (self.media_root / str(channel["folder"])).mkdir(mode=0o750, exist_ok=True)
            return
        if action == "update-channel":
            original_number = int(payload.get("original_number"))
            new_number = int(payload.get("number", original_number))
            if new_number != original_number and any(
                    job.get("channel") == original_number
                    and job.get("status") != "refresh-error"
                    for job in self.upload_jobs()):
                raise ValueError(
                    "Finish or cancel this channel's uploads before changing its number")
            with self.config_lock:
                channels = self.channels()
                current = next((dict(value) for value in channels
                                if int(value.get("number", -1)) == original_number), None)
                if current is None:
                    raise ValueError("Channel not found")
                current.update({
                    "number": new_number,
                    "name": payload.get("name", current.get("name")),
                    "aspect": payload.get("aspect", current.get("aspect", "crop")),
                    "content_type": payload.get(
                        "content_type", current.get("content_type", "shows")),
                })
                values = [current if int(value.get("number", -1)) == original_number
                          else value for value in channels]
                channel = next(value for value in self.normalise_channels(values)
                               if value["number"] == new_number)
                self.update_channel(original_number, channel)
            return
        if action == "delete-channel":
            number = int(payload.get("number", payload.get("channel")))
            channel = self.channel(number)
            if any(job.get("channel") == number
                   and job.get("status") != "refresh-error"
                   for job in self.upload_jobs()):
                raise ValueError(
                    "Finish or cancel this channel's uploads before changing its number")
            folder = self.media_root / str(channel["folder"])
            if folder.is_dir() and any(
                    item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS
                    for item in folder.iterdir()):
                raise ValueError("Move this channel's programmes to the recycle bin")
            for manifest_path in self.bin.glob("*/manifest.json"):
                item = self.read_json(manifest_path, {})
                if item.get("folder") == channel.get("folder"):
                    raise ValueError("Permanently delete or restore its recycled programmes first")
            with self.config_lock:
                self.delete_channel(number)
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
            return
        if action == "create-adult-folder":
            name = self.normalise_adult_folder(str(payload.get("name", "")))
            destination = self.adult_root / name
            if destination.exists():
                raise ValueError("That Adult TV folder already exists")
            destination.mkdir(mode=0o750)
            return
        if action == "rename-adult-folder":
            source = self.adult_folder_path(str(payload.get("folder", "")))
            if not source.is_dir():
                raise ValueError("Adult TV folder not found")
            new_name = self.normalise_adult_folder(str(payload.get("name", "")))
            destination = self.adult_root / new_name
            if destination.exists() and destination != source:
                raise ValueError("That Adult TV folder already exists")
            old_name = source.name
            source.rename(destination)
            states = self.adult_media_states()
            prefix = old_name + "/"
            updated = {
                (new_name + "/" + key[len(prefix):]) if key.startswith(prefix) else key: value
                for key, value in states.items()
            }
            if updated != states:
                self.write_adult_media_states(updated)
            return
        if action == "delete-adult-folder":
            folder = self.adult_folder_path(str(payload.get("folder", "")))
            if not folder.is_dir():
                raise ValueError("Adult TV folder not found")
            if any(folder.iterdir()):
                raise ValueError("Move every film out of this folder before deleting it")
            folder.rmdir()
            return
        if action == "move-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            requested_folder = str(payload.get("folder", "")).strip()
            parent = (self.adult_folder_path(requested_folder, create=False)
                      if requested_folder else self.adult_root)
            if not parent.is_dir():
                raise ValueError("Choose an existing Adult TV folder")
            destination = parent / source.name
            if destination.exists() and destination != source:
                raise ValueError("That folder already contains a film with this name")
            if destination == source:
                return
            old_relative = self.adult_relative_path(source)
            new_relative = self.adult_relative_path(destination)
            source.rename(destination)
            states = self.adult_media_states()
            if old_relative in states:
                states[new_relative] = states.pop(old_relative)
                self.write_adult_media_states(states)
            return
        if action == "rename-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            proposed = SAFE_NAME.sub("", str(payload.get("name", "")).strip()).strip(". ")
            if not proposed:
                raise ValueError("Enter a film name")
            destination = source.with_name(proposed + source.suffix)
            if destination.exists() and destination != source:
                raise ValueError("That name is already used in Adult mode")
            source.rename(destination)
            state = self.adult_media_states()
            old_relative = self.adult_relative_path(source)
            new_relative = self.adult_relative_path(destination)
            if old_relative in state:
                state[new_relative] = state.pop(old_relative)
                self.write_adult_media_states(state)
            return
        if action == "optimise-adult":
            self.request_adult_optimisation(str(payload.get("file", "")))
            return
        if action == "trash-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
            destination_dir = self.bin / item_id
            destination_dir.mkdir(mode=0o750)
            relative = self.adult_relative_path(source)
            states = self.adult_media_states()
            adult_state = states.get(relative, {})
            self.write_json(destination_dir / "manifest.json", {
                "id": item_id, "file_name": source.name,
                "folder": ".adult" + ("/" + source.parent.name
                                        if source.parent != self.adult_root else ""),
                "channel_name": "Adult mode", "adult_state": adult_state,
            })
            try:
                shutil.move(str(source), str(destination_dir / source.name))
            except Exception:
                shutil.rmtree(destination_dir, ignore_errors=True)
                raise
            self.remove_adult_media_state(relative)
            return
        if action in {"toggle-channel", "toggle-programme", "move-programme",
                      "rename", "trash"}:
            channel = self.channel(int(payload.get("channel")))
        if action == "toggle-channel":
            number = channel["number"]
            def change(library: dict[str, Any]) -> None:
                values = set(library.get("disabled_channels", [])); values.symmetric_difference_update({number}); library["disabled_channels"] = sorted(values)
            self.update_settings(change)
        elif action == "toggle-programme":
            file_name = str(payload.get("file", "")); self.safe_media_path(channel, file_name)
            def change(library: dict[str, Any]) -> None:
                key = str(channel["number"]); values = set(library["disabled_programmes"].get(key, [])); values.symmetric_difference_update({file_name}); library["disabled_programmes"][key] = sorted(values)
            self.update_settings(change)
        elif action == "move-programme":
            if self.channel_content_type(channel) != "films":
                raise ValueError("Only films can move between film channels")
            try:
                target = self.channel(int(payload.get("target_channel")))
            except (TypeError, ValueError):
                raise ValueError("Choose another film channel") from None
            if self.channel_content_type(target) != "films":
                raise ValueError("Choose another film channel")
            source_number = int(channel["number"])
            target_number = int(target["number"])
            if source_number == target_number:
                raise ValueError("Choose another film channel")
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            target_folder = self.media_root / str(target["folder"])
            target_folder.mkdir(mode=0o750, exist_ok=True)
            destination = self.safe_media_path(target, source.name)
            if destination.exists():
                raise ValueError("That film channel already contains a film with this name")
            source.rename(destination)

            def move_visibility(library: dict[str, Any]) -> None:
                disabled = library.setdefault("disabled_programmes", {})
                source_values = set(disabled.get(str(source_number), []))
                was_disabled = source.name in source_values
                source_values.discard(source.name)
                disabled[str(source_number)] = sorted(source_values)
                target_values = set(disabled.get(str(target_number), []))
                if was_disabled:
                    target_values.add(destination.name)
                disabled[str(target_number)] = sorted(target_values)
            self.update_settings(move_visibility)

            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            if not isinstance(programmes, dict):
                programmes = {}
            source_key = self.channel_programme_key(source_number, source.name)
            target_key = self.channel_programme_key(target_number, destination.name)
            stored_favourites = states.get("favourites", [])
            favourites = set(stored_favourites) \
                if isinstance(stored_favourites, list) else set()
            favourite_moved = source_key in favourites
            metadata_moved = source_key in programmes
            if favourite_moved:
                favourites.discard(source_key)
                favourites.add(target_key)
            if metadata_moved:
                programmes[target_key] = programmes.pop(source_key)
            if metadata_moved or favourite_moved:
                states.update({"programmes": programmes,
                               "favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
        elif action == "rename":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            proposed = SAFE_NAME.sub("", str(payload.get("name", "")).strip()).strip(". ")
            if not proposed: raise ValueError("Enter a programme name")
            destination = self.safe_media_path(channel, proposed + source.suffix)
            if destination.exists() and destination != source: raise ValueError("That name is already used in this channel")
            source.rename(destination)
            def change(library: dict[str, Any]) -> None:
                key = str(channel["number"]); values = library["disabled_programmes"].get(key, []); library["disabled_programmes"][key] = [destination.name if v == source.name else v for v in values]
            self.update_settings(change)
            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            old_key = self.channel_programme_key(int(channel["number"]), source.name)
            new_key = self.channel_programme_key(int(channel["number"]), destination.name)
            stored_favourites = states.get("favourites", [])
            favourites = set(stored_favourites) \
                if isinstance(stored_favourites, list) else set()
            changed = False
            if isinstance(programmes, dict) and old_key in programmes:
                programmes[new_key] = programmes.pop(old_key)
                changed = True
            if old_key in favourites:
                favourites.discard(old_key)
                favourites.add(new_key)
                changed = True
            if changed:
                states.update({"programmes": programmes,
                               "favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
        elif action == "trash":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"; destination_dir = self.bin / item_id; destination_dir.mkdir(mode=0o750)
            # Persist recovery metadata before moving the only media copy. A
            # power loss after the move can then never make the video invisible.
            self.write_json(destination_dir / "manifest.json", {
                "id": item_id, "file_name": source.name,
                "folder": channel["folder"], "channel_name": channel["name"],
            })
            try:
                shutil.move(str(source), str(destination_dir / source.name))
            except Exception:
                shutil.rmtree(destination_dir, ignore_errors=True)
                raise
        elif action in {"restore", "delete"}:
            item_id = str(payload.get("id", "")); directory = self.bin / item_id
            if not re.fullmatch(r"\d+-[a-f0-9]{8}", item_id) or not directory.is_dir(): raise ValueError("Recycle-bin item not found")
            manifest = self.read_json(directory / "manifest.json", {})
            if action == "restore":
                folder = self.media_root / str(manifest.get("folder", "")); file_name = str(manifest.get("file_name", "")); destination = folder / Path(file_name).name
                if not manifest.get("folder") or destination.exists(): raise ValueError("Cannot restore this item because a file with that name already exists")
                adult_series_id = str(manifest.get("adult_series_id", ""))
                adult_series_state = manifest.get("adult_series_state")
                adult_series_episode_state = manifest.get("adult_series_episode_state")
                if adult_series_id:
                    series_root = self.adult_series_root / adult_series_id
                    if (not re.fullmatch(r"[a-f0-9]{32}", adult_series_id)
                            or not isinstance(adult_series_state, dict)
                            or not isinstance(adult_series_episode_state, dict)
                            or series_root == destination
                            or series_root not in destination.parents):
                        raise ValueError("Cannot restore this episode outside its Adult TV series")
                folder.mkdir(mode=0o750, exist_ok=True); shutil.move(str(directory / file_name), str(destination)); shutil.rmtree(directory)
                if (re.fullmatch(r"[a-f0-9]{32}", adult_series_id)
                        and isinstance(adult_series_state, dict)
                        and isinstance(adult_series_episode_state, dict)):
                    series_root = self.adult_series_root / adult_series_id
                    states = self.adult_series_states()
                    states["series"].setdefault(adult_series_id, adult_series_state)
                    relative = destination.relative_to(series_root).as_posix()
                    states["episodes"][f"{adult_series_id}/{relative}"] = \
                        adult_series_episode_state
                    self.write_adult_series_states(states)
                adult_state = manifest.get("adult_state")
                if str(manifest.get("folder", "")).startswith(".adult") \
                        and isinstance(adult_state, dict):
                    states = self.adult_media_states()
                    states[self.adult_relative_path(destination)] = adult_state
                    self.write_adult_media_states(states)
            else:
                shutil.rmtree(directory)
        else:
            raise ValueError("Unknown library action")
