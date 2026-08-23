#!/usr/bin/env bash
# Remove Mabel TV software while retaining owner media and configuration unless
# the user explicitly opts into the separate, destructive purge-data step.
set -Eeuo pipefail

confirmed="false"
purge_data="false"

usage() {
    printf 'Usage: sudo mabeltv-uninstall --yes [--purge-data]\n'
    printf 'Without --purge-data, videos, settings and backups are retained.\n'
}

while (($#)); do
    case "$1" in
        --yes) confirmed="true"; shift ;;
        --purge-data) purge_data="true"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then printf 'Run this command with sudo.\n' >&2; exit 1; fi
if [[ "$confirmed" != "true" ]]; then
    printf 'No changes made. Re-run with --yes after reading the usage below.\n\n'
    usage
    exit 2
fi

boot_root=/boot/firmware
[[ -f "$boot_root/config.txt" ]] || boot_root=/boot
config_path="$boot_root/config.txt"
cmdline_path="$boot_root/cmdline.txt"
boot_state=/var/lib/mabeltv/install/boot-original
if [[ -f "$config_path" ]]; then
    temporary_config="$(mktemp)"
    awk '
        $0 == "# BEGIN MABELTV MANAGED SETTINGS" { skip = 1; next }
        $0 == "# END MABELTV MANAGED SETTINGS" { skip = 0; next }
        !skip { print }
    ' "$config_path" > "$temporary_config"
    install -m "$(stat -c '%a' "$config_path")" "$temporary_config" "$config_path"
    rm -f -- "$temporary_config"
fi
if [[ -f "$cmdline_path" && -f "$boot_state/cmdline.txt" \
    && -f "$boot_state/managed-cmdline.tokens" ]]; then
    temporary_cmdline="$(mktemp)"
    python3 - "$boot_state/cmdline.txt" "$boot_state/managed-cmdline.tokens" \
        "$cmdline_path" "$temporary_cmdline" <<'PY'
import pathlib
import sys

original_path, managed_path, current_path, output_path = map(pathlib.Path, sys.argv[1:])
original = original_path.read_text(encoding="utf-8").split()
managed = set(managed_path.read_text(encoding="utf-8").splitlines())
current = current_path.read_text(encoding="utf-8").split()

# Remove only exact tokens recorded as Mabel TV additions. Every unrelated
# owner token, including ones added after an upgrade, remains in its place.
cleaned = [token for token in current if token not in managed]

# Native display mode can remove a pre-existing forced HDMI mode. Restore that
# original only when the owner has not since selected another HDMI mode.
if not any(token.startswith(("video=HDMI-A-1:", "video=HDMI-A-2:")) for token in cleaned):
    cleaned.extend(token for token in original
                   if token.startswith(("video=HDMI-A-1:", "video=HDMI-A-2:")))

output_path.write_text(" ".join(cleaned) + "\n", encoding="utf-8")
PY
    install -m "$(stat -c '%a' "$cmdline_path")" "$temporary_cmdline" "$cmdline_path"
    rm -f -- "$temporary_cmdline"
    printf 'Mabel TV boot arguments removed; later boot-line edits were retained.\n'
elif [[ -f "$cmdline_path" && -f "$boot_state/cmdline.txt" \
    && -f "$boot_state/managed-cmdline.sha256" ]]; then
    # Compatibility path for installations created before token-aware removal.
    current_hash="$(sha256sum "$cmdline_path" | awk '{print $1}')"
    managed_hash="$(<"$boot_state/managed-cmdline.sha256")"
    if [[ "$current_hash" == "$managed_hash" ]]; then
        cp --preserve=all "$boot_state/cmdline.txt" "$cmdline_path"
        printf 'Original boot command line restored.\n'
    else
        printf 'The boot command line changed after Mabel TV setup, so it was retained to protect those later edits. Original: %s\n' "$boot_state/cmdline.txt"
    fi
fi
# A later reinstall must snapshot the owner's then-current boot configuration,
# not reuse a baseline from an earlier install/uninstall cycle.
rm -rf -- "$boot_state"
rmdir /var/lib/mabeltv/install 2>/dev/null || true

systemctl disable --now mabeltv.service mabeltv-library.service \
    mabeltv-ir.service mabeltv-health.timer mabeltv-boot-audit.service \
    mabeltv-retention.timer mabeltv-owner-recovery.service 2>/dev/null || true

unit_paths=(
    /etc/systemd/system/mabeltv.service
    /etc/systemd/system/mabeltv-library.service
    /etc/systemd/system/mabeltv-ir.service
    /etc/systemd/system/mabeltv-recovery.service
    /etc/systemd/system/mabeltv-health.service
    /etc/systemd/system/mabeltv-health.timer
    /etc/systemd/system/mabeltv-boot-audit.service
    /etc/systemd/system/mabeltv-retention.service
    /etc/systemd/system/mabeltv-retention.timer
    /etc/systemd/system/mabeltv-owner-recovery.service
)
helper_paths=(
    /usr/local/libexec/mabeltv-recovery
    /usr/local/libexec/mabeltv-stop-report
    /usr/local/libexec/mabeltv-health
    /usr/local/libexec/mabeltv-boot-audit
    /usr/local/libexec/mabeltv-load-ir-keymap
    /usr/local/libexec/mabeltv-library-refresh
    /usr/local/libexec/mabeltv-admin-action
    /usr/local/libexec/mabeltv-screen-capture
    /usr/local/libexec/mabeltv-retention
    /usr/local/libexec/mabeltv-activate-assets
    /usr/local/libexec/mabeltv-owner-recovery
    /usr/local/sbin/mabeltv-map-remote
    /usr/local/sbin/mabeltv-add-channel
    /usr/local/sbin/mabeltv-backup
    /usr/local/sbin/mabeltv-rollback
    /usr/local/sbin/mabeltv-diagnostics
    /usr/local/sbin/mabeltv-media-report
    /usr/local/sbin/mabeltv-optimise-high-fps
    /usr/local/sbin/mabeltv-soak-test
    /usr/local/sbin/mabeltv-fence-check
    /usr/local/sbin/mabeltv-doctor
    /usr/local/sbin/mabeltv-uninstall
)
rm -f -- "${unit_paths[@]}" "${helper_paths[@]}" \
    /etc/logrotate.d/mabeltv /etc/sudoers.d/mabeltv \
    /etc/avahi/services/mabeltv.service \
    /etc/systemd/journald.conf.d/mabeltv.conf
rm -rf -- /opt/mabeltv /usr/share/doc/mabeltv
systemctl daemon-reload
systemctl try-restart avahi-daemon.service systemd-journald.service 2>/dev/null || true

if [[ "$purge_data" == "true" ]]; then
    rm -rf -- /var/lib/mabeltv /var/cache/mabeltv /var/log/mabeltv /srv/mabeltv/media /var/backups/mabeltv
    rm -f -- /etc/mabeltv/library.conf /etc/rc_keymaps/mabeltv.toml
    rmdir /etc/mabeltv /srv/mabeltv /var/backups/mabeltv 2>/dev/null || true
    userdel mabeltv 2>/dev/null || true
    printf 'Mabel TV software, videos, settings and backups were permanently removed.\n'
else
    printf 'Mabel TV software was removed. Videos and settings remain under /srv/mabeltv and /var/lib/mabeltv.\n'
    printf 'Boot configuration backups named *.mabeltv-*.bak were retained for manual restoration.\n'
fi
