#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo.\n' >&2
    exit 1
fi

releases_root=/opt/mabeltv/releases
current="$(readlink -f /opt/mabeltv/current || true)"
target="${1:-}"
if [[ -z "$target" ]]; then
    while IFS= read -r candidate; do
        if [[ "$candidate" != "$current" && -x "$candidate/mabeltv" ]]; then
            target="$candidate"
            break
        fi
    done < <(find "$releases_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
        | sort -nr | cut -d' ' -f2-)
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

ln -sfn "$target" /opt/mabeltv/current.new
mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current
systemctl restart mabeltv.service
sleep 5
if ! systemctl is-active --quiet mabeltv.service; then
    printf 'Rollback selected %s, but the service is not healthy.\n' "$target" >&2
    exit 1
fi
printf 'Rolled back to %s.\n' "$target"
