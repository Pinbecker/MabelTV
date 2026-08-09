#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo.\n' >&2
    exit 1
fi

backup_root="${1:-/var/backups/mabeltv}"
install -d -o root -g root -m 0700 "$backup_root"
archive="$backup_root/mabeltv-$(date +%Y%m%d-%H%M%S).tar.gz"
paths=(var/lib/mabeltv/channels.json var/lib/mabeltv/settings.json var/lib/mabeltv/state.json)
[[ -f /etc/rc_keymaps/mabeltv.toml ]] && paths+=(etc/rc_keymaps/mabeltv.toml)
[[ -f /etc/mabeltv/library.conf ]] && paths+=(etc/mabeltv/library.conf)
tar -C / -czf "$archive" --ignore-failed-read "${paths[@]}"
chmod 0600 "$archive"
printf '%s\n' "$archive"
