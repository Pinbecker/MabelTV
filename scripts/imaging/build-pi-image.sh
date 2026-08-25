#!/usr/bin/env bash
# Build a Raspberry Pi Imager-compatible KidsTV image from a qualified
# customer release bundle. Run on Debian/Ubuntu with Docker, or natively on a
# disposable Debian builder with pi-gen's documented dependencies installed.
set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage: bash scripts/imaging/build-pi-image.sh --bundle FILE [--output DIR] [--native]

The bundle must be a clean, qualified Trixie Pi 4 arm64 customer archive with
its matching .sha256 file beside it. Docker is used unless --native is given.
EOF
}

bundle=""
output=""
native="false"
while (($#)); do
    case "$1" in
        --bundle) bundle="${2:-}"; shift 2 ;;
        --output) output="${2:-}"; shift 2 ;;
        --native) native="true"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

[[ -n "$bundle" ]] || { usage >&2; exit 2; }
[[ "$(uname -s)" == "Linux" ]] \
    || { printf 'The image build must run in Linux, not directly in Windows PowerShell.\n' >&2; exit 1; }
command -v git >/dev/null
command -v python3 >/dev/null
command -v sha256sum >/dev/null

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle="$(readlink -f "$bundle")"
checksum="$bundle.sha256"
output="${output:-$source_root/out/pi-image}"
mkdir -p "$output"
output="$(readlink -f "$output")"
[[ -r "$bundle" && -r "$checksum" ]] \
    || { printf 'Bundle and matching %s are required.\n' "$checksum" >&2; exit 1; }
(cd "$(dirname -- "$bundle")" && sha256sum -c "$(basename -- "$checksum")")

metadata="$(python3 - "$bundle" <<'PY'
import json
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    roots = {pathlib.PurePosixPath(item.name).parts[0] for item in members if item.name}
    if len(roots) != 1:
        raise SystemExit("Release bundle must contain one top-level directory")
    root = next(iter(roots))
    names = {item.name for item in members}
    required = {
        f"{root}/install-mabeltv",
        f"{root}/prebuilt/VERSION",
        f"{root}/prebuilt/BUILD-MANIFEST.json",
    }
    if not required <= names:
        raise SystemExit("Release bundle is missing its product entry point or manifest")
    manifest_file = bundle.extractfile(f"{root}/prebuilt/BUILD-MANIFEST.json")
    version_file = bundle.extractfile(f"{root}/prebuilt/VERSION")
    if manifest_file is None or version_file is None:
        raise SystemExit("Release bundle metadata could not be read")
    manifest = json.load(manifest_file)
    version = version_file.read().decode("utf-8").strip()
    build_os = manifest.get("build_os", {})
    if manifest.get("dirty_source"):
        raise SystemExit("An unpublished dirty bundle cannot be put in a customer image")
    if manifest.get("version") != version:
        raise SystemExit("Release version and build manifest do not match")
    if build_os.get("version_id") != "13" or build_os.get("codename") != "trixie":
        raise SystemExit("This image recipe currently accepts only a Trixie release bundle")
    print(json.dumps({"version": version, "commit": manifest.get("commit", ""),
                      "os_id": build_os.get("id", ""),
                      "os_version": build_os.get("version_id", ""),
                      "os_codename": build_os.get("codename", "")}))
PY
)"
bootstrap_password="$(python3 - <<'PY'
import secrets
import string

# pi-gen requires a password to suppress Raspberry Pi OS's interactive
# first-boot account wizard.  This per-image secret is never printed or
# retained; the one-purpose account is removed by Mabel TV's first-boot
# service before the appliance becomes usable.
alphabet = string.ascii_letters + string.digits
print(''.join(secrets.choice(alphabet) for _ in range(48)))
PY
)"
version="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' <<<"$metadata")"
release_commit="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])' <<<"$metadata")"
pi_gen_commit="$(tr -d '[:space:]' < "$source_root/packaging/image/pi-gen/pigen-commit.txt")"
[[ "$pi_gen_commit" =~ ^[0-9a-f]{40}$ ]] \
    || { printf 'Invalid pinned pi-gen commit.\n' >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/mabeltv-pi-image.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
pi_gen="$work/pi-gen"
git init -q "$pi_gen"
git -C "$pi_gen" remote add origin https://github.com/RPi-Distro/pi-gen.git
git -C "$pi_gen" fetch -q --depth 1 origin "$pi_gen_commit"
git -C "$pi_gen" checkout -q --detach FETCH_HEAD

cp -a "$source_root/packaging/image/pi-gen/stage-mabeltv" "$pi_gen/stage-mabeltv"
chmod 0755 "$pi_gen/stage-mabeltv/prerun.sh" \
    "$pi_gen/stage-mabeltv/00-install/00-run.sh"
stage_files="$pi_gen/stage-mabeltv/00-install/files"
cp "$bundle" "$stage_files/release.tar.gz"
sha256sum "$stage_files/release.tar.gz" | awk '{print $1}' \
    > "$stage_files/release.sha256"
python3 - "$stage_files/image-build.json" "$version" "$release_commit" \
    "$pi_gen_commit" "$(sha256sum "$bundle" | awk '{print $1}')" <<'PY'
import datetime
import json
import pathlib
import sys

output = pathlib.Path(sys.argv[1])
data = {
    "schema_version": 1,
    "product": "KidsTV",
    "version": sys.argv[2],
    "release_commit": sys.argv[3],
    "pi_gen_commit": sys.argv[4],
    "release_sha256": sys.argv[5],
    "built_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "base": "Raspberry Pi OS Lite 64-bit (Trixie)",
    "target": "raspberry-pi-4-arm64",
    "update_entry_point": "install-mabeltv",
}
output.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

touch "$pi_gen/stage2/SKIP_IMAGES"
cat > "$pi_gen/config" <<EOF
IMG_NAME='KidsTV-${version}-trixie-arm64'
PI_GEN_RELEASE='KidsTV ${version}'
RELEASE='trixie'
ARCH='arm64'
DEPLOY_COMPRESSION='xz'
COMPRESSION_LEVEL='6'
TARGET_HOSTNAME='mabel-tv'
LOCALE_DEFAULT='en_GB.UTF-8'
KEYBOARD_KEYMAP='gb'
KEYBOARD_LAYOUT='English (UK)'
TIMEZONE_DEFAULT='Europe/London'
WPA_COUNTRY='GB'
ENABLE_CLOUD_INIT='1'
ENABLE_SSH='0'
FIRST_USER_NAME='mabeltv-bootstrap'
FIRST_USER_PASS='${bootstrap_password}'
DISABLE_FIRST_BOOT_USER_RENAME='1'
PASSWORDLESS_SUDO='0'
STAGE_LIST='stage0 stage1 stage2 stage-mabeltv'
EOF

if [[ "$native" == "true" ]]; then
    (cd "$pi_gen" && sudo ./build.sh)
else
    command -v docker >/dev/null \
        || { printf 'Docker is required unless --native is used.\n' >&2; exit 1; }
    (cd "$pi_gen" && ./build-docker.sh)
fi

shopt -s nullglob
images=("$pi_gen"/deploy/*.img.xz)
[[ ${#images[@]} -eq 1 ]] \
    || { printf 'Expected one compressed image; found %s.\n' "${#images[@]}" >&2; exit 1; }
cp "${images[0]}" "$output/"
cp "$pi_gen"/deploy/*.info "$output/" 2>/dev/null || true
cp "$pi_gen"/deploy/*.log "$output/" 2>/dev/null || true
printf 'KidsTV image: %s/%s\n' "$output" "$(basename -- "${images[0]}")"
