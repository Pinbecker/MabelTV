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
        export MABELTV_HWDEC="v4l2m2m-copy"
    else
        export MABELTV_HWDEC="auto-safe"
    fi
fi

# Prepared video is capped at 720p when needed, but HDMI output is separate.
# Use the screen's preferred EDID mode so the interface stays crisp while the
# television and Qt/KMS scale 720p programmes normally.
kms_mode="preferred"

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
        "outputs": [{"name": sys.argv[2], "mode": sys.argv[3], "primary": True}],
    }, output_file)
PY

exec "$install_root/mabeltv" \
    --fullscreen \
    --channels /var/lib/mabeltv/channels.json \
    --settings "$settings_path" \
    --media-root /srv/mabeltv/media \
    --state /var/lib/mabeltv/state.json \
    --log-dir /var/log/mabeltv
