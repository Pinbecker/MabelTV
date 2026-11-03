"""Selected size-target encoding without changing playback or network ownership."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import uuid
import struct

from .compression import POLICY, compression_profile, compression_target
from .constants import MAX_CONVERSION_TEMP_C, RESUME_CONVERSION_TEMP_C


def probe(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                            check=True, capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)


def proof_for(info, size, duration):
    try:
        proof = json.loads(info.get("format", {}).get("tags", {}).get("comment", "{}"))["mabeltv"]
        compression_profile(proof["profile"])
        if (proof["version"] == POLICY["version"] and type(proof["sourceBytes"]) is int
                and size <= proof["sourceBytes"] <= 2**53 and abs(proof["duration"] - duration) <= 2):
            return proof
    except (KeyError, TypeError, ValueError):
        pass
    return None


def fast_start(path):
    with path.open("rb") as reader:
        size = path.stat().st_size
        offset = 0
        while offset + 8 <= size:
            reader.seek(offset)
            header = reader.read(16)
            length, kind = struct.unpack(">I4s", header[:8])
            if kind == b"moov":
                return True
            if kind == b"mdat":
                return False
            if length == 1:
                if len(header) < 16:
                    return False
                length = struct.unpack(">Q", header[8:])[0]
            if length < 8:
                return False
            offset += length
    return False


def run_encoder(library, source, command, duration, log, callback, pass_number):
    process = None
    paused = False
    last_percent = (pass_number - 1) * 50
    deadline = time.monotonic() + 48 * 3600
    try:
        with log.open("ab") as errors:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True, start_new_session=True)
            while process.poll() is None:
                if time.monotonic() > deadline:
                    raise ValueError("Video conversion timed out. The original was kept")
                if library.conversion_closed.is_set():
                    raise ValueError("Video preparation was interrupted. The original was kept")
                try:
                    relative = library.my_tv_relative_path(source)
                except ValueError:
                    relative = ""
                state = library.my_tv_media_states().get(relative, {})
                if state.get("state") == "error" and state.get("message") == "Optimisation cancelled":
                    raise ValueError("Optimisation cancelled")
                user_paused = state.get("state") == "paused"
                temperature = library.cpu_temperature_c()
                if not paused and (user_paused or temperature >= MAX_CONVERSION_TEMP_C):
                    os.killpg(process.pid, signal.SIGSTOP)
                    paused = True
                    if callback:
                        callback(last_percent, "Paused by you" if user_paused else f"Paused to cool at {temperature:.0f}°C")
                elif paused and not user_paused and temperature <= RESUME_CONVERSION_TEMP_C:
                    os.killpg(process.pid, signal.SIGCONT)
                    paused = False
                if paused:
                    time.sleep(2)
                    continue
                line = process.stdout.readline() if process.stdout else ""
                if line.startswith("out_time_us="):
                    try:
                        percent = min(99, (pass_number - 1) * 50 + int(float(line.partition("=")[2]) / 1e6 / duration * 50))
                    except ValueError:
                        continue
                    if percent > last_percent:
                        last_percent = percent
                        if callback:
                            callback(percent, "")
            if process.returncode:
                raise ValueError("Video conversion failed. The original was kept")
    finally:
        if process is not None and process.poll() is None:
            if paused:
                os.killpg(process.pid, signal.SIGCONT)
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if process is not None and process.stdout is not None:
            process.stdout.close()


def encode_size_profile(library, source, destination, selected, callback=None, target="mytv"):
    """Keep the original until the smaller, compatible output has been checked."""
    profile = compression_profile(selected)
    info = probe(source)
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    duration = float(info.get("format", {}).get("duration", 0))
    if not video or not duration > 0:
        raise ValueError("The video duration could not be read. The original was kept")
    original = source.stat()
    proof = proof_for(info, original.st_size, duration)
    source_bytes = proof["sourceBytes"] if proof else original.st_size
    width, height = (1280, 720) if target == "mabel" else (1920, 1080)
    compatible = (video.get("codec_name") == "h264" and video.get("pix_fmt") == "yuv420p"
                  and video["width"] <= width and video["height"] <= height
                  and library.frame_rate(video) <= 30.1
                  and all(s.get("codec_name") == "aac" for s in audio)
                  and "mp4" in info.get("format", {}).get("format_name", "").split(",") and fast_start(source))
    if proof and compatible and original.st_size <= source_bytes * profile["sourceFraction"]:
        if source != destination:
            if source.parent == library.incoming and source.suffix == ".part":
                os.replace(source, destination)
            else:
                temporary = library.incoming / (uuid.uuid4().hex + ".optimising.mp4")
                try:
                    shutil.copyfile(source, temporary)
                    os.replace(temporary, destination)
                finally:
                    temporary.unlink(missing_ok=True)
        return False
    target_bytes = compression_target(source_bytes, selected)
    bitrate = int(target_bytes * 8 / duration - (profile["audioBitrate"] if audio else 0))
    if bitrate < POLICY["minimumVideoBitrate"]:
        raise ValueError("This file is too small for the selected size target. Choose a larger profile. The original was kept")
    if shutil.disk_usage(library.media_root).free < target_bytes + 512 * 1024**2:
        raise ValueError("There is not enough free space for safe conversion")
    token = uuid.uuid4().hex
    output = library.incoming / f"{token}.optimising.mp4"
    passlog = library.incoming / f"{token}.size-pass"
    log = library.incoming / f"{token}.ffmpeg.log"
    canvas_width = min(width, (video["width"] + 1) // 2 * 2)
    canvas_height = min(height, max((video["height"] + 1) // 2 * 2, int((canvas_width * 9 / 16 + 1) // 2) * 2))
    tone_map = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv," \
        if video.get("color_transfer") in {"smpte2084", "arib-std-b67"} else ""
    filters = f"scale=trunc(iw*sar/2)*2:ih,setsar=1,scale={canvas_width}:{canvas_height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos," + tone_map + f"pad={canvas_width}:{canvas_height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p"
    maximum = 2500000 if target == "mabel" else POLICY["maximumVideoBitrate"]
    common = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-y", "-threads", "2", "-filter_threads", "2", "-i", str(source),
              "-map", "0:v:0", "-vf", filters, "-c:v", "libx264", "-preset", POLICY["preset"], "-threads:v", "2",
              "-b:v", str(min(bitrate, maximum)), "-maxrate", str(maximum), "-bufsize", str(maximum * 2),
              "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p", "-fpsmax", "30",
              "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
              "-passlogfile", str(passlog), "-progress", "pipe:1", "-nostats"]
    marker = json.dumps({"mabeltv": {"version": POLICY["version"], "profile": selected, "sourceBytes": source_bytes, "duration": duration}})
    try:
        run_encoder(library, source, common + ["-pass", "1", "-an", "-f", "null", os.devnull], duration, log, callback, 1)
        run_encoder(library, source, common + ["-pass", "2", "-map", "0:a:0?", "-c:a", "aac", "-b:a", str(profile["audioBitrate"]),
                    "-ac", "2", "-map_metadata", "-1", "-map_chapters", "-1", "-metadata", "comment=" + marker,
                    "-movflags", "+faststart", str(output)], duration, log, callback, 2)
        now = source.stat()
        if (now.st_size, now.st_mtime_ns, now.st_ino) != (original.st_size, original.st_mtime_ns, original.st_ino):
            raise ValueError("The original changed during conversion. It was kept")
        validated = probe(output)
        stream = next(s for s in validated["streams"] if s.get("codec_type") == "video")
        if (stream.get("codec_name") != "h264" or stream.get("pix_fmt") != "yuv420p"
                or stream["width"] > width or stream["height"] > height
                or library.frame_rate(stream) > 30.1
                or abs(float(validated["format"]["duration"]) - duration) > 2
                or any(s.get("codec_name") != "aac" for s in validated["streams"] if s.get("codec_type") == "audio")
                or not proof_for(validated, output.stat().st_size, duration) or not fast_start(output)):
            raise ValueError("The compressed video failed validation. The original was kept")
        if output.stat().st_size >= original.st_size or output.stat().st_size > source_bytes * profile["sourceFraction"]:
            raise ValueError("The conversion did not meet the selected size target. The original was kept")
        os.replace(output, destination)
        return True
    finally:
        for item in (output, Path(str(passlog) + "-0.log"), Path(str(passlog) + "-0.log.mbtree"), log):
            item.unlink(missing_ok=True)
