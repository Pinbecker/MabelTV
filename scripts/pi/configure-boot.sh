#!/usr/bin/env bash
set -Eeuo pipefail

display="720p"
ir_gpio="18"
force_video="false"
ir_mode="preserve"
remove_forced_video="false"

usage() {
    printf 'Usage: sudo bash configure-boot.sh [--display 720p|1080p|native] [--enable-ir|--disable-ir] [--ir-gpio N] [--force-video] [--remove-forced-video]\n'
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
        --enable-ir)
            ir_mode="enable"
            shift
            ;;
        --disable-ir)
            ir_mode="disable"
            shift
            ;;
        --force-video)
            force_video="true"
            shift
            ;;
        --remove-forced-video)
            remove_forced_video="true"
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
if [[ "$ir_mode" == "enable" ]] \
    && { [[ ! "$ir_gpio" =~ ^[0-9]+$ ]] || ((ir_gpio < 0 || ir_gpio > 27)); }; then
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
boot_state=/var/lib/mabeltv/install/boot-original
install -d -o root -g root -m 0700 "$boot_state"
if [[ ! -f "$boot_state/config.txt" ]]; then
    cp --preserve=all "$config_path" "$boot_state/config.txt"
fi
if [[ ! -f "$boot_state/cmdline.txt" ]]; then
    cp --preserve=all "$cmdline_path" "$boot_state/cmdline.txt"
fi
cp --preserve=all "$config_path" "$config_path.mabeltv-$stamp.bak"
cp --preserve=all "$cmdline_path" "$cmdline_path.mabeltv-$stamp.bak"

begin_marker='# BEGIN MABELTV MANAGED SETTINGS'
end_marker='# END MABELTV MANAGED SETTINGS'
existing_ir_line="$(grep -m1 -E '^dtoverlay=gpio-ir(,gpio_pin=[0-9]+)?$' "$config_path" || true)"
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
    ir_line=""
    if [[ "$ir_mode" == "enable" ]]; then
        ir_line="dtoverlay=gpio-ir,gpio_pin=$ir_gpio"
    elif [[ "$ir_mode" == "preserve" ]]; then
        ir_line="$existing_ir_line"
    fi
    if [[ -n "$ir_line" ]] \
        && ! grep -q -E '^dtoverlay=gpio-ir(,gpio_pin=[0-9]+)?$' "$temporary_config"; then
        printf '%s\n' "$ir_line"
    fi
    printf 'hdmi_ignore_cec_init=1\n'
    printf 'hdmi_ignore_cec=1\n'
    # Some 4K TVs advertise a 4K60 preferred mode.  Raise the Pi 4 HDMI core
    # clock so the KMS hand-off from the firmware splash remains valid.
    printf 'hdmi_enable_4kp60=1\n'
    printf 'disable_splash=1\n'
    printf '%s\n' "$end_marker"
} >> "$temporary_config"
install -m "$config_mode" "$temporary_config" "$config_path"

# Raspberry Pi's cmdline.txt commonly has no trailing newline.  Bash still
# supplies the final line, but read returns non-zero at EOF; do not mistake
# that normal file format for a failed boot configuration.
read -r -a cmdline_tokens < "$cmdline_path" || true
new_tokens=()
existing_video=""
for token in "${cmdline_tokens[@]}"; do
    case "$token" in
        video=HDMI-A-1:*|video=HDMI-A-2:*) existing_video="$token" ;;
        quiet|loglevel=3|logo.nologo|vt.global_cursor_default=0|consoleblank=0) ;;
        *) new_tokens+=("$token") ;;
    esac
done
if [[ -n "$existing_video" && "$force_video" != "true" \
    && "$remove_forced_video" != "true" ]]; then
    printf 'Existing %s was preserved. Use --force-video to replace it.\n' "$existing_video"
    new_tokens+=("$existing_video")
elif [[ "$display" == "720p" ]]; then
    new_tokens+=("video=HDMI-A-1:1280x720M@60D")
elif [[ "$display" == "1080p" ]]; then
    new_tokens+=("video=HDMI-A-1:1920x1080M@60D")
fi
new_tokens+=(quiet loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0)
printf '%s\n' "${new_tokens[*]}" > "$cmdline_path"
sha256sum "$cmdline_path" | awk '{print $1}' > "$boot_state/managed-cmdline.sha256"

# Record only the exact boot arguments Mabel TV introduced relative to the
# owner's original command line. Uninstall can then remove those arguments
# without replacing the whole line or discarding edits made after setup.
read -r -a original_tokens < "$boot_state/cmdline.txt" || true
declare -A original_token_set=()
for token in "${original_tokens[@]}"; do original_token_set["$token"]=1; done
managed_tokens_file="$boot_state/managed-cmdline.tokens"
temporary_tokens="$(mktemp)"
for token in "${new_tokens[@]}"; do
    case "$token" in
        quiet|loglevel=3|logo.nologo|vt.global_cursor_default=0|consoleblank=0|video=HDMI-A-1:*|video=HDMI-A-2:*)
            if [[ -z "${original_token_set[$token]+present}" ]]; then
                printf '%s\n' "$token" >> "$temporary_tokens"
            fi
            ;;
    esac
done
install -o root -g root -m 0600 "$temporary_tokens" "$managed_tokens_file"
rm -f -- "$temporary_tokens"

if grep -q -E '^dtoverlay=gpio-ir(,gpio_pin=[0-9]+)?$' "$config_path"; then
    printf 'Configured GPIO IR input, disabled HDMI-CEC, and selected %s output.\n' "$display"
else
    printf 'Configured appliance display settings without an IR receiver, disabled HDMI-CEC, and selected %s output.\n' "$display"
fi
printf 'Backups: %s and %s\n' "$config_path.mabeltv-$stamp.bak" "$cmdline_path.mabeltv-$stamp.bak"
printf 'Reboot is required.\n'
