#!/usr/bin/env bash
# New releases carry their exact runtime; legacy/source installs still use npm.
set -Eeuo pipefail
prebuilt="${1:?Prebuilt directory required}"
destination="${2:?Matter destination required}"
archive="$prebuilt/matter-node-modules.tar.gz"
if [[ -f "$archive" ]]; then
    python3 - "$prebuilt" "$destination" <<'PY'
import hashlib
import json
import pathlib
import sys
import tarfile

prebuilt, destination = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((prebuilt / "BUILD-MANIFEST.json").read_text(encoding="utf-8"))
archive = prebuilt / "matter-node-modules.tar.gz"
expected = manifest.get("files", {}).get(archive.name, {}).get("sha256")
if not expected or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit("Offline Matter runtime failed its release checksum")
lock_hash = hashlib.sha256((destination / "package-lock.json").read_bytes()).hexdigest()
if lock_hash != manifest.get("matter_lock_sha256"):
    raise SystemExit("Offline Matter runtime does not match this release's lockfile")
with tarfile.open(archive, "r:gz") as bundle:
    for member in bundle.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if (path.is_absolute() or ".." in path.parts or not path.parts
                or path.parts[0] != "node_modules"
                or not (member.isfile() or member.isdir() or member.issym())):
            raise SystemExit("Unsafe path in offline Matter runtime")
        if member.issym():
            target = (destination / member.name).parent / member.linkname
            if not target.resolve().is_relative_to((destination / "node_modules").resolve()):
                raise SystemExit("Unsafe link in offline Matter runtime")
    bundle.extractall(destination, filter="data")
PY
else
    # Do not silently go online if a new bundle lost its packaged dependency.
    python3 - "$prebuilt/BUILD-MANIFEST.json" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
if path.exists() and "matter_lock_sha256" in json.loads(path.read_text(encoding="utf-8")):
    raise SystemExit("This release is missing its offline Matter runtime")
PY
    npm ci --omit=dev --no-audit --no-fund --prefix "$destination"
fi
# Catch missing packages and an unsupported Node version before activation.
(cd "$destination" && node --input-type=module -e 'await import("@matter/main")')
