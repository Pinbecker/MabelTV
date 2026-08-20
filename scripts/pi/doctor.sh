#!/usr/bin/env bash
# Friendly read-only health check for owners and first-line support.
set -Eeuo pipefail

failures=0
warnings=0

pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

printf 'Mabel TV system check\n'
printf '=====================\n'

model="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
if [[ "$model" == *"Raspberry Pi 4"* ]]; then
    pass "$model"
elif [[ -n "$model" ]]; then
    warn "$model has not been qualified for this Mabel TV release; a Pi 4 with at least 2 GB is required"
else
    fail 'Raspberry Pi model could not be detected'
fi

if [[ "$(uname -m)" == "aarch64" ]]; then
    pass '64-bit operating system'
else
    fail "64-bit Raspberry Pi OS is required (found $(uname -m))"
fi

if [[ -x /opt/mabeltv/current/mabeltv ]]; then
    version="$(/opt/mabeltv/current/mabeltv --version 2>/dev/null | tail -n1 || true)"
    pass "Mabel TV release installed${version:+: $version}"
else
    fail 'No active Mabel TV release was found'
fi

for service in mabeltv.service mabeltv-library.service; do
    if systemctl is-active --quiet "$service"; then
        pass "$service is running"
    else
        fail "$service is not running"
    fi
done

if systemctl is-active --quiet avahi-daemon.service; then
    pass 'mabeltv.local network discovery is running'
else
    warn 'Network discovery is not running; the dashboard may need the Pi IP address'
fi

if [[ -s /var/lib/mabeltv/owner.json ]]; then
    pass 'First-time setup has been completed'
elif [[ -r /etc/mabeltv/library.conf ]] && grep -q '^MABELTV_LIBRARY_PIN=' /etc/mabeltv/library.conf; then
    warn 'Legacy parent PIN is still in use; change it from the dashboard'
else
    warn 'First-time setup is waiting to be completed'
fi

free_kb="$(df -Pk /srv/mabeltv/media 2>/dev/null | awk 'NR==2 {print $4}')"
if [[ "$free_kb" =~ ^[0-9]+$ ]] && ((free_kb >= 4 * 1024 * 1024)); then
    pass "Media storage has $((free_kb / 1024 / 1024)) GB free"
elif [[ "$free_kb" =~ ^[0-9]+$ ]] && ((free_kb >= 2 * 1024 * 1024)); then
    warn "Media storage has only $((free_kb / 1024 / 1024)) GB free"
else
    fail 'Media storage has less than 2 GB free or could not be read'
fi

temperature_raw="$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || printf '0')"
if [[ "$temperature_raw" =~ ^[0-9]+$ ]] && ((temperature_raw > 0)); then
    temperature_c=$((temperature_raw / 1000))
    if ((temperature_c < 75)); then pass "Pi temperature is ${temperature_c}C"
    elif ((temperature_c < 80)); then warn "Pi temperature is high at ${temperature_c}C"
    else fail "Pi temperature is unsafe at ${temperature_c}C; improve airflow before playback"
    fi
else
    warn 'Pi temperature could not be read'
fi

if command -v vcgencmd >/dev/null 2>&1; then
    throttled="$(vcgencmd get_throttled 2>/dev/null || true)"
    if [[ "$throttled" == "throttled=0x0" ]]; then
        pass 'No heat or low-voltage limiting has been recorded since boot'
    else
        warn "Power or thermal limiting was recorded: ${throttled:-unknown}; check the official power supply and airflow"
    fi
fi

connected_outputs=0
for status in /sys/class/drm/card*-*/status; do
    [[ -r "$status" ]] || continue
    if [[ "$(<"$status")" == "connected" ]]; then connected_outputs=$((connected_outputs + 1)); fi
done
if ((connected_outputs > 0)); then pass 'A display is connected'
else warn 'No connected display was detected'
fi

if command -v aplay >/dev/null 2>&1 && aplay -l 2>/dev/null | grep -q '^card '; then
    pass 'An ALSA audio output is available'
else
    warn 'No ALSA audio output was detected'
fi

restarts="$(systemctl show mabeltv.service -p NRestarts --value 2>/dev/null || printf 'unknown')"
if [[ "$restarts" =~ ^[0-9]+$ ]] && ((restarts == 0)); then
    pass 'The player has not restarted during this boot'
elif [[ "$restarts" =~ ^[0-9]+$ ]]; then
    warn "The player has restarted $restarts time(s) during this boot; download a support bundle"
fi

printf '\nResult: %s failure(s), %s warning(s).\n' "$failures" "$warnings"
if ((failures > 0)); then
    printf 'Open http://mabeltv.local:8080 and download a support bundle, or run sudo mabeltv-diagnostics.\n'
    exit 1
fi
if ((warnings > 0)); then
    printf 'Mabel TV can run, but review the warnings above.\n'
else
    printf 'Mabel TV looks ready to use.\n'
fi
