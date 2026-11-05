"""Immutable size-target profiles shared by Studio, previews and Pi preparation."""
import json
import math
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("compression-profiles.json").read_text())


def output_frame_rate(facts):
    fps = facts.get("fps") or 24
    if not isinstance(fps, (int, float)):
        raise ValueError("The source frame rate could not be read. The original was kept.")
    fps *= 2 if facts.get("interlaced") else 1
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0 or fps > POLICY["maximumFrameRate"] + .001:
        raise ValueError("The source frame rate is outside the supported range. The original was kept.")
    return fps


def compression_profile(value=None):
    value = POLICY["default"] if value is None else value
    for profile in POLICY["profiles"]:
        if value == profile["id"]:
            return profile
    raise ValueError("Choose Balanced, Compact or Smallest")


def compression_target(size, value=None):
    return int(size * compression_profile(value)["sourceFraction"] * POLICY["muxMargin"])


def compression_choices():
    return [{**profile, "targetFraction": profile["sourceFraction"] * POLICY["muxMargin"]}
            for profile in POLICY["profiles"]]


def compression_estimate(size, profile_id=None, facts=None, source_bytes=None, prepared=False, target="mytv", prepared_profile=None):
    """Metadata-only equivalent of Windows policy; never probe or download here."""
    profile = compression_profile(profile_id)
    facts = facts or {}
    basis = source_bytes or size
    duration, width, height = facts.get("duration", 0), facts.get("width", 0), facts.get("height", 0)
    estimate, risky = compression_target(basis, profile_id), False
    if all(isinstance(value, (float, int)) and value > 0 for value in (duration, width, height)):
        width *= facts.get("sar") or 1
        ratio = min(1, (1280 if target == "mabel" else 1920) / width, (720 if target == "mabel" else 1080) / height)
        pixels = int(width * ratio / 2) * 2 * int(height * ratio / 2) * 2 * output_frame_rate(facts)
        audio = profile["audioBitrate"] if facts.get("hasAudio", True) else 0
        video = max(basis * profile["sourceFraction"] * POLICY["muxMargin"] * 8 / duration - audio,
                    POLICY["minimumVideoBitrate"], pixels * profile["minimumBitsPerPixel"])
        video = min(video, 2500000 if target == "mabel" else POLICY["maximumVideoBitrate"])
        estimate = int((video + audio) * duration / 8)
        risky = not prepared and (size * 8 / duration - audio) / pixels < POLICY["riskBitsPerPixel"] if pixels else False
    prior = compression_profile(prepared_profile) if prepared_profile else None
    keep = bool(prepared and (prior and prior["sourceFraction"] <= profile["sourceFraction"] or size <= basis * profile["sourceFraction"])
                or estimate >= size * .95)
    return {"estimatedBytes": size if keep else estimate, "alreadyMeetsTarget": keep, "risky": risky,
            "recommended": "balanced" if risky else POLICY["default"],
            "warning": "This copy is already heavily compressed. Further compression may reduce picture quality." if risky else ""}
