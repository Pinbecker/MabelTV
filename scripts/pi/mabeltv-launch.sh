#!/usr/bin/env bash
set -Eeuo pipefail

settings_path="${MABELTV_SETTINGS:-/var/lib/mabeltv/settings.json}"
runtime_dir="${RUNTIME_DIRECTORY:-/run/mabeltv}"
output_name="${MABELTV_DRM_OUTPUT:-}"
install_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Use an explicit override when supplied, otherwise choose the first connected
# HDMI socket. Qt EGLFS calls the Pi connectors HDMI1 and HDMI2 even though
# sysfs exposes them as HDMI-A-1 and HDMI-A-2.
if [[ -z "$output_name" ]]; then
    output_name="HDMI1"
    for connector in /sys/class/drm/card*-HDMI-A-*/status; do
        [[ -r "$connector" ]] || continue
        [[ "$(<"$connector")" == "connected" ]] || continue
        case "$connector" in
            *-HDMI-A-2/status) output_name="HDMI2" ;;
            *) output_name="HDMI1" ;;
        esac
        break
    done
fi

if [[ -z "${MABELTV_AUDIO_DEVICE:-}" ]]; then
    audio_card="vc4hdmi0"
    [[ "$output_name" == "HDMI2" ]] && audio_card="vc4hdmi1"
    if grep -q "$audio_card" /proc/asound/cards 2>/dev/null; then
        export MABELTV_AUDIO_DEVICE="alsa/hdmi:CARD=$audio_card,DEV=0"
    fi
fi

if [[ -z "${MABELTV_HWDEC:-}" ]]; then
    model="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
    if [[ "$model" == *"Raspberry Pi 4"* ]]; then
        # bcm2835-codec can acknowledge stream-off before its MMAL buffers are
        # actually returned. Rapid programme and Adult Mode hand-offs then
        # wedge the kernel with sync timeouts until the whole Pi is rebooted.
        # Decode H.264 in software (well within Pi 4 headroom) and retain the
        # separate, reliable DRM Prime hardware path for HD/Main 10 HEVC films.
        export MABELTV_HWDEC="drm-copy"
    else
        export MABELTV_HWDEC="auto-safe"
    fi
fi

display_mode="$(python3 - "$settings_path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as settings_file:
        value = json.load(settings_file).get("display_resolution", "720p")
except (OSError, ValueError, TypeError):
    value = "720p"
print(value if value in {"720p", "1080p", "native"} else "720p")
PY
)"

# Restore the settings-aware display selection used by the proven Pi build.
# Include refresh rates for fixed modes: resolution-only requests let Qt pick
# the highest EDID match and can silently select 1080p120 on capable TVs.
case "$display_mode" in
    # MabelTV media is deliberately prepared at 25/30 fps.  A 30 Hz 1080p
    # canvas keeps the Adult Library natively sharp without spending a full
    # extra display cycle on frames the player does not have.
    1080p) kms_mode="1920x1080@30" ;;
    native) kms_mode="preferred" ;;
    *) kms_mode="1280x720@60" ;;
esac
kms_mode="${MABELTV_DRM_MODE:-$kms_mode}"

mkdir -p "$runtime_dir"
if command -v qrencode >/dev/null 2>&1; then
    qrencode -o "$runtime_dir/setup-qr.png.new" -s 6 -m 2 \
        "http://$(hostname).local:8080" 2>/dev/null \
        && mv -f -- "$runtime_dir/setup-qr.png.new" "$runtime_dir/setup-qr.png" \
        || rm -f -- "$runtime_dir/setup-qr.png.new"
fi
python3 - "$runtime_dir/kms.json" "$output_name" "$kms_mode" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as output_file:
    json.dump({
        "hwcursor": False,
        "pbuffers": True,
        "outputs": [{
            "name": sys.argv[2],
            "mode": sys.argv[3],
            "format": "xrgb8888",
            "primary": True,
        }],
    }, output_file)
PY

exec "$install_root/mabeltv" \
    --fullscreen \
    --channels /var/lib/mabeltv/channels.json \
    --settings "$settings_path" \
    --media-root /srv/mabeltv/media \
    --state /var/lib/mabeltv/state.json \
    --log-dir /var/log/mabeltv
