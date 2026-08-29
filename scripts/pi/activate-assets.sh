#!/usr/bin/env bash
# Install the immutable units/helpers that belong to one release. Keeping this
# script inside every release lets rollback restore the complete appliance
# boundary as well as the player binaries.
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { printf 'Release activation requires sudo.\n' >&2; exit 1; }

unit_names=(
    mabeltv.service
    mabeltv-ir.service
    mabeltv-recovery.service
    mabeltv-library.service
    mabeltv-health.service
    mabeltv-health.timer
    mabeltv-boot-audit.service
    mabeltv-retention.service
    mabeltv-retention.timer
    mabeltv-owner-recovery.service
    mabeltv-matter.service
)
linux_helper_names=(
    mabeltv-recovery
    mabeltv-stop-report
    mabeltv-health
    mabeltv-boot-audit
    mabeltv-library-refresh
    mabeltv-admin-action
    mabeltv-screen-capture
    mabeltv-screen-capture-stop
    mabeltv-retention
    mabeltv-owner-recovery
    mabeltv-matter-bluetooth
)
script_helper_mappings=(
    load-ir-keymap.sh:mabeltv-load-ir-keymap
)
sbin_mappings=(
    map-remote.py:mabeltv-map-remote
    add-channel.py:mabeltv-add-channel
    backup-config.sh:mabeltv-backup
    rollback.sh:mabeltv-rollback
    diagnostics.sh:mabeltv-diagnostics
    media-report.py:mabeltv-media-report
    optimise-high-fps.sh:mabeltv-optimise-high-fps
    soak-test.sh:mabeltv-soak-test
    fence-check.sh:mabeltv-fence-check
    doctor.sh:mabeltv-doctor
    uninstall.sh:mabeltv-uninstall
)

asset_targets=()
for unit in "${unit_names[@]}"; do asset_targets+=("etc/systemd/system/$unit"); done
for helper in "${linux_helper_names[@]}"; do asset_targets+=("usr/local/libexec/$helper"); done
for mapping in "${script_helper_mappings[@]}"; do asset_targets+=("usr/local/libexec/${mapping#*:}"); done
for mapping in "${sbin_mappings[@]}"; do asset_targets+=("usr/local/sbin/${mapping#*:}"); done
asset_targets+=(
    usr/local/libexec/mabeltv-activate-assets
    usr/local/sbin/mabeltv-alexa-pairing
    etc/logrotate.d/mabeltv
    etc/systemd/journald.conf.d/mabeltv.conf
    etc/sudoers.d/mabeltv
    etc/avahi/services/mabeltv.service
)

snapshot_assets() {
    local destination="$1" relative target saved
    install -d -o root -g root -m 0700 "$destination/root"
    for relative in "${asset_targets[@]}"; do
        target="/$relative"
        saved="$destination/root/$relative"
        if [[ -e "$target" ]]; then
            install -d -o root -g root -m 0755 "$(dirname -- "$saved")"
            cp -a -- "$target" "$saved"
        fi
    done
}

restore_assets() {
    local snapshot="$1" relative target saved
    [[ -d "$snapshot/root" ]] || {
        printf 'Asset snapshot is incomplete: %s\n' "$snapshot" >&2
        return 1
    }
    for relative in "${asset_targets[@]}"; do
        target="/$relative"
        saved="$snapshot/root/$relative"
        rm -f -- "$target"
        if [[ -e "$saved" ]]; then
            install -d -o root -g root -m 0755 "$(dirname -- "$target")"
            cp -a -- "$saved" "$target"
        fi
    done
    systemctl daemon-reload
}

case "${1:-}" in
    --snapshot)
        [[ -n "${2:-}" ]] || { printf 'Usage: %s --snapshot DIRECTORY\n' "$0" >&2; exit 2; }
        snapshot_assets "$2"
        exit 0
        ;;
    --restore)
        [[ -n "${2:-}" ]] || { printf 'Usage: %s --restore DIRECTORY\n' "$0" >&2; exit 2; }
        restore_assets "$2"
        exit 0
        ;;
esac

release_root="$(readlink -f "${1:-}")"
asset_root="$release_root/appliance"
[[ -d "$asset_root/packaging/linux" && -d "$asset_root/scripts/pi" ]] \
    || { printf 'Release appliance assets are incomplete.\n' >&2; exit 1; }

linux="$asset_root/packaging/linux"
scripts="$asset_root/scripts/pi"
transaction_dir="$(mktemp -d /tmp/mabeltv-assets.XXXXXX)"
stage_root="$transaction_dir/stage"
snapshot_root="$transaction_dir/before"
install -d -o root -g root -m 0700 "$stage_root"

cleanup() {
    local relative
    for relative in "${asset_targets[@]}"; do
        rm -f -- "/$relative.mabeltv-new-$$"
    done
    if [[ -n "${transaction_dir:-}" && -d "$transaction_dir" ]]; then
        rm -rf -- "$transaction_dir"
    fi
}
trap cleanup EXIT

stage_file() {
    local source="$1" relative="$2" mode="$3"
    [[ -f "$source" ]] || { printf 'Required appliance asset is missing: %s\n' "$source" >&2; return 1; }
    install -D -o root -g root -m "$mode" "$source" "$stage_root/$relative"
}

for unit in "${unit_names[@]}"; do
    stage_file "$linux/$unit" "etc/systemd/system/$unit" 0644
done
for helper in "${linux_helper_names[@]}"; do
    stage_file "$linux/$helper" "usr/local/libexec/$helper" 0755
done
for mapping in "${script_helper_mappings[@]}"; do
    source_name="${mapping%%:*}"
    target_name="${mapping#*:}"
    stage_file "$scripts/$source_name" "usr/local/libexec/$target_name" 0755
done
for mapping in "${sbin_mappings[@]}"; do
    source_name="${mapping%%:*}"
    target_name="${mapping#*:}"
    stage_file "$scripts/$source_name" "usr/local/sbin/$target_name" 0755
done
# The pairing helper is a packaged Linux asset rather than a general Pi script.
stage_file "$linux/mabeltv-matter-pairing" usr/local/sbin/mabeltv-alexa-pairing 0755
stage_file "$scripts/activate-assets.sh" usr/local/libexec/mabeltv-activate-assets 0755
stage_file "$linux/mabeltv-logrotate" etc/logrotate.d/mabeltv 0644
stage_file "$linux/mabeltv-journald.conf" etc/systemd/journald.conf.d/mabeltv.conf 0644
stage_file "$linux/mabeltv-sudoers" etc/sudoers.d/mabeltv 0440
stage_file "$linux/mabeltv-avahi.service" etc/avahi/services/mabeltv.service 0644

# Validate every source before the first live file is replaced.
visudo -c -f "$stage_root/etc/sudoers.d/mabeltv"
snapshot_assets "$snapshot_root"

activation_committed="false"
rollback_on_error() {
    local status=$?
    trap - ERR
    if [[ "$activation_committed" != "true" ]]; then
        printf 'Asset activation failed; restoring the previous appliance files.\n' >&2
        restore_assets "$snapshot_root" || true
    fi
    exit "$status"
}
trap rollback_on_error ERR

# Each individual replacement is atomic. The snapshot plus ERR trap makes the
# complete set transactional if a later replacement or daemon reload fails.
for relative in "${asset_targets[@]}"; do
    target="/$relative"
    staged="$stage_root/$relative"
    temporary="$target.mabeltv-new-$$"
    install -d -o root -g root -m 0755 "$(dirname -- "$target")"
    cp -a -- "$staged" "$temporary"
    mv -fT -- "$temporary" "$target"
done
systemctl daemon-reload
activation_committed="true"
trap - ERR

# Documentation does not affect bootability and must not turn a healthy
# activation into a rollback if an SD card develops a late write error here.
if ! install -d -o root -g root -m 0755 /usr/share/doc/mabeltv; then
    printf 'Warning: customer documentation directory could not be refreshed.\n' >&2
elif ! install -o root -g root -m 0644 "$asset_root/README.md" "$asset_root/LICENSE" \
        /usr/share/doc/mabeltv/; then
    printf 'Warning: customer documentation could not be refreshed.\n' >&2
elif [[ -d "$asset_root/docs" ]] \
    && ! cp -a "$asset_root/docs/." /usr/share/doc/mabeltv/; then
    printf 'Warning: some customer documentation could not be refreshed.\n' >&2
fi
