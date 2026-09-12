#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || {
    printf 'Run this command with sudo.\n' >&2
    exit 1
}
command -v rclone >/dev/null || {
    printf 'rclone is not installed.\n' >&2
    exit 1
}

install -d -o root -g root -m 0700 /etc/rclone
touch /etc/rclone/mabeltv.conf
chmod 0600 /etc/rclone/mabeltv.conf
rclone config --config /etc/rclone/mabeltv.conf
chmod 0600 /etc/rclone/mabeltv.conf

if rclone listremotes --config /etc/rclone/mabeltv.conf | grep -Fxq 'onedrive:'; then
    systemctl enable --now mabeltv-onedrive-backup.timer
    printf 'The onedrive remote is configured and the daily timer is enabled.\n'
else
    printf 'The required remote named onedrive was not created; the timer remains disabled.\n' >&2
    exit 1
fi
