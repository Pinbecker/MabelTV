#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo.\n' >&2
    exit 1
fi

backup_root="${1:-/var/backups/mabeltv}"
database="${MABELTV_DATABASE:-/var/lib/mabeltv/mabeltv.db}"
install -d -o root -g root -m 0700 "$backup_root"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_root/mabeltv-$stamp.tar.gz"
staging="$(mktemp -d "$backup_root/.mabeltv-backup-$stamp.XXXXXX")"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT

install -d -m 0700 "$staging/var/lib/mabeltv"
python3 - "$database" "$staging/var/lib/mabeltv/mabeltv.db" <<'PY'
import sqlite3
import sys

source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
destination = sqlite3.connect(sys.argv[2])
try:
    source.backup(destination)
    integrity = destination.execute("PRAGMA integrity_check").fetchone()[0]
    foreign_keys = destination.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != "ok" or foreign_keys:
        raise SystemExit(
            f"Backup validation failed: integrity={integrity}, foreign_keys={len(foreign_keys)}")
finally:
    destination.close()
    source.close()
PY
chmod 0600 "$staging/var/lib/mabeltv/mabeltv.db"

paths=(var/lib/mabeltv/secrets var/lib/mabeltv/matter etc/mabeltv \
       etc/rc_keymaps/mabeltv.toml)
for relative in "${paths[@]}"; do
    [[ -e "/$relative" ]] || continue
    cp -a --parents "/$relative" "$staging"
done

{
    printf 'created_utc=%s\n' "$stamp"
    printf 'database_schema=%s\n' "$(python3 - "$database" <<'PY'
import sqlite3
import sys
with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True) as database:
    print(database.execute("PRAGMA user_version").fetchone()[0])
PY
)"
    printf 'release=%s\n' "$(readlink -f /opt/mabeltv/current 2>/dev/null || true)"
} > "$staging/MANIFEST.txt"
(cd "$staging" && find . -type f ! -name SHA256SUMS -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar -C "$staging" -czf "$archive" .
chmod 0600 "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 0600 "$archive.sha256"
printf '%s\n' "$archive"
