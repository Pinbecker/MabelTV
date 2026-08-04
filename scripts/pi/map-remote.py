#!/usr/bin/env python3
"""Interactively turn a physical IR remote into a Linux rc-core keymap."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time


BUTTONS = [
    ("POWER", "KEY_P", True),
    # Keep the television controls distinct from the navigation pad. Page
    # Up/Down and Equal/Minus are ordinary keys that Qt's direct Linux input
    # backend handles reliably without a desktop session.
    ("CHANNEL UP", "KEY_PAGEUP", True),
    ("CHANNEL DOWN", "KEY_PAGEDOWN", True),
    ("VOLUME UP", "KEY_EQUAL", True),
    ("VOLUME DOWN", "KEY_MINUS", True),
    ("MUTE", "KEY_M", True),
    ("PREVIOUS / BACK", "KEY_B", True),
    ("OK / ENTER", "KEY_ENTER", True),
    ("NAVIGATION UP (optional)", "KEY_UP", False),
    ("NAVIGATION DOWN (optional)", "KEY_DOWN", False),
    ("NAVIGATION LEFT (optional)", "KEY_LEFT", False),
    ("NAVIGATION RIGHT (optional)", "KEY_RIGHT", False),
    ("RANDOM / SOURCE (optional)", "KEY_R", False),
    *[(str(number), f"KEY_{number}", False) for number in range(10)],
]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Map the Mabel TV infrared remote")
    parser.add_argument(
        "--device",
        help="rc-core device (default: automatically find gpio_ir_recv)",
    )
    parser.add_argument("--protocol", default="nec", help="decoded protocol (default: nec)")
    parser.add_argument(
        "--output", default="/etc/rc_keymaps/mabeltv.toml", help="keymap output file"
    )
    parser.add_argument("--timeout", type=float, default=20.0, help="seconds allowed per button")
    return parser.parse_args()


def find_gpio_ir_device() -> str | None:
    """Return the rc-core device backed by the KY-022 GPIO receiver."""
    result = subprocess.run(
        ["ir-keytable"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    current: str | None = None
    found_pattern = re.compile(r"^Found /sys/class/rc/(rc\d+)/ with:")
    gpio_pattern = re.compile(r"^\s*(?:Name|Driver):\s+gpio_ir_recv\s*$")
    for line in result.stdout.splitlines():
        found = found_pattern.match(line)
        if found:
            current = found.group(1)
        elif current is not None and gpio_pattern.match(line):
            return current
    return None


def capture_scancode(process: subprocess.Popen[str], selector: selectors.BaseSelector, timeout: float) -> str | None:
    deadline = time.monotonic() + timeout
    pattern = re.compile(r"scancode\s*(?:=)?\s*(0x[0-9a-fA-F]+)")
    while time.monotonic() < deadline:
        ready = selector.select(timeout=min(0.5, deadline - time.monotonic()))
        for key, _ in ready:
            line = key.fileobj.readline()
            if not line:
                raise RuntimeError("ir-keytable stopped while waiting for a button")
            match = pattern.search(line)
            if match:
                return match.group(1).lower()
    return None


def drain(selector: selectors.BaseSelector) -> None:
    deadline = time.monotonic() + 0.35
    while time.monotonic() < deadline:
        ready = selector.select(timeout=0.05)
        if not ready:
            continue
        for key, _ in ready:
            key.fileobj.readline()


def main() -> int:
    arguments = parse_arguments()
    if os.geteuid() != 0:
        print("Run this utility with sudo.", file=sys.stderr)
        return 1
    if arguments.device is None:
        arguments.device = find_gpio_ir_device()
    if arguments.device is None:
        print(
            "Could not find the KY-022 gpio_ir_recv device. Check its wiring "
            "and the gpio-ir boot overlay.",
            file=sys.stderr,
        )
        return 1
    if not Path(f"/sys/class/rc/{arguments.device}").exists():
        print(
            f"{arguments.device} is not available. Check KY-022 wiring and "
            "reboot after configure-boot.sh.",
            file=sys.stderr,
        )
        return 1

    subprocess.run(
        ["ir-keytable", "-s", arguments.device, "-c", "-p", "all"], check=True
    )
    process = subprocess.Popen(
        ["stdbuf", "-oL", "-eL", "ir-keytable", "-s", arguments.device, "-t"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    mappings: dict[str, str] = {}

    print("\nPoint the remote at the KY-022. Press each requested button once.")
    print("Type S then Enter before a prompt to skip an optional button, or Q to abort.\n")
    try:
        for label, keycode, required in BUTTONS:
            while True:
                response = input(f"{label}: press Enter when ready" + ("" if required else " [S to skip]") + " > ")
                if response.strip().lower() == "q":
                    return 2
                if response.strip().lower() == "s" and not required:
                    break
                # Discard the release/repeat tail of the previously learned
                # button before inviting the next press.
                drain(selector)
                print("  Listening…")
                scancode = capture_scancode(process, selector, arguments.timeout)
                if scancode is None:
                    print("  No code received. Check aim/wiring and try again.")
                    continue
                if scancode in mappings:
                    print(f"  {scancode} is already assigned to {mappings[scancode]}; try another button.")
                    drain(selector)
                    continue
                mappings[scancode] = keycode
                print(f"  {scancode} -> {keycode}")
                drain(selector)
                break
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()

    output = Path(arguments.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".new")
    with temporary.open("w", encoding="utf-8", newline="\n") as keymap:
        keymap.write('[[protocols]]\nname = "EZClicker B0FBS3KMKD for Mabel TV"\n')
        keymap.write(f'protocol = "{arguments.protocol}"\n[protocols.scancodes]\n')
        for scancode, keycode in mappings.items():
            keymap.write(f'{scancode} = "{keycode}"\n')
    temporary.chmod(0o644)
    temporary.replace(output)

    subprocess.run(
        ["ir-keytable", "-s", arguments.device, "-c", "-w", str(output)], check=True
    )
    subprocess.run(["systemctl", "enable", "mabeltv-ir.service"], check=True)
    print(f"\nSaved and loaded {len(mappings)} buttons in {output}.")
    print(
        f"Use 'sudo ir-keytable -s {arguments.device} -t' if any button needs "
        "further diagnosis."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
