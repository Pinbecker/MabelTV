#!/usr/bin/env bash
# Customer entry point included at the root of a KidsTV Pi release bundle.
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$script_directory/scripts/pi" ]]; then
    bundle_root="$script_directory"
else
    bundle_root="$(cd -- "$script_directory/../.." && pwd)"
fi
benchmark_arguments=()
if python3 - "$bundle_root/prebuilt/BUILD-MANIFEST.json" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if manifest.get("target") == "raspberry-pi-1-armv6l-benchmark" else 1)
PY
then
    benchmark_arguments+=(--pi1-benchmark)
fi
exec bash "$bundle_root/scripts/pi/install.sh" \
    --product-install --prebuilt "$bundle_root/prebuilt" "${benchmark_arguments[@]}" "$@"
