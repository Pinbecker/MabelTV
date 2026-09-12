#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || {
    printf 'Run this backup with sudo.\n' >&2
    exit 1
}

if [[ -r /etc/mabeltv/backup.conf ]]; then
    # This optional operator file is root-owned configuration, not application data.
    # shellcheck disable=SC1091
    source /etc/mabeltv/backup.conf
fi

config_file="${MABELTV_RCLONE_CONFIG:-/etc/rclone/mabeltv.conf}"
remote_root="${MABELTV_BACKUP_REMOTE:-onedrive:Documents/MabelTV Backups/snapshots}"
local_root="${MABELTV_BACKUP_LOCAL_ROOT:-/var/backups/mabeltv/onedrive}"
state_root="${MABELTV_BACKUP_STATE_ROOT:-/var/lib/mabeltv/backup}"
daily_keep="${MABELTV_BACKUP_DAILY_KEEP:-35}"
weekly_keep="${MABELTV_BACKUP_WEEKLY_KEEP:-12}"
monthly_keep="${MABELTV_BACKUP_MONTHLY_KEEP:-24}"
recent_keep="${MABELTV_BACKUP_RECENT_KEEP:-7}"

for count in "$daily_keep" "$weekly_keep" "$monthly_keep" "$recent_keep"; do
    [[ "$count" =~ ^[1-9][0-9]*$ ]] || {
        printf 'Backup retention values must be positive integers.\n' >&2
        exit 1
    }
done

case "$remote_root" in
    onedrive:Documents/MabelTV\ Backups/snapshots) ;;
    *)
        printf 'Refusing an unexpected backup destination: %s\n' "$remote_root" >&2
        exit 1
        ;;
esac

command -v rclone >/dev/null || {
    printf 'rclone is not installed.\n' >&2
    exit 1
}
[[ -r "$config_file" ]] || {
    printf 'OneDrive is not configured at %s.\n' "$config_file" >&2
    exit 1
}

install -d -o root -g root -m 0700 "$local_root" "$state_root"
exec 9>"$state_root/backup.lock"
flock -n 9 || {
    printf 'Another MabelTV backup is already running.\n' >&2
    exit 1
}

archive="$(/usr/local/sbin/mabeltv-backup "$local_root")"
sidecar="$archive.sha256"
name="$(basename -- "$archive")"
year="${name:15:4}"
month="${name:20:2}"
remote_directory="$remote_root/$year/$month"
remote_archive="$remote_directory/$name"
remote_sidecar="$remote_archive.sha256"
remote_partial="$remote_directory/.$name.partial"
remote_sidecar_partial="$remote_directory/.$name.sha256.partial"

cleanup_remote_partial() {
    rclone deletefile --config "$config_file" "$remote_partial" >/dev/null 2>&1 || true
    rclone deletefile --config "$config_file" "$remote_sidecar_partial" >/dev/null 2>&1 || true
}
trap cleanup_remote_partial EXIT

expected_hash="$(awk 'NR == 1 {print $1}' "$sidecar")"
rclone copyto --config "$config_file" --immutable "$archive" "$remote_partial"
remote_hash="$(rclone cat --config "$config_file" "$remote_partial" | sha256sum | awk '{print $1}')"
[[ "$remote_hash" == "$expected_hash" ]] || {
    printf 'The uploaded archive failed SHA-256 verification.\n' >&2
    exit 1
}
rclone moveto --config "$config_file" --immutable "$remote_partial" "$remote_archive"
rclone copyto --config "$config_file" --immutable "$sidecar" "$remote_sidecar_partial"
remote_sidecar_text="$(rclone cat --config "$config_file" "$remote_sidecar_partial")"
[[ "$remote_sidecar_text" == "$(cat "$sidecar")" ]] || {
    printf 'The uploaded checksum sidecar failed verification.\n' >&2
    exit 1
}
rclone moveto --config "$config_file" --immutable \
    "$remote_sidecar_partial" "$remote_sidecar"

mapfile -t remote_archives < <(
    rclone lsf --config "$config_file" --recursive --files-only \
        --include 'MabelTV-Backup-*.tar.gz' "$remote_root" | sort -r
)
if ((${#remote_archives[@]})); then
    retention_list="$state_root/.remote-archives.$$"
    printf '%s\n' "${remote_archives[@]}" > "$retention_list"
    mapfile -t expired < <(python3 - \
        "$recent_keep" "$daily_keep" "$weekly_keep" "$monthly_keep" \
        "$retention_list" <<'PY'
import datetime as dt
import re
import sys

recent_keep, daily_keep, weekly_keep, monthly_keep = map(int, sys.argv[1:5])
pattern = re.compile(
    r"(?:^|/)MabelTV-Backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.tar\.gz$")
archives = []
for raw in open(sys.argv[5], encoding="utf-8"):
    path = raw.strip()
    match = pattern.search(path)
    if match:
        stamp = dt.datetime(*map(int, match.groups()), tzinfo=dt.timezone.utc)
        archives.append((stamp, path))
archives.sort(reverse=True)

keep = {path for _, path in archives[:recent_keep]}
for key, limit in (
    (lambda value: value.date(), daily_keep),
    (lambda value: value.isocalendar()[:2], weekly_keep),
    (lambda value: (value.year, value.month), monthly_keep),
):
    buckets = set()
    for stamp, path in archives:
        bucket = key(stamp)
        if bucket in buckets:
            continue
        if len(buckets) >= limit:
            break
        buckets.add(bucket)
        keep.add(path)

for _, path in archives:
    if path not in keep:
        print(path)
PY
    )
    rm -f -- "$retention_list"
    for relative in "${expired[@]}"; do
        [[ -n "$relative" ]] || continue
        rclone deletefile --config "$config_file" "$remote_root/$relative"
        rclone deletefile --config "$config_file" "$remote_root/$relative.sha256" \
            >/dev/null 2>&1 || true
    done
fi

mapfile -t local_archives < <(find "$local_root" -maxdepth 1 -type f \
    -name 'MabelTV-Backup-*.tar.gz' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
for ((index = recent_keep; index < ${#local_archives[@]}; ++index)); do
    candidate="${local_archives[index]}"
    case "$candidate" in
        "$local_root"/MabelTV-Backup-*.tar.gz)
            rm -f -- "$candidate" "$candidate.sha256"
            ;;
    esac
done

success_tmp="$state_root/.last-success.$$"
{
    printf 'completed_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'archive=%s\n' "$remote_archive"
    printf 'sha256=%s\n' "$expected_hash"
} > "$success_tmp"
chmod 0600 "$success_tmp"
mv -fT "$success_tmp" "$state_root/last-success"
trap - EXIT
printf 'Verified OneDrive backup: %s\n' "$remote_archive"
