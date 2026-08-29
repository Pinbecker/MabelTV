#!/usr/bin/env bash
set -Eeuo pipefail

destination="${1:-/tmp/mabeltv-diagnostics-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$destination"

uname -a > "$destination/uname.txt"
cat /etc/os-release > "$destination/os-release.txt"
tr -d '\0' < /proc/device-tree/model > "$destination/pi-model.txt" 2>/dev/null || true
free -h > "$destination/memory.txt"
df -h > "$destination/filesystems.txt"
systemctl status mabeltv.service mabeltv-library.service mabeltv-matter.service \
    --no-pager > "$destination/service-status.txt" 2>&1 || true
journalctl --list-boots --no-pager > "$destination/boot-history.txt" 2>&1 || true
journalctl -u mabeltv.service -u mabeltv-library.service -u mabeltv-matter.service \
    --no-pager -n 1000 > "$destination/journal.txt" 2>&1 || true
journalctl -k --no-pager -p warning..alert -n 500 > "$destination/kernel-warnings.txt" 2>&1 || true
journalctl -b -1 --no-pager -n 1000 > "$destination/previous-boot-journal.txt" 2>&1 || true
pid="$(systemctl show -p MainPID --value mabeltv.service)"
if [[ "$pid" =~ ^[1-9][0-9]*$ && -d "/proc/$pid/fd" ]]; then
    find "/proc/$pid/fd" -maxdepth 1 -type l -printf '%l\n' 2>/dev/null \
        | sort | uniq -c | sort -nr > "$destination/file-descriptors.txt" || true
    cat "/proc/$pid/limits" > "$destination/process-limits.txt" 2>/dev/null || true
fi
ir-keytable > "$destination/ir-keytable.txt" 2>&1 || true
rfkill list bluetooth > "$destination/bluetooth.txt" 2>&1 || true
for card in /sys/class/drm/card*-*/status; do
    [[ -e "$card" ]] || continue
    printf '%s: %s\n' "$card" "$(<"$card")"
done > "$destination/drm-status.txt"
if command -v vcgencmd >/dev/null; then
    vcgencmd get_throttled > "$destination/throttled.txt" 2>&1 || true
    vcgencmd measure_temp > "$destination/temperature.txt" 2>&1 || true
fi
systemctl status mabeltv-health.timer --no-pager > "$destination/health-monitor-status.txt" 2>&1 || true
timeout 180 /usr/local/sbin/mabeltv-media-report --summary \
    > "$destination/media-compatibility.txt" 2>&1 || true
mkdir -p "$destination/recovery"
if [[ -d /var/lib/mabeltv/recovery ]]; then
    while IFS= read -r snapshot; do
        [[ -n "$snapshot" ]] || continue
        cp -a -- "$snapshot" "$destination/recovery/" 2>/dev/null || true
    done < <(find /var/lib/mabeltv/recovery -mindepth 1 -maxdepth 1 \
        -printf '%T@ %p\n' | sort -nr | head -n 10 | cut -d' ' -f2-)
fi

archive="$destination.tar.gz"
tar -C "$(dirname "$destination")" -czf "$archive" "$(basename "$destination")"
printf '%s\n' "$archive"
