#!/usr/bin/env bash
set -Eeuo pipefail

duration="${MABELTV_FENCE_CHECK_SECONDS:-60}"
interval="${MABELTV_FENCE_CHECK_INTERVAL:-5}"
maximum_growth="${MABELTV_FENCE_CHECK_MAX_GROWTH:-16}"

if [[ $EUID -ne 0 ]]; then
    printf 'Run this check with sudo.\n' >&2
    exit 1
fi
if ! [[ "$duration" =~ ^[1-9][0-9]*$ ]] \
    || ! [[ "$interval" =~ ^[1-9][0-9]*$ ]] \
    || ! [[ "$maximum_growth" =~ ^[0-9]+$ ]]; then
    printf 'Fence-check settings must be whole positive numbers.\n' >&2
    exit 2
fi

sync_fence_count() {
    local process_id="$1"
    find "/proc/$process_id/fd" -maxdepth 1 -type l -printf '%l\n' 2>/dev/null \
        | grep -c 'sync_file' || true
}

open_file_count() {
    local process_id="$1"
    find "/proc/$process_id/fd" -maxdepth 1 -type l 2>/dev/null | wc -l
}

systemctl restart mabeltv.service
sleep 3

pid="$(systemctl show mabeltv.service -p MainPID --value)"
if ! [[ "$pid" =~ ^[1-9][0-9]*$ ]] || [[ ! -d "/proc/$pid/fd" ]]; then
    printf 'Mabel TV did not start successfully.\n' >&2
    systemctl status mabeltv.service --no-pager >&2 || true
    exit 1
fi

started="$(systemctl show mabeltv.service -p ActiveEnterTimestamp --value)"
baseline="$(sync_fence_count "$pid")"
samples=$(((duration + interval - 1) / interval))

printf 'Checking PID %s for %s seconds (starting fences: %s)\n' "$pid" "$duration" "$baseline"
sample=1
while (( sample <= samples )); do
    sleep "$interval"
    current_pid="$(systemctl show mabeltv.service -p MainPID --value)"
    if [[ "$current_pid" != "$pid" ]] || [[ ! -d "/proc/$pid/fd" ]]; then
        printf 'FAIL: Mabel TV restarted or exited during the fence check.\n' >&2
        exit 1
    fi

    fences="$(sync_fence_count "$pid")"
    open_files="$(open_file_count "$pid")"
    growth=$((fences - baseline))
    printf '%2ds  open=%s  gpu-fences=%s  growth=%+d\n' \
        "$((sample * interval))" "$open_files" "$fences" "$growth"

    if (( growth > maximum_growth )); then
        printf 'FAIL: GPU fences are growing continuously; stopping Mabel TV before it exhausts its descriptors.\n' >&2
        systemctl stop mabeltv.service
        exit 1
    fi
    sample=$((sample + 1))
done

export_errors="$(journalctl -u mabeltv.service --since "$started" --no-pager \
    | grep -c 'export failed' || true)"
if (( export_errors > 0 )); then
    printf 'FAIL: Mesa reported %s new fence export errors.\n' "$export_errors" >&2
    systemctl stop mabeltv.service
    exit 1
fi

printf 'PASS: GPU fences stayed bounded and Mesa reported no export failures.\n'
