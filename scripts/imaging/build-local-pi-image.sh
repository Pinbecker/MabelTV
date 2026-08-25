#!/usr/bin/env bash
# Build a complete Pi 4 image on a laptop: Docker emulates ARM64 to make the
# release bundle, then pi-gen packages that local bundle into an .img.xz.
set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage: bash scripts/imaging/build-local-pi-image.sh [--output DIR]

Requires Linux/WSL2, Docker Desktop/Linux containers, internet access and at
least 40 GB free space. The final image is written to out/pi-image by default.
EOF
}

output=""
while (($#)); do
    case "$1" in
        --output) output="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

[[ "$(uname -s)" == "Linux" ]] \
    || { printf 'Run this from WSL2/Linux, not directly in Windows PowerShell.\n' >&2; exit 1; }
command -v docker >/dev/null || { printf 'Docker is required.\n' >&2; exit 1; }
command -v git >/dev/null || { printf 'Git is required.\n' >&2; exit 1; }

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
git -c safe.directory="$source_root" -C "$source_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { printf 'Run from a Git checkout.\n' >&2; exit 1; }
if [[ -n "$(git -c safe.directory="$source_root" -C "$source_root" status --porcelain --untracked-files=normal)" ]]; then
    printf 'Commit or stash product changes before making an image.\n' >&2
    exit 1
fi

docker info --format '{{.OSType}}' | grep -qx linux \
    || { printf 'Docker Desktop must be using Linux containers.\n' >&2; exit 1; }
if ! docker buildx inspect --bootstrap 2>/dev/null | grep -q 'linux/arm64'; then
    printf 'Docker Buildx ARM64 support is not available.\n' >&2
    exit 1
fi

commit="$(git -c safe.directory="$source_root" -C "$source_root" rev-parse --short HEAD)"
build_id="$(date -u +%Y%m%dT%H%M%SZ)-$commit"
work_root="$source_root/out/local-image-build/$build_id"
release_root="$work_root/release"
output="${output:-$source_root/out/pi-image}"
mkdir -p "$release_root" "$output"

printf 'Building the ARM64 release bundle locally with Docker…\n'
docker buildx build --load --platform linux/arm64 \
    --tag mabeltv-arm64-builder:local \
    --file "$source_root/packaging/image/arm64-builder/Dockerfile" \
    "$source_root/packaging/image/arm64-builder"
docker run --rm --platform linux/arm64 \
    --mount "type=bind,src=$source_root,dst=/source,readonly" \
    --mount "type=bind,src=$release_root,dst=/out" \
    mabeltv-arm64-builder:local \
    bash -lc 'git config --global --add safe.directory /source && MABELTV_IMAGE_BUILD=true MABELTV_BUILD_JOBS=2 bash /source/scripts/pi/make-release-bundle.sh /out'

bundle="$(find "$release_root" -maxdepth 1 -type f -name 'KidsTV-*-pi4-trixie-arm64.tar.gz' -print -quit)"
[[ -n "$bundle" ]] || { printf 'The local ARM64 bundle was not created.\n' >&2; exit 1; }

printf 'Packaging the local bundle into a Raspberry Pi OS image…\n'
bash "$source_root/scripts/imaging/build-pi-image.sh" --bundle "$bundle" --output "$output"
printf 'Local ARM64 bundle: %s\n' "$bundle"
printf 'Finished image folder: %s\n' "$(readlink -f "$output")"
