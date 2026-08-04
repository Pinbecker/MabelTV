#!/usr/bin/env bash
set -Eeuo pipefail

display="720p"
ir_gpio="18"
force_video="false"

usage() {
    printf 'Usage: sudo bash configure-boot.sh [--display 720p|1080p|native] [--ir-gpio N] [--force-video]\n'
}

while (($#)); do
    case "$1" in
        --display)
            display="${2:-}"
            shift 2
            ;;
        --ir-gpio)
            ir_gpio="${2:-}"
            shift 2
            ;;
        --force-video)
            force_video="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo.\n' >&2
    exit 1
fi
if [[ "$display" != "720p" && "$display" != "1080p" && "$display" != "native" ]]; then
    printf 'Display must be 720p, 1080p, or native.\n' >&2
    exit 2
fi
if [[ ! "$ir_gpio" =~ ^[0-9]+$ ]] || ((ir_gpio < 0 || ir_gpio > 27)); then
    printf 'IR GPIO must be a BCM pin number from 0 to 27.\n' >&2
    exit 2
fi

boot_root=/boot/firmware
[[ -f "$boot_root/config.txt" ]] || boot_root=/boot
config_path="$boot_root/config.txt"
cmdline_path="$boot_root/cmdline.txt"
if [[ ! -f "$config_path" || ! -f "$cmdline_path" ]]; then
    printf 'Could not locate Raspberry Pi config.txt and cmdline.txt.\n' >&2
    exit 1
fi

stamp="$(date +%Y%m%d-%H%M%S)"
cp --preserve=all "$config_path" "$config_path.mabeltv-$stamp.bak"
cp --preserve=all "$cmdline_path" "$cmdline_path.mabeltv-$stamp.bak"

begin_marker='# BEGIN MABELTV MANAGED SETTINGS'
end_marker='# END MABELTV MANAGED SETTINGS'
temporary_config="$(mktemp)"
trap 'rm -f "$temporary_config"' EXIT
config_mode="$(stat -c '%a' "$config_path")"
awk -v begin="$begin_marker" -v end="$end_marker" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
' "$config_path" > "$temporary_config"
{
    printf '\n%s\n' "$begin_marker"
    printf 'dtoverlay=gpio-ir,gpio_pin=%s\n' "$ir_gpio"
    printf 'hdmi_ignore_cec_init=1\n'
    printf 'hdmi_ignore_cec=1\n'
    printf 'disable_splash=1\n'
    printf '%s\n' "$end_marker"
} >> "$temporary_config"
install -m "$config_mode" "$temporary_config" "$config_path"

read -r -a cmdline_tokens < "$cmdline_path"
new_tokens=()
existing_video=""
for token in "${cmdline_tokens[@]}"; do
    case "$token" in
        video=HDMI-A-1:*) existing_video="$token" ;;
        quiet|loglevel=3|logo.nologo|vt.global_cursor_default=0|consoleblank=0) ;;
        *) new_tokens+=("$token") ;;
    esac
done
if [[ -n "$existing_video" && "$force_video" != "true" ]]; then
    printf 'Existing %s was preserved. Use --force-video to replace it.\n' "$existing_video"
    new_tokens+=("$existing_video")
elif [[ "$display" == "720p" ]]; then
    new_tokens+=("video=HDMI-A-1:1280x720M@60D")
elif [[ "$display" == "1080p" ]]; then
    new_tokens+=("video=HDMI-A-1:1920x1080M@60D")
fi
new_tokens+=(quiet loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0)
printf '%s\n' "${new_tokens[*]}" > "$cmdline_path"

printf 'Configured GPIO %s IR input, disabled HDMI-CEC, and selected %s output.\n' "$ir_gpio" "$display"
printf 'Backups: %s and %s\n' "$config_path.mabeltv-$stamp.bak" "$cmdline_path.mabeltv-$stamp.bak"
printf 'Reboot is required.\n'
