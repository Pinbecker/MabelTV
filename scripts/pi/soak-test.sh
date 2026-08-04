#!/usr/bin/env bash
set -Eeuo pipefail

hours="${1:-8}"
interval="${MABELTV_SOAK_INTERVAL:-60}"
output="${2:-/var/log/mabeltv/soak-$(date +%Y%m%d-%H%M%S).csv}"
if ! [[ "$hours" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! [[ "$interval" =~ ^[0-9]+$ ]]; then
    printf 'Usage: soak-test.sh [hours] [output.csv]\n' >&2
    exit 2
fi

end_epoch="$(python3 - "$hours" <<'PY'
import sys, time
print(int(time.time() + float(sys.argv[1]) * 3600))
PY
)"
printf 'timestamp,service_active,rss_kib,open_fds,gpu_sync_fences,available_kib,temp_c,throttled\n' > "$output"
failures=0
while (( $(date +%s) < end_epoch )); do
    active=false
    systemctl is-active --quiet mabeltv.service && active=true || failures=$((failures + 1))
    pid="$(systemctl show -p MainPID --value mabeltv.service)"
    rss=0
    open_fds=0
    gpu_sync_fences=0
    if [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/status" ]]; then
        rss="$(awk '/^VmRSS:/ {print $2}' "/proc/$pid/status")"
        open_fds="$(find "/proc/$pid/fd" -maxdepth 1 -type l 2>/dev/null | wc -l)"
        gpu_sync_fences="$(find "/proc/$pid/fd" -maxdepth 1 -type l -printf '%l\n' 2>/dev/null | grep -c 'sync_file' || true)"
    fi
    available="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
    temp=""
    throttled=""
    if command -v vcgencmd >/dev/null; then
        temp="$(vcgencmd measure_temp 2>/dev/null | sed -E "s/[^0-9.]+//g")"
        throttled="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)"
    fi
    printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$(date --iso-8601=seconds)" "$active" "$rss" "$open_fds" "$gpu_sync_fences" "$available" "$temp" "$throttled" >> "$output"
    sleep "$interval"
done

printf 'Soak data: %s\n' "$output"
if ((failures > 0)); then
    printf 'Service was inactive during %d sample(s).\n' "$failures" >&2
    exit 1
fi
