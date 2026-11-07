"""Sidecar ownership without crossing video versions that share a stem."""
from pathlib import PurePosixPath


VIDEO_SUFFIXES = {".mp4", ".mkv", ".m4v", ".avi", ".mov", ".webm", ".ts", ".mpg", ".mpeg"}


def belongs_to_video(video, subtitle):
    if subtitle.startswith(video + "."):
        return True
    stem = str(PurePosixPath(video).with_suffix(""))
    if not subtitle.startswith(stem + "."):
        return False
    # Filename-qualified sidecars belong only to that exact container version.
    first_suffix = "." + subtitle[len(stem) + 1:].split(".", 1)[0].lower()
    return first_suffix not in VIDEO_SUFFIXES
