#!/usr/bin/env bash
set -Eeuo pipefail

settings_path="${MABELTV_SETTINGS:-/var/lib/mabeltv/settings.json}"
runtime_dir="${RUNTIME_DIRECTORY:-/run/mabeltv}"
output_name="${MABELTV_DRM_OUTPUT:-HDMI1}"
install_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

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

case "$display_mode" in
    1080p) kms_mode="1920x1080@60" ;;
    native) kms_mode="preferred" ;;
    *) kms_mode="1280x720@60" ;;
esac

mkdir -p "$runtime_dir"
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
