#!/usr/bin/env bash
# Build a traceable, precompiled Raspberry Pi customer bundle. Run this on the
# exact Pi 4 / Raspberry Pi OS image used for release qualification.
set -Eeuo pipefail

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
output_root="${1:-$source_root/out/release}"
allow_dirty="${MABELTV_ALLOW_DIRTY_RELEASE:-false}"

bash "$source_root/scripts/pi/preflight.sh"
git -C "$source_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { printf 'A release must be built from a Git checkout.\n' >&2; exit 1; }
dirty_source="false"
release_qualifier=""
working_tree_status="$(git -C "$source_root" status --porcelain --untracked-files=normal)"
# This owner-specific one-off maintenance helper is intentionally kept local
# and is neither an input nor an artifact. Its untracked presence must not push
# a maintainer towards accidentally committing it just to obtain a clean build.
release_status="$(printf '%s\n' "$working_tree_status" \
    | sed '/^?? scripts\/pi\/replace-[^/]*-fps30\.sh$/d')"
if [[ -n "$release_status" ]]; then
    if [[ "$allow_dirty" != "true" ]]; then
        printf 'Refusing a release from a dirty working tree. Commit the intended product source first.\n' >&2
        exit 1
    fi
    dirty_source="true"
    release_qualifier="-UNPUBLISHED-DIRTY"
    printf 'WARNING: producing an explicitly unpublished developer bundle from dirty source.\n' >&2
fi

commit="$(git -C "$source_root" rev-parse HEAD)"
if [[ "$dirty_source" == "false" ]]; then
    version="$(git -C "$source_root" show "${commit}:CMakeLists.txt" \
        | sed -nE 's/^[[:space:]]*VERSION[[:space:]]+([0-9.]+).*/\1/p' \
        | head -n1)"
else
    version="$(sed -nE 's/^[[:space:]]*VERSION[[:space:]]+([0-9.]+).*/\1/p' \
        "$source_root/CMakeLists.txt" | head -n1)"
fi
[[ -n "$version" ]] || { printf 'Could not read the product version.\n' >&2; exit 1; }
if git -C "$source_root" ls-tree -r --name-only "$commit" \
    | grep -Eq '^scripts/pi/replace-[^/]+-fps30\.sh$'; then
    printf 'Owner-specific media replacement helpers must not be committed in a product release.\n' >&2
    exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ ! -r /etc/rpi-issue ]]; then
    printf 'Customer bundles must be built on Raspberry Pi OS, not a generic Debian image.\n' >&2
    exit 1
fi
case "${ID:-}:${VERSION_ID:-}" in
    debian:12|debian:13|raspbian:12|raspbian:13) ;;
    *)
        printf 'Customer bundles currently require Raspberry Pi OS based on Debian 12 or 13. Found %s %s.\n' \
            "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
        exit 1
        ;;
esac
os_slug="${VERSION_CODENAME:-debian-${VERSION_ID:-unknown}}"

work="$(mktemp -d /tmp/mabeltv-release.XXXXXX)"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
build_source="$source_root"
if [[ "$dirty_source" == "false" ]]; then
    # Compile and stage from an immutable export of the recorded commit. A
    # long build therefore cannot silently absorb an editor change made after
    # the initial clean-tree check.
    build_source="$work/build-source"
    install -d -m 0755 "$build_source"
    git -C "$source_root" archive "$commit" | tar -x -C "$build_source"
fi
build="$work/build"
stage="$work/KidsTV-$version$release_qualifier-pi4-$os_slug-arm64"

cmake -S "$build_source" -B "$build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DMABELTV_PI_APPLIANCE=ON
cmake --build "$build" --parallel "${MABELTV_BUILD_JOBS:-2}"
ctest --test-dir "$build" --output-on-failure

install -d -m 0755 "$stage/prebuilt" "$stage/config/examples" \
    "$stage/packaging/linux" "$stage/scripts/pi" "$stage/docs"
install -m 0755 "$build/mabeltv" "$build/mabeltv_media_check" "$stage/prebuilt/"
printf '%s\n' "$version" > "$stage/prebuilt/VERSION"
cp -a "$build_source/packaging/linux/." "$stage/packaging/linux/"
cp -a "$build_source/scripts/pi/." "$stage/scripts/pi/"
rm -f -- "$stage/scripts/pi"/replace-*-fps30.sh
cp -a "$build_source/docs/." "$stage/docs/"
install -m 0644 "$build_source/config/examples/channels.json" \
    "$build_source/config/examples/settings.json" "$stage/config/examples/"
install -m 0644 "$build_source/CMakeLists.txt" "$build_source/README.md" \
    "$build_source/LICENSE" "$build_source/SECURITY.md" \
    "$build_source/THIRD_PARTY_NOTICES.md" "$build_source/CHANGELOG.md" "$stage/"
install -m 0644 "$build_source/docs/privacy.md" "$stage/PRIVACY.md"
install -m 0644 "$build_source/docs/quick-start.md" "$stage/QUICK-START.md"
install -m 0755 "$build_source/scripts/pi/install-product.sh" "$stage/install-mabeltv"

python3 - "$stage" "$version" "$commit" "$dirty_source" <<'PY'
import datetime
import hashlib
import json
import pathlib
import platform
import sys

stage = pathlib.Path(sys.argv[1])
os_release = {}
for line in pathlib.Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
    key, separator, value = line.partition("=")
    if separator:
        os_release[key] = value.strip().strip('"')
files = {}
for name in ("mabeltv", "mabeltv_media_check"):
    path = stage / "prebuilt" / name
    files[name] = {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
    }
manifest = {
    "schema_version": 1,
    "product": "KidsTV",
    "version": sys.argv[2],
    "commit": sys.argv[3],
    "dirty_source": sys.argv[4] == "true",
    "built_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "build_machine": platform.platform(),
    "target": "raspberry-pi-4-arm64",
    "build_os": {"id": os_release.get("ID", ""),
                 "version_id": os_release.get("VERSION_ID", ""),
                 "codename": os_release.get("VERSION_CODENAME", "")},
    "files": files,
}
output = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
(stage / "prebuilt" / "BUILD-MANIFEST.json").write_text(output, encoding="utf-8")
(stage / "BUILD-MANIFEST.json").write_text(output, encoding="utf-8")

supported_os = f"""KidsTV {sys.argv[2]} supported installation target

Hardware: Raspberry Pi 4 Model B with at least 2 GB RAM
Architecture: aarch64 (Raspberry Pi OS Lite 64-bit)
OS ID: {os_release.get('ID', '')}
OS version: {os_release.get('VERSION_ID', '')}
OS codename: {os_release.get('VERSION_CODENAME', '')}
OS name: {os_release.get('PRETTY_NAME', '')}

Install this bundle only on Raspberry Pi OS Lite (64-bit) with the same OS ID
and version shown above. In Raspberry Pi Imager, select a Lite 64-bit image
whose Debian base/codename matches this file. Never use a Bookworm bundle on
Trixie, a Trixie bundle on Bookworm, or this Pi 4 bundle on another Pi model.
The installer verifies OS ID and version and stops before activation on a
mismatch.

A distributor must complete docs/release-readiness.md on this same image before
describing the bundle as qualified for customers.
"""
(stage / "SUPPORTED-OS.txt").write_text(supported_os, encoding="utf-8")

source_name = f"KidsTV-{sys.argv[2]}-source.tar.gz"
if sys.argv[4] == "true":
    source_name = f"KidsTV-{sys.argv[2]}-UNPUBLISHED-DIRTY-source.tar.gz"
source_notice = f"""Corresponding source

The source snapshot corresponding to this bundle is distributed beside it as:
  {source_name}

Verify that archive with its .sha256 file. Commercial distributors must keep
the exact source and required licence material available for every binary they
provide. See LICENSE and THIRD_PARTY_NOTICES.md.
"""
(stage / "CORRESPONDING-SOURCE.txt").write_text(source_notice, encoding="utf-8")
PY

install -d -m 0755 "$output_root"
archive="$output_root/KidsTV-$version$release_qualifier-pi4-$os_slug-arm64.tar.gz"
tar -C "$work" -czf "$archive.new" "$(basename "$stage")"
mv -f -- "$archive.new" "$archive"

if [[ "$dirty_source" == "false" ]]; then
    source_archive="$output_root/KidsTV-$version-source.tar.gz"
    git -C "$source_root" archive --format=tar.gz \
        --prefix="KidsTV-$version-source/" \
        --output="$source_archive.new" "$commit"
else
    # The override exists only so maintainers can exercise the bundle builder
    # before committing. Snapshot tracked and non-ignored untracked files so
    # even this clearly labelled developer artifact has matching source.
    source_stage="$work/KidsTV-$version-UNPUBLISHED-DIRTY-source"
    install -d -m 0755 "$source_stage"
    while IFS= read -r -d '' relative; do
        [[ -e "$source_root/$relative" ]] || continue
        case "$relative" in
            scripts/pi/replace-*-fps30.sh) continue ;;
        esac
        install -d -m 0755 "$source_stage/$(dirname -- "$relative")"
        cp -a -- "$source_root/$relative" "$source_stage/$relative"
    done < <(git -C "$source_root" ls-files -z --cached --others --exclude-standard)
    printf '%s\n' \
        'UNPUBLISHED developer snapshot built from a dirty working tree.' \
        'It has not passed the commercial release gate.' \
        > "$source_stage/DIRTY-BUILD-NOTICE.txt"
    source_archive="$output_root/KidsTV-$version-UNPUBLISHED-DIRTY-source.tar.gz"
    tar -C "$work" -czf "$source_archive.new" "$(basename "$source_stage")"
fi
mv -f -- "$source_archive.new" "$source_archive"

for artifact in "$archive" "$source_archive"; do
    checksum="$artifact.sha256"
    (cd "$output_root" \
        && sha256sum "$(basename "$artifact")" > "$(basename "$checksum").new")
    mv -f -- "$checksum.new" "$checksum"
    rm -f -- "$artifact.asc"
    if [[ -n "${MABELTV_SIGNING_KEY:-}" ]]; then
        gpg --batch --yes --local-user "$MABELTV_SIGNING_KEY" \
            --armor --detach-sign "$artifact"
    fi
done
printf 'Release bundle: %s\n' "$archive"
printf 'Checksum: %s.sha256\n' "$archive"
printf 'Corresponding source: %s\n' "$source_archive"
printf 'Source checksum: %s.sha256\n' "$source_archive"
