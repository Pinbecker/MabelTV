#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo.\n' >&2
    exit 1
fi

releases_root=/opt/mabeltv/releases
current="$(readlink -f /opt/mabeltv/current || true)"
player_was_enabled="false"
player_was_active="false"
library_was_enabled="false"
library_was_active="false"
matter_was_enabled="false"
matter_was_active="false"
bluetooth_was_enabled="false"
bluetooth_was_active="false"
systemctl is-enabled --quiet mabeltv.service 2>/dev/null && player_was_enabled="true"
systemctl is-active --quiet mabeltv.service 2>/dev/null && player_was_active="true"
systemctl is-enabled --quiet mabeltv-library.service 2>/dev/null \
    && library_was_enabled="true"
systemctl is-active --quiet mabeltv-library.service 2>/dev/null \
    && library_was_active="true"
systemctl is-enabled --quiet mabeltv-matter.service 2>/dev/null \
    && matter_was_enabled="true"
systemctl is-active --quiet mabeltv-matter.service 2>/dev/null \
    && matter_was_active="true"
systemctl is-enabled --quiet bluetooth.service 2>/dev/null \
    && bluetooth_was_enabled="true"
systemctl is-active --quiet bluetooth.service 2>/dev/null \
    && bluetooth_was_active="true"
target="${1:-}"
if [[ -z "$target" ]]; then
    candidate="$(readlink -f /opt/mabeltv/previous 2>/dev/null || true)"
    if [[ "$candidate" != "$current" && -x "$candidate/mabeltv" \
        && ! -e "$candidate/.failed" ]]; then
        target="$candidate"
    fi
else
    target="$(readlink -f "$target")"
fi

case "$target" in
    "$releases_root"/*) ;;
    *) printf 'Rollback target must be a release under %s.\n' "$releases_root" >&2; exit 1 ;;
esac
if [[ ! -x "$target/mabeltv" ]]; then
    printf 'No valid previous Mabel TV release was found.\n' >&2
    exit 1
fi
if [[ -e "$target/.failed" ]]; then
    printf 'That release previously failed its activation check and cannot be selected.\n' >&2
    exit 1
fi

asset_snapshot=""
verify_dir=""
cleanup() {
    [[ -z "$asset_snapshot" || ! -d "$asset_snapshot" ]] || rm -rf -- "$asset_snapshot"
    [[ -z "$verify_dir" || ! -d "$verify_dir" ]] || rm -rf -- "$verify_dir"
}
trap cleanup EXIT

restore_service_state() {
    local service="$1" was_enabled="$2" was_active="$3"
    if [[ "$was_enabled" == "true" ]]; then
        systemctl enable "$service" 2>/dev/null || true
    else
        systemctl disable "$service" 2>/dev/null || true
    fi
    if [[ "$was_active" == "true" ]]; then
        systemctl restart "$service" 2>/dev/null || true
    else
        systemctl stop "$service" 2>/dev/null || true
    fi
}

wait_for_stable_service() {
    local service="$1" maximum_seconds="$2" stable_seconds="$3"
    local deadline=$((SECONDS + maximum_seconds)) stable=0
    local previous_pid="" previous_restarts=""
    while ((SECONDS < deadline)); do
        if ! systemctl is-active --quiet "$service"; then
            stable=0; previous_pid=""; previous_restarts=""; sleep 1; continue
        fi
        local current_pid current_restarts
        current_pid="$(systemctl show -p MainPID --value "$service")"
        current_restarts="$(systemctl show -p NRestarts --value "$service")"
        if [[ -n "$previous_pid" && "$current_pid" == "$previous_pid" \
            && "$current_restarts" == "$previous_restarts" ]]; then
            ((stable += 1))
        else
            stable=0; previous_pid="$current_pid"; previous_restarts="$current_restarts"
        fi
        ((stable >= stable_seconds)) && return 0
        sleep 1
    done
    return 1
}

if [[ -x "$target/appliance/scripts/pi/activate-assets.sh" ]]; then
    asset_snapshot="$(mktemp -d /tmp/mabeltv-rollback-assets.XXXXXX)"
    bash "$target/appliance/scripts/pi/activate-assets.sh" --snapshot "$asset_snapshot"
    if ! bash "$target/appliance/scripts/pi/activate-assets.sh" "$target"; then
        touch "$target/.failed"
        exit 1
    fi
    # Exec helpers must exist before systemd-analyze can validate these units.
    verify_dir="$(mktemp -d /tmp/mabeltv-rollback-units.XXXXXX)"
    verification_units=(mabeltv.service mabeltv-ir.service mabeltv-recovery.service \
        mabeltv-library.service mabeltv-health.service mabeltv-health.timer \
        mabeltv-boot-audit.service mabeltv-retention.service \
        mabeltv-retention.timer mabeltv-owner-recovery.service)
    if [[ -f "$target/appliance/packaging/linux/mabeltv-matter.service" ]]; then
        verification_units+=(mabeltv-matter.service)
    fi
    for unit in "${verification_units[@]}"; do
        sed "s|/opt/mabeltv/current|$target|g" \
            "$target/appliance/packaging/linux/$unit" > "$verify_dir/$unit"
    done
    if ! systemd-analyze verify "$verify_dir"/*; then
        bash "$target/appliance/scripts/pi/activate-assets.sh" \
            --restore "$asset_snapshot" || true
        touch "$target/.failed"
        exit 1
    fi
fi

ln -sfn "$target" /opt/mabeltv/current.new
mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current
activation_ok="true"
if [[ -x "$target/mabeltv-library" ]]; then
    systemctl enable mabeltv-library.service || activation_ok="false"
    systemctl restart mabeltv-library.service || activation_ok="false"
else
    # Releases before the local Library did not ship its server.  Do not leave
    # a failed helper service behind when returning to one of those releases.
    systemctl disable --now mabeltv-library.service || true
fi
systemctl restart mabeltv.service || activation_ok="false"
if [[ -f "$target/appliance/packaging/linux/mabeltv-matter.service" \
      && -f "$target/appliance/integrations/matter/mabeltv-matter.mjs" ]]; then
    systemctl disable --now bluetooth.service || true
    systemctl enable mabeltv-matter.service || activation_ok="false"
    systemctl restart mabeltv-matter.service || activation_ok="false"
else
    systemctl disable --now mabeltv-matter.service 2>/dev/null || true
    rm -f -- /etc/systemd/system/mabeltv-matter.service \
        /usr/local/libexec/mabeltv-matter-bluetooth \
        /usr/local/sbin/mabeltv-alexa-pairing
    systemctl daemon-reload
    saved_bluetooth_state=/var/lib/mabeltv/matter/bluetooth-service-state
    if [[ -r "$saved_bluetooth_state" ]]; then
        # shellcheck disable=SC1090
        source "$saved_bluetooth_state"
        [[ "${enabled:-false}" == "true" ]] \
            && systemctl enable bluetooth.service 2>/dev/null || true
        [[ "${active:-false}" == "true" ]] \
            && systemctl start bluetooth.service 2>/dev/null || true
    fi
fi
if [[ "$activation_ok" != "true" ]] \
    || ! wait_for_stable_service mabeltv.service 55 10 \
    || { [[ -x "$target/mabeltv-library" ]] \
         && ! wait_for_stable_service mabeltv-library.service 30 3; } \
    || { [[ -f "$target/appliance/integrations/matter/mabeltv-matter.mjs" ]] \
         && ! wait_for_stable_service mabeltv-matter.service 30 8; }; then
    printf 'Rollback selected %s, but the service is not healthy.\n' "$target" >&2
    touch "$target/.failed"
    if [[ -n "$asset_snapshot" ]]; then
        bash "$target/appliance/scripts/pi/activate-assets.sh" \
            --restore "$asset_snapshot" || true
    elif [[ -n "$current" && -x "$current/appliance/scripts/pi/activate-assets.sh" ]]; then
        bash "$current/appliance/scripts/pi/activate-assets.sh" "$current" || true
    fi
    if [[ -n "$current" && -x "$current/mabeltv" ]]; then
        ln -sfn "$current" /opt/mabeltv/current.new
        mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current
    else
        rm -f -- /opt/mabeltv/current
    fi
    systemctl daemon-reload || true
    restore_service_state mabeltv-library.service \
        "$library_was_enabled" "$library_was_active"
    restore_service_state bluetooth.service \
        "$bluetooth_was_enabled" "$bluetooth_was_active"
    restore_service_state mabeltv-matter.service \
        "$matter_was_enabled" "$matter_was_active"
    restore_service_state mabeltv.service "$player_was_enabled" "$player_was_active"
    exit 1
fi
if [[ -n "$current" && -x "$current/mabeltv" ]]; then
    ln -sfn "$current" /opt/mabeltv/previous.new
    mv -Tf /opt/mabeltv/previous.new /opt/mabeltv/previous
fi
printf 'Rolled back to %s.\n' "$target"
