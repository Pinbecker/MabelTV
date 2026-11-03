"""Immutable size-target profiles shared by Studio, previews and Pi preparation."""
import json
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("compression-profiles.json").read_text())


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
