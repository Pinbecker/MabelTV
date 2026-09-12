#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo.\n' >&2
    exit 1
fi

backup_root="${1:-/var/backups/mabeltv}"
database="${MABELTV_DATABASE:-/var/lib/mabeltv/mabeltv.db}"
install -d -o root -g root -m 0700 "$backup_root"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
archive="$backup_root/MabelTV-Backup-$stamp.tar.gz"
staging="$(mktemp -d "$backup_root/.mabeltv-backup-$stamp.XXXXXX")"
matter_was_active="false"
cleanup() {
    local status=$?
    rm -rf -- "$staging"
    if [[ "$matter_was_active" == "true" ]]; then
        systemctl start mabeltv-matter.service >/dev/null 2>&1 || true
    fi
    return "$status"
}
trap cleanup EXIT

[[ -r "$database" ]] || {
    printf 'MabelTV database is not readable: %s\n' "$database" >&2
    exit 1
}

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

if systemctl is-active --quiet mabeltv-matter.service 2>/dev/null; then
    systemctl stop mabeltv-matter.service
    matter_was_active="true"
fi

paths=(
    var/lib/mabeltv/secrets
    var/lib/mabeltv/matter
    etc/mabeltv
    etc/rc_keymaps/mabeltv.toml
)
included_paths=()
missing_paths=()
for relative in "${paths[@]}"; do
    if [[ -e "/$relative" ]]; then
        cp -a --parents "/$relative" "$staging"
        included_paths+=("/$relative")
    else
        missing_paths+=("/$relative")
    fi
done

if [[ "$matter_was_active" == "true" ]]; then
    systemctl start mabeltv-matter.service
    matter_was_active="false"
fi

{
    printf 'created_utc=%s\n' "$stamp"
    printf 'hostname=%s\n' "$(hostname)"
    printf 'database_schema=%s\n' "$(python3 - "$database" <<'PY'
import sqlite3
import sys
with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True) as database:
    print(database.execute("PRAGMA user_version").fetchone()[0])
PY
)"
    printf 'release=%s\n' "$(readlink -f /opt/mabeltv/current 2>/dev/null || true)"
    printf 'database_snapshot=SQLite online backup API\n'
    printf 'included=%s\n' "/var/lib/mabeltv/mabeltv.db"
    for relative in "${included_paths[@]}"; do
        printf 'included=%s\n' "$relative"
    done
    for relative in "${missing_paths[@]}"; do
        printf 'absent=%s\n' "$relative"
    done
} > "$staging/MANIFEST.txt"
(cd "$staging" && find . -type f ! -name SHA256SUMS -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar --acls --xattrs --numeric-owner -C "$staging" -czf "$archive" .
chmod 0600 "$archive"
(
    cd "$backup_root"
    sha256sum "$(basename -- "$archive")" > "$(basename -- "$archive").sha256"
)
chmod 0600 "$archive.sha256"
printf '%s\n' "$archive"
