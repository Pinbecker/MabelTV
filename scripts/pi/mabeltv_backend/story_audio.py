"""Prepare an immutable chapter upload as one continuous story recording."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import tempfile
import zipfile

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".aiff", ".aif", ".opus"}


def prepare_story_audio(library, source, destination, upload_id):
    temporary = destination.with_name(destination.stem + ".joining.m4a")
    try:
        with zipfile.ZipFile(source) as archive, tempfile.TemporaryDirectory(
                prefix="story-chapters-", dir=library.incoming) as folder:
            entries = archive.infolist()
            if not 2 <= len(entries) <= 100:
                raise ValueError("Choose two to 100 audio chapters for one story")
            if any(entry.is_dir() or entry.flag_bits & 1 or entry.compress_type != zipfile.ZIP_STORED
                   or Path(entry.filename).name != entry.filename or "\\" in entry.filename
                   or Path(entry.filename).suffix.lower() not in AUDIO_EXTENSIONS
                   or not entry.file_size for entry in entries):
                raise ValueError("The story package must contain only audio chapter files")
            if sum(entry.file_size for entry in entries) > source.stat().st_size:
                raise ValueError("The story package is invalid")
            if shutil.disk_usage(library.media_root).free < source.stat().st_size * 3 + 128 * 1024 * 1024:
                raise ValueError("There is not enough space to prepare these story chapters")
            chapters = []
            for index, entry in enumerate(sorted(entries, key=lambda item: item.filename)):
                if upload_id in library.cancelled_conversions:
                    raise ValueError("Story preparation cancelled")
                raw = Path(folder) / (f"source-{index:03}" + Path(entry.filename).suffix.lower())
                with archive.open(entry) as original, raw.open("wb") as output:
                    shutil.copyfileobj(original, output, length=1024 * 1024)
                chapter = Path(folder) / f"{index:03}.m4a"
                library.family_ffmpeg(raw, chapter, ["-map", "0:a:0", "-vn", "-c:a", "aac",
                    "-b:a", "128k", "-ac", "2", "-ar", "48000", "-movflags", "+faststart"], upload_id)
                raw.unlink(); chapters.append(chapter)
            listing = Path(folder) / "chapters.ffconcat"
            listing.write_text("ffconcat version 1.0\n" + "".join(
                f"file '{chapter.name}'\n" for chapter in chapters), encoding="utf-8")
            library.family_run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1",
                "-f", "concat", "-safe", "1", "-i", str(listing), "-map", "0:a:0", "-c:a", "copy",
                "-movflags", "+faststart", str(temporary)], upload_id)
            library.family_probe(temporary)
            os.replace(temporary, destination)
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise ValueError("The story chapter package could not be read") from error
    finally:
        temporary.unlink(missing_ok=True)
