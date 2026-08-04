#!/usr/bin/env bash
set -Eeuo pipefail

keymap="${1:-/etc/rc_keymaps/mabeltv.toml}"

if [[ ! -r "$keymap" ]]; then
    printf 'Mabel TV IR keymap is not readable: %s\n' "$keymap" >&2
    exit 1
fi

# rc-core numbers depend on kernel probe order. HDMI CEC receivers can become
# rc0/rc1 when KMS is loaded from the initramfs, so identify the KY-022's
# gpio_ir_recv driver instead of assuming a particular rc number.
rc_device="$(
    /usr/bin/ir-keytable 2>&1 | awk '
        /^Found \/sys\/class\/rc\/rc[0-9]+\/ with:/ {
            current = $2
            sub(/\/$/, "", current)
            sub(/^.*\//, "", current)
        }
        /^[[:space:]]*(Name|Driver):[[:space:]]+gpio_ir_recv[[:space:]]*$/ {
            print current
            exit
        }
    '
)"

if [[ -z "$rc_device" ]]; then
    printf 'Could not find the KY-022 gpio_ir_recv rc-core device.\n' >&2
    /usr/bin/ir-keytable >&2 || true
    exit 1
fi

printf 'Loading Mabel TV IR keymap on %s (gpio_ir_recv).\n' "$rc_device"
exec /usr/bin/ir-keytable -s "$rc_device" -c -w "$keymap"
