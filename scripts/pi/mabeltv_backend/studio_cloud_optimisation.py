"""Preview the existing guarded archive replacement using the My TV profile."""
from __future__ import annotations

from pathlib import PurePosixPath
from .compression import compression_profile, compression_choices, compression_target


class StudioCloudOptimisationMixin:
    def studio_cloud_optimise_preview(self, payload):
        profile = compression_profile(payload.get("compression"))
        identities = payload.get("ids")
        if not isinstance(identities, list) or not 1 <= len(identities) <= 100 \
                or any(not isinstance(value, str) for value in identities):
            raise ValueError("Choose between 1 and 100 iCloud videos")
        files = []
        records = self.state_database.studio_cloud_metadata_records()
        for identity in dict.fromkeys(identities):
            item = self.studio_cloud_item(identity)
            if not self._studio_media_file(item):
                raise ValueError("Choose an iCloud video to optimise")
            title = self.studio_cloud_title_for_file(identity)
            metadata = title.get("metadata") or {}
            runtime = metadata.get("runtime") if metadata.get("media_type") == "movie" else None
            if metadata.get("tmdb_id") and not runtime:
                endpoint = f"movie/{metadata['tmdb_id']}" if metadata.get("media_type") == "movie" else None
                if metadata.get("media_type") == "tv" and item.get("episodeNumber") is not None:
                    endpoint = f"tv/{metadata['tmdb_id']}/season/{item['series']}/episode/{item['episodeNumber']}"
                if endpoint:
                    try:
                        runtime = self.my_tv_cached_tmdb_request(endpoint, {"language": "en-GB"}).get("runtime")
                    except (ValueError, OSError):
                        pass
            record = records.get(identity, {})
            valid_record = record.get("fingerprint") == self._studio_title_fingerprint(item)
            recorded_size = record.get("encodingSourceBytes")
            valid_record = valid_record and type(recorded_size) is int and recorded_size >= item["bytes"] \
                and record.get("encodingProfile") in {p["id"] for p in compression_choices()}
            source_size = recorded_size if valid_record else item["bytes"]
            already = bool(valid_record
                           and item["bytes"] <= source_size * profile["sourceFraction"])
            estimate = item["bytes"] if already else compression_target(source_size, profile["id"])
            files.append({"id": item["id"], "title": title["title"], "path": item["path"],
                          "name": item["name"], "bytes": item["bytes"],
                          "type": PurePosixPath(item["path"]).suffix.lstrip(".").upper(),
                          "modified": item.get("modified", ""), "remoteId": item.get("remoteId", ""),
                          "estimatedBytes": estimate, "estimatedSaving": item["bytes"] - estimate,
                          "alreadyMeetsTarget": already, "runtimeMinutes": runtime,
                          "series": item.get("series"), "episodeNumber": item.get("episodeNumber")})
        return {"files": files, "compression": profile["id"], "profiles": compression_choices(),
                "output": f"{profile['label']} · MP4 · H.264 video · AAC stereo · up to 1080p / 30 fps",
                "estimateNote": "Estimated size from the selected two-pass size target. The measured result can vary. "
                                "An existing smaller prepared copy is kept without another conversion. "
                                "The original is kept if the result does not meet the size target."}
