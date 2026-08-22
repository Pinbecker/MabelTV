#!/usr/bin/env bash
set -Eeuo pipefail

enable_service="false"
configure_boot="false"
skip_packages="false"
enable_ir="false"
product_install="false"
prebuilt_dir=""
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
    printf 'Usage: sudo bash scripts/pi/install.sh [--product-install] [--prebuilt DIR] [--enable-service] [--configure-boot] [--enable-ir] [--skip-packages]\n'
}

while (($#)); do
    case "$1" in
        --product-install) product_install="true"; enable_service="true"; configure_boot="true"; shift ;;
        --enable-service) enable_service="true"; shift ;;
        --configure-boot) configure_boot="true"; shift ;;
        --enable-ir) enable_ir="true"; shift ;;
        --prebuilt) prebuilt_dir="$(readlink -f "${2:-}")"; shift 2 ;;
        --skip-packages) skip_packages="true"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    printf 'Run this installer with sudo.\n' >&2
    exit 1
fi
bash "$source_root/scripts/pi/preflight.sh"
player_was_active="false"
if systemctl is-active --quiet mabeltv.service 2>/dev/null; then
    player_was_active="true"
fi
player_was_enabled="false"
if systemctl is-enabled --quiet mabeltv.service 2>/dev/null; then
    player_was_enabled="true"
fi
library_was_active="false"
if systemctl is-active --quiet mabeltv-library.service 2>/dev/null; then
    library_was_active="true"
fi
library_was_enabled="false"
if systemctl is-enabled --quiet mabeltv-library.service 2>/dev/null; then
    library_was_enabled="true"
fi
transaction_units=(
    mabeltv.service mabeltv-library.service mabeltv-ir.service
    mabeltv-health.timer mabeltv-boot-audit.service
    mabeltv-retention.timer mabeltv-owner-recovery.service
    avahi-daemon.service
)
declare -A unit_was_enabled=()
declare -A unit_was_active=()
for unit in "${transaction_units[@]}"; do
    unit_was_enabled["$unit"]="false"
    unit_was_active["$unit"]="false"
    systemctl is-enabled --quiet "$unit" 2>/dev/null \
        && unit_was_enabled["$unit"]="true"
    systemctl is-active --quiet "$unit" 2>/dev/null \
        && unit_was_active["$unit"]="true"
done

if [[ "$skip_packages" != "true" ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        qt6-qpa-plugins qml6-module-qtquick qml6-module-qtquick-window \
        libqt6opengl6 libmpv-dev ffmpeg ir-keytable python3 sudo logrotate avahi-daemon \
        alsa-utils ca-certificates curl util-linux qrencode
    if [[ -z "$prebuilt_dir" ]]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
            build-essential cmake ninja-build pkg-config \
            qt6-base-dev qt6-declarative-dev qt6-shadertools-dev \
            libqt6opengl6-dev libegl1-mesa-dev libgl1-mesa-dev libdrm-dev \
            libsystemd-dev
    fi
fi

if [[ -n "$prebuilt_dir" ]] \
    && { [[ ! -x "$prebuilt_dir/mabeltv" ]] \
         || [[ ! -x "$prebuilt_dir/mabeltv_media_check" ]]; }; then
    printf 'The prebuilt release directory is incomplete: %s\n' "$prebuilt_dir" >&2
    exit 1
fi
if [[ -n "$prebuilt_dir" && "$product_install" == "true" \
      && ! -r "$prebuilt_dir/BUILD-MANIFEST.json" ]]; then
    printf 'A product install requires a traceable BUILD-MANIFEST.json.\n' >&2
    exit 1
fi
if [[ -r "$prebuilt_dir/BUILD-MANIFEST.json" ]]; then
    python3 - "$prebuilt_dir" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / "BUILD-MANIFEST.json").read_text(encoding="utf-8"))
os_release = {}
for line in pathlib.Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
    key, separator, value = line.partition("=")
    if separator:
        os_release[key] = value.strip().strip('"')
build_os = manifest.get("build_os", {})
if (build_os.get("id"), build_os.get("version_id")) != (
        os_release.get("ID"), os_release.get("VERSION_ID")):
    raise SystemExit(
        "This release was built for a different Raspberry Pi OS version")
for name in ("mabeltv", "mabeltv_media_check"):
    expected = manifest.get("files", {}).get(name, {}).get("sha256", "")
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    if not expected or actual != expected:
        raise SystemExit(f"Release integrity check failed for {name}")
PY
fi

if ! id mabeltv >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/mabeltv --create-home --shell /usr/sbin/nologin mabeltv
fi
for group_name in audio video render input gpio; do
    if getent group "$group_name" >/dev/null; then
        usermod -a -G "$group_name" mabeltv
    fi
done

install -d -o root -g root -m 0755 /opt/mabeltv/releases /usr/local/libexec
install -d -o mabeltv -g mabeltv -m 0750 \
    /var/lib/mabeltv /var/cache/mabeltv /var/log/mabeltv /srv/mabeltv/media
install -d -o root -g root -m 0755 /etc/rc_keymaps /usr/share/doc/mabeltv
install -d -o root -g mabeltv -m 0750 /etc/mabeltv

# Keep an operator-restorable snapshot of the mutable appliance state before
# this installer changes services or configuration.  Media files are never
# copied here: releases are atomic and the media library has its own recycle
# bin, so an update must not consume the SD card duplicating films.
backup_dir=/var/backups/mabeltv
install -d -o root -g root -m 0700 "$backup_dir"
preinstall_backup="$backup_dir/preinstall-$(date +%Y%m%d-%H%M%S).tar.gz"
backup_paths=(var/lib/mabeltv etc/systemd/system/mabeltv.service etc/systemd/system/mabeltv-ir.service)
[[ -f /etc/systemd/system/mabeltv-library.service ]] && backup_paths+=(etc/systemd/system/mabeltv-library.service)
[[ -f /etc/systemd/system/mabeltv-health.service ]] && backup_paths+=(etc/systemd/system/mabeltv-health.service)
[[ -f /etc/systemd/system/mabeltv-health.timer ]] && backup_paths+=(etc/systemd/system/mabeltv-health.timer)
[[ -f /etc/systemd/system/mabeltv-boot-audit.service ]] && backup_paths+=(etc/systemd/system/mabeltv-boot-audit.service)
[[ -f /etc/mabeltv/library.conf ]] && backup_paths+=(etc/mabeltv/library.conf)
[[ -f /etc/sudoers.d/mabeltv ]] && backup_paths+=(etc/sudoers.d/mabeltv)
tar -C / -czf "$preinstall_backup" --ignore-failed-read "${backup_paths[@]}"
chmod 0600 "$preinstall_backup"

build_dir=""
incoming_dir=""
verify_dir=""
asset_snapshot=""
cleanup() {
    if [[ -n "$build_dir" && -d "$build_dir" ]]; then
        rm -rf -- "$build_dir"
    fi
    if [[ -n "$incoming_dir" && -d "$incoming_dir" ]]; then
        rm -rf -- "$incoming_dir"
    fi
    if [[ -n "$verify_dir" && -d "$verify_dir" ]]; then
        rm -rf -- "$verify_dir"
    fi
    if [[ -n "$asset_snapshot" && -d "$asset_snapshot" ]]; then
        rm -rf -- "$asset_snapshot"
    fi
}
trap cleanup EXIT

version="$(sed -nE 's/^[[:space:]]*VERSION[[:space:]]+([0-9.]+).*/\1/p' "$source_root/CMakeLists.txt" | head -n1)"
[[ -n "$version" ]] || version=development
if [[ -z "$prebuilt_dir" ]]; then
    build_dir="$(mktemp -d /tmp/mabeltv-build.XXXXXX)"
    cmake -S "$source_root" -B "$build_dir" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DMABELTV_PI_APPLIANCE=ON
    build_jobs="${MABELTV_BUILD_JOBS:-2}"
    cmake --build "$build_dir" --parallel "$build_jobs"
    ctest --test-dir "$build_dir" --output-on-failure
    binary_root="$build_dir"
else
    binary_root="$prebuilt_dir"
    "$binary_root/mabeltv" --self-test
    if [[ -r "$binary_root/VERSION" ]]; then
        bundle_version="$(tr -d '\r\n' < "$binary_root/VERSION")"
        if [[ "$bundle_version" != "$version" ]]; then
            printf 'Bundle version %s does not match installer version %s.\n' \
                "$bundle_version" "$version" >&2
            exit 1
        fi
    fi
fi

release_id="$version-$(date +%Y%m%d%H%M%S)"
incoming_dir="/opt/mabeltv/releases/.incoming-$release_id-$$"
release_dir="/opt/mabeltv/releases/$release_id"
previous_release="$(readlink -f /opt/mabeltv/current 2>/dev/null || true)"
prior_previous_link="$(readlink /opt/mabeltv/previous 2>/dev/null || true)"
install -d -o root -g root -m 0755 "$incoming_dir"
install -o root -g root -m 0755 "$binary_root/mabeltv" "$incoming_dir/mabeltv"
install -o root -g root -m 0755 "$binary_root/mabeltv_media_check" "$incoming_dir/mabeltv_media_check"
install -o root -g root -m 0755 "$source_root/scripts/pi/mabeltv-launch.sh" "$incoming_dir/mabeltv-launch"
install -o root -g root -m 0755 "$source_root/scripts/pi/mabeltv-library.py" "$incoming_dir/mabeltv-library"
install -o root -g root -m 0644 "$source_root/scripts/pi/mabeltv-library.html" "$incoming_dir/mabeltv-library.html"
install -o root -g root -m 0644 "$source_root/scripts/pi/mabeltv-icon.png" "$incoming_dir/mabeltv-icon.png"
install -o root -g root -m 0644 "$source_root/scripts/pi/apple-touch-icon-180x180.png" "$incoming_dir/apple-touch-icon-180x180.png"
install -d -o root -g root -m 0755 "$incoming_dir/appliance"
cp -a "$source_root/packaging" "$source_root/scripts" "$source_root/config" \
    "$source_root/docs" "$incoming_dir/appliance/"
install -o root -g root -m 0644 "$source_root/README.md" "$source_root/LICENSE" \
    "$incoming_dir/appliance/"
rm -f -- "$incoming_dir/appliance/scripts/pi/replace-waffle-dog-fps30.sh"
printf '%s\n' "$version" > "$incoming_dir/VERSION"
chmod 0644 "$incoming_dir/VERSION"
if [[ -r "$binary_root/BUILD-MANIFEST.json" ]]; then
    install -o root -g root -m 0644 "$binary_root/BUILD-MANIFEST.json" \
        "$incoming_dir/BUILD-MANIFEST.json"
fi
python3 - "$incoming_dir/mabeltv-library" <<'PY'
import ast
import pathlib
import sys
ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), filename=sys.argv[1])
PY
mv "$incoming_dir" "$release_dir"
incoming_dir=""

if [[ ! -e /var/lib/mabeltv/channels.json ]]; then
    install -o mabeltv -g mabeltv -m 0640 "$source_root/config/examples/channels.json" /var/lib/mabeltv/channels.json
fi
if [[ ! -e /var/lib/mabeltv/settings.json ]]; then
    install -o mabeltv -g mabeltv -m 0640 "$source_root/config/examples/settings.json" /var/lib/mabeltv/settings.json
fi
# Repair mutable configuration ownership on every update. This also recovers
# files that were copied or edited through a root maintenance session.
chown mabeltv:mabeltv /var/lib/mabeltv/channels.json /var/lib/mabeltv/settings.json
chmod 0640 /var/lib/mabeltv/channels.json /var/lib/mabeltv/settings.json

if [[ ! -e /etc/mabeltv/library.conf ]]; then
    setup_code_number="$(( $(od -An -N4 -tu4 /dev/urandom) % 1000000 ))"
    printf 'MABELTV_SETUP_CODE=%06d\n' "$setup_code_number" > /etc/mabeltv/library.conf
fi
chown root:mabeltv /etc/mabeltv/library.conf
chmod 0640 /etc/mabeltv/library.conf

# Capture every live unit/helper immediately before activation. This snapshot
# is intentionally separate from the owner-data backup: it lets a failed
# service check restore an older pre-product installation exactly, even when
# that old release did not yet version its appliance assets.
asset_snapshot="$(mktemp -d /tmp/mabeltv-assets-before.XXXXXX)"
bash "$release_dir/appliance/scripts/pi/activate-assets.sh" --snapshot "$asset_snapshot"

wait_for_stable_service() {
    local service="$1" maximum_seconds="$2" stable_seconds="$3"
    local deadline=$((SECONDS + maximum_seconds))
    local stable=0 previous_pid="" previous_restarts=""
    while ((SECONDS < deadline)); do
        if ! systemctl is-active --quiet "$service"; then
            stable=0
            previous_pid=""
            previous_restarts=""
            sleep 1
            continue
        fi
        local current_pid current_restarts
        current_pid="$(systemctl show -p MainPID --value "$service")"
        current_restarts="$(systemctl show -p NRestarts --value "$service")"
        if [[ -n "$previous_pid" && "$current_pid" == "$previous_pid" \
            && "$current_restarts" == "$previous_restarts" ]]; then
            ((stable += 1))
        else
            stable=0
            previous_pid="$current_pid"
            previous_restarts="$current_restarts"
        fi
        ((stable >= stable_seconds)) && return 0
        sleep 1
    done
    return 1
}

activation_pending="false"
restore_failed_release() {
    local failed_release="$1"
    activation_pending="false"
    trap - ERR
    printf 'Restoring the appliance state from before this update.\n' >&2
    for unit in "${transaction_units[@]}"; do
        [[ "$unit" == "avahi-daemon.service" ]] \
            || systemctl disable --now "$unit" 2>/dev/null || true
    done
    bash "$failed_release/appliance/scripts/pi/activate-assets.sh" \
        --restore "$asset_snapshot" || true
    if [[ -n "$previous_release" && -d "$previous_release" ]]; then
        ln -sfn "$previous_release" /opt/mabeltv/current.new
        mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current
    else
        if [[ "$(readlink -f /opt/mabeltv/current 2>/dev/null || true)" == "$failed_release" ]]; then
            rm -f -- /opt/mabeltv/current
        fi
    fi
    if [[ -n "$prior_previous_link" ]]; then
        ln -sfn "$prior_previous_link" /opt/mabeltv/previous.new
        mv -Tf /opt/mabeltv/previous.new /opt/mabeltv/previous
    else
        rm -f -- /opt/mabeltv/previous
    fi
    systemctl daemon-reload || true
    for unit in "${transaction_units[@]}"; do
        if [[ "${unit_was_enabled[$unit]}" == "true" ]]; then
            systemctl enable "$unit" 2>/dev/null || true
        else
            systemctl disable "$unit" 2>/dev/null || true
        fi
        if [[ "${unit_was_active[$unit]}" == "true" ]]; then
            systemctl restart "$unit" 2>/dev/null || true
        else
            systemctl stop "$unit" 2>/dev/null || true
        fi
    done
    touch "$failed_release/.failed"
}

transaction_error() {
    local status=$?
    if [[ "$activation_pending" == "true" ]]; then
        restore_failed_release "$release_dir"
    fi
    exit "$status"
}

activation_pending="true"
trap transaction_error ERR
bash "$release_dir/appliance/scripts/pi/activate-assets.sh" "$release_dir"

# systemd verifies Exec paths as well as unit syntax. Run this only after the
# transactionally installed helpers exist, then restore the snapshot on error.
verify_dir="$(mktemp -d /tmp/mabeltv-units.XXXXXX)"
for unit in mabeltv.service mabeltv-ir.service mabeltv-recovery.service \
    mabeltv-library.service mabeltv-health.service mabeltv-health.timer \
    mabeltv-boot-audit.service mabeltv-retention.service \
    mabeltv-retention.timer mabeltv-owner-recovery.service; do
    sed "s|/opt/mabeltv/current|$release_dir|g" \
        "$release_dir/appliance/packaging/linux/$unit" > "$verify_dir/$unit"
done
systemd-analyze verify "$verify_dir"/*

ln -sfn "$release_dir" /opt/mabeltv/current.new
mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current
if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" /opt/mabeltv/previous.new
    mv -Tf /opt/mabeltv/previous.new /opt/mabeltv/previous
fi
systemctl daemon-reload
systemctl try-restart systemd-journald.service || true
systemctl enable --now avahi-daemon.service

systemctl enable mabeltv-library.service
if ! systemctl restart mabeltv-library.service \
    || ! wait_for_stable_service mabeltv-library.service 30 3; then
    printf 'The new Library service did not start; restoring the previous release.\n' >&2
    restore_failed_release "$release_dir"
    exit 1
fi

player_should_run="$player_was_active"
if [[ "$enable_service" == "true" ]]; then
    player_should_run="true"
    systemctl enable mabeltv.service
fi
if [[ "$player_should_run" == "true" ]]; then
    if ! systemctl restart mabeltv.service \
        || ! wait_for_stable_service mabeltv.service 55 10; then
        printf 'The new player did not become healthy; restoring the previous release.\n' >&2
        restore_failed_release "$release_dir"
        exit 1
    fi
fi
systemctl enable mabeltv-health.timer
# A timer that was previously disabled or loaded with an older schedule can
# remain in systemd's "elapsed" state after enable --now. Restart it explicitly
# so the new recurring cadence always has a future trigger.
systemctl restart mabeltv-health.timer
systemctl enable mabeltv-boot-audit.service
systemctl enable mabeltv-owner-recovery.service
systemctl enable --now mabeltv-retention.timer
/usr/local/libexec/mabeltv-retention
if [[ "$configure_boot" == "true" ]]; then
    # Do not pin Linux to HDMI socket 1. The launcher detects either connector
    # and still requests the safe 720p application mode from settings.
    boot_arguments=(--display native --remove-forced-video)
    # A mapped remote proves this appliance already uses GPIO IR. Preserve it
    # across normal product updates even when --enable-ir is not repeated.
    if [[ "$enable_ir" == "true" || -f /etc/rc_keymaps/mabeltv.toml ]]; then
        boot_arguments+=(--enable-ir --ir-gpio 18)
    fi
    bash "$source_root/scripts/pi/configure-boot.sh" "${boot_arguments[@]}"
fi
if [[ "$enable_service" == "true" ]]; then
    if [[ -f /etc/rc_keymaps/mabeltv.toml ]]; then
        systemctl enable mabeltv-ir.service
    fi
    printf 'Mabel TV is running and enabled for the next boot.\n'
else
    printf 'Installed but not enabled. Run: sudo systemctl enable --now mabeltv.service\n'
fi
activation_pending="false"
trap - ERR
printf 'Installed release %s. Current release: %s\n' "$release_id" "$(readlink -f /opt/mabeltv/current)"
printf 'Pre-install backup: %s\n' "$preinstall_backup"
printf 'Media belongs under /srv/mabeltv/media/<channel-folder>/.\n'
printf 'Mabel TV Library is available on this home network at http://%s.local:8080\n' "$(hostname)"
if [[ ! -s /var/lib/mabeltv/owner.json ]]; then
    setup_code="$(sed -n 's/^MABELTV_SETUP_CODE=//p' /etc/mabeltv/library.conf)"
    if [[ -n "$setup_code" ]]; then
        printf '\nFIRST-TIME SETUP CODE: %s\n' "$setup_code"
        printf 'Open http://%s.local:8080 and follow the three short setup steps.\n' "$(hostname)"
    fi
fi
if [[ "$product_install" == "true" ]]; then
    printf 'Restart the Raspberry Pi to enter appliance mode: sudo reboot\n'
fi
