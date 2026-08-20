#!/usr/bin/env bash
# Fast, read-only checks before package installation or compilation begins.
set -Eeuo pipefail

if [[ "$(uname -m)" != "aarch64" ]]; then
    printf 'Mabel TV needs 64-bit Raspberry Pi OS; this system reports %s.\n' "$(uname -m)" >&2
    exit 1
fi
if [[ ! -r /proc/device-tree/model ]]; then
    printf 'A Raspberry Pi could not be detected.\n' >&2
    exit 1
fi
model="$(tr -d '\0' < /proc/device-tree/model)"
case "$model" in
    *"Raspberry Pi 4"*) ;;
    *) printf 'This release of Mabel TV is qualified for Raspberry Pi 4 only. Found: %s\n' "$model" >&2; exit 1 ;;
esac

memory_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
if [[ ! "$memory_kb" =~ ^[0-9]+$ ]] || ((memory_kb < 1500 * 1024)); then
    printf 'Mabel TV needs a Raspberry Pi with at least 2 GB RAM.\n' >&2
    exit 1
fi

root_free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
if [[ ! "$root_free_kb" =~ ^[0-9]+$ ]] || ((root_free_kb < 4 * 1024 * 1024)); then
    printf 'At least 4 GB of free system storage is needed to install safely.\n' >&2
    exit 1
fi

if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    case "${ID:-}:${VERSION_ID:-}" in
        debian:12|debian:13|raspbian:12|raspbian:13) ;;
        *) printf 'Warning: %s %s has not been qualified. Raspberry Pi OS 64-bit based on Debian 12 or 13 is recommended.\n' "${PRETTY_NAME:-Linux}" "${VERSION_ID:-}" >&2 ;;
    esac
fi

if command -v vcgencmd >/dev/null 2>&1; then
    throttled="$(vcgencmd get_throttled 2>/dev/null || true)"
    if [[ -n "$throttled" && "$throttled" != "throttled=0x0" ]]; then
        printf 'Warning: the Pi has recorded a power or heat warning (%s). Check cooling and use an official-quality power supply.\n' "$throttled" >&2
    fi
fi

printf 'Preflight passed: %s, %s MB RAM, %s GB free.\n' \
    "$model" "$((memory_kb / 1024))" "$((root_free_kb / 1024 / 1024))"
