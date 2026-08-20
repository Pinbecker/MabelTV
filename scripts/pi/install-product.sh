#!/usr/bin/env bash
# Customer entry point included at the root of a Mabel TV Pi release bundle.
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$script_directory/scripts/pi" ]]; then
    bundle_root="$script_directory"
else
    bundle_root="$(cd -- "$script_directory/../.." && pwd)"
fi
exec bash "$bundle_root/scripts/pi/install.sh" \
    --product-install --prebuilt "$bundle_root/prebuilt" "$@"
