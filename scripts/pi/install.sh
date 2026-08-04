#!/usr/bin/env bash
set -Eeuo pipefail

enable_service="false"
configure_boot="false"
skip_packages="false"
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
    printf 'Usage: sudo bash scripts/pi/install.sh [--enable-service] [--configure-boot] [--skip-packages]\n'
}

while (($#)); do
    case "$1" in
        --enable-service) enable_service="true"; shift ;;
        --configure-boot) configure_boot="true"; shift ;;
        --skip-packages) skip_packages="true"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    printf 'Run this installer with sudo.\n' >&2
    exit 1
fi
if [[ "$(uname -m)" != "aarch64" ]]; then
    printf 'This installer requires 64-bit Raspberry Pi OS (aarch64); found %s.\n' "$(uname -m)" >&2
    exit 1
fi
if [[ ! -r /proc/device-tree/model ]] || ! tr -d '\0' < /proc/device-tree/model | grep -qi 'raspberry pi'; then
    printf 'This does not appear to be a Raspberry Pi. Refusing appliance installation.\n' >&2
    exit 1
fi

if [[ "$skip_packages" != "true" ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build pkg-config \
        qt6-base-dev qt6-declarative-dev qt6-shadertools-dev qt6-qpa-plugins \
        qml6-module-qtquick qml6-module-qtquick-window libqt6opengl6-dev \
        libmpv-dev ffmpeg libegl1-mesa-dev libgl1-mesa-dev libdrm-dev \
        ir-keytable python3 sudo logrotate
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

build_dir="$(mktemp -d /tmp/mabeltv-build.XXXXXX)"
incoming_dir=""
cleanup() {
    rm -rf -- "$build_dir"
    if [[ -n "$incoming_dir" && -d "$incoming_dir" ]]; then
        rm -rf -- "$incoming_dir"
    fi
}
trap cleanup EXIT

cmake -S "$source_root" -B "$build_dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
build_jobs="${MABELTV_BUILD_JOBS:-2}"
cmake --build "$build_dir" --parallel "$build_jobs"
ctest --test-dir "$build_dir" --output-on-failure

version="$(sed -nE 's/^[[:space:]]*VERSION[[:space:]]+([0-9.]+).*/\1/p' "$source_root/CMakeLists.txt" | head -n1)"
[[ -n "$version" ]] || version=development
release_id="$version-$(date +%Y%m%d%H%M%S)"
incoming_dir="/opt/mabeltv/releases/.incoming-$release_id-$$"
release_dir="/opt/mabeltv/releases/$release_id"
install -d -o root -g root -m 0755 "$incoming_dir"
install -o root -g root -m 0755 "$build_dir/mabeltv" "$incoming_dir/mabeltv"
install -o root -g root -m 0755 "$build_dir/mabeltv_media_check" "$incoming_dir/mabeltv_media_check"
install -o root -g root -m 0755 "$source_root/scripts/pi/mabeltv-launch.sh" "$incoming_dir/mabeltv-launch"
mv "$incoming_dir" "$release_dir"
incoming_dir=""
ln -sfn "$release_dir" /opt/mabeltv/current.new
mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current

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

install -o root -g root -m 0644 "$source_root/packaging/linux/mabeltv.service" /etc/systemd/system/mabeltv.service
install -o root -g root -m 0644 "$source_root/packaging/linux/mabeltv-ir.service" /etc/systemd/system/mabeltv-ir.service
install -o root -g root -m 0644 "$source_root/packaging/linux/mabeltv-recovery.service" /etc/systemd/system/mabeltv-recovery.service
install -o root -g root -m 0755 "$source_root/packaging/linux/mabeltv-recovery" /usr/local/libexec/mabeltv-recovery
install -o root -g root -m 0755 "$source_root/scripts/pi/load-ir-keymap.sh" /usr/local/libexec/mabeltv-load-ir-keymap
install -o root -g root -m 0755 "$source_root/scripts/pi/map-remote.py" /usr/local/sbin/mabeltv-map-remote
install -o root -g root -m 0755 "$source_root/scripts/pi/add-channel.py" /usr/local/sbin/mabeltv-add-channel
install -o root -g root -m 0755 "$source_root/scripts/pi/backup-config.sh" /usr/local/sbin/mabeltv-backup
install -o root -g root -m 0755 "$source_root/scripts/pi/rollback.sh" /usr/local/sbin/mabeltv-rollback
install -o root -g root -m 0755 "$source_root/scripts/pi/diagnostics.sh" /usr/local/sbin/mabeltv-diagnostics
install -o root -g root -m 0755 "$source_root/scripts/pi/soak-test.sh" /usr/local/sbin/mabeltv-soak-test
install -o root -g root -m 0755 "$source_root/scripts/pi/fence-check.sh" /usr/local/sbin/mabeltv-fence-check
install -o root -g root -m 0644 "$source_root/packaging/linux/mabeltv-logrotate" /etc/logrotate.d/mabeltv
install -d -o root -g root -m 0755 /etc/systemd/journald.conf.d
install -o root -g root -m 0644 "$source_root/packaging/linux/mabeltv-journald.conf" /etc/systemd/journald.conf.d/mabeltv.conf
install -o root -g root -m 0440 "$source_root/packaging/linux/mabeltv-sudoers" /etc/sudoers.d/mabeltv
visudo -c -f /etc/sudoers.d/mabeltv
install -o root -g root -m 0644 "$source_root/README.md" "$source_root/LICENSE" /usr/share/doc/mabeltv/
if [[ -d "$source_root/docs" ]]; then
    cp -a "$source_root/docs/." /usr/share/doc/mabeltv/
fi

systemctl daemon-reload
systemctl try-restart systemd-journald.service || true
if [[ "$configure_boot" == "true" ]]; then
    bash "$source_root/scripts/pi/configure-boot.sh" --display 720p --ir-gpio 18
fi
if [[ "$enable_service" == "true" ]]; then
    systemctl enable mabeltv.service
    if [[ -f /etc/rc_keymaps/mabeltv.toml ]]; then
        systemctl enable mabeltv-ir.service
    fi
    printf 'Mabel TV is enabled for the next boot.\n'
else
    printf 'Installed but not enabled. Run: sudo systemctl enable --now mabeltv.service\n'
fi
printf 'Installed release %s. Current release: %s\n' "$release_id" "$(readlink -f /opt/mabeltv/current)"
printf 'Media belongs under /srv/mabeltv/media/<channel-folder>/.\n'
