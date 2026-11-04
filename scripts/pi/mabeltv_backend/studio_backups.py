"""Protected companion snapshots and verified iCloud disaster-backup delivery."""
import hashlib
import datetime as dt
import json
import re
import subprocess
import tempfile
import time

NAME = re.compile(r"MabelTV-Backup-\d{4}-\d{2}-\d{2}T\d{6}Z\.tar\.gz")


def retained_backups(names):
    """Same 7 recent, 35 daily, 12 weekly and 24 monthly policy as OneDrive."""
    archives = sorted(((dt.datetime.strptime(name[15:33], "%Y-%m-%dT%H%M%SZ"), name)
                       for name in names if NAME.fullmatch(name)), reverse=True)
    keep = {name for _, name in archives[:7]}
    for key, count in ((lambda stamp: stamp.date(), 35), (lambda stamp: stamp.isocalendar()[:2], 12),
                       (lambda stamp: (stamp.year, stamp.month), 24)):
        buckets = set()
        for stamp, name in archives:
            bucket = key(stamp)
            if bucket in buckets:
                continue
            if len(buckets) >= count:
                break
            buckets.add(bucket)
            keep.add(name)
    return keep


class StudioBackupsMixin:
    def studio_profile_backup(self, payload):
        identity, snapshot = str(payload.get("worker", "")), payload.get("snapshot")
        if not re.fullmatch(r"[a-f0-9]{32}", identity) or not isinstance(snapshot, dict) or len(json.dumps(snapshot)) > 2 * 1024 ** 2:
            raise ValueError("Invalid Studio recovery snapshot")
        if snapshot.get("sourceId") != identity or snapshot.get("version") != 1 or not isinstance(snapshot.get("jobs"), list):
            raise ValueError("Invalid Studio recovery identity")
        if any(key not in {"version", "sourceId", "settings", "jobs"} for key in snapshot):
            raise ValueError("Unexpected Studio recovery fields")
        allowed = {"localUrl", "remoteUrl", "connectionMode", "workspace", "iCloudRoot", "toolFolder"}
        if not isinstance(snapshot.get("settings"), dict) or set(snapshot["settings"]) - allowed:
            raise ValueError("Unexpected Studio recovery settings")
        value = {"id": identity, "snapshot": snapshot, "created": time.time(), "status": "complete"}
        self.state_database.studio_add("workerbackup", value)
        return {"ok": True, "saved": value["created"]}

    def studio_profile_restore(self, identity):
        value = next((value for value in self.state_database.studio_records("workerbackup") if value["id"] == identity), None)
        if not value:
            raise ValueError("No Studio recovery snapshot for this worker")
        return value

    def studio_backup_latest(self):
        root = self.database_path.parent / "backup-export"
        candidates = sorted((path for path in root.glob("MabelTV-Backup-*.tar.gz") if NAME.fullmatch(path.name) and not path.is_symlink()
                             and path.with_name(path.name + ".sha256").is_file()), reverse=True)
        verified = self.state_database.studio_records("backupreceipt")
        if not candidates:
            return {"available": False, "state": "Waiting for scheduled Pi backup", "verified": verified[:1]}
        path = candidates[0]
        checksum = path.with_name(path.name + ".sha256").read_text().split()[0]
        if not re.fullmatch(r"[a-f0-9]{64}", checksum):
            raise ValueError("Invalid backup checksum")
        name = path.name
        return {"available": True, "name": name, "bytes": path.stat().st_size, "sha256": checksum,
                "path": "Backups/MabelTV/snapshots/" + name[15:19] + "/" + name[20:22] + "/" + name,
                "verified": verified[:1]}

    def studio_backup_file(self, name):
        if not NAME.fullmatch(name):
            raise ValueError("Invalid backup name")
        root = self.database_path.parent / "backup-export"
        path = root / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != root.resolve():
            raise ValueError("Backup not found")
        return path

    def studio_backup_confirm(self, payload):
        name = str(payload.get("name", ""))
        path = self.studio_backup_file(name)
        expected = path.with_name(name + ".sha256").read_text().split()[0]
        existing = next((value for value in self.state_database.studio_records("backupreceipt") if value["id"] == name and value.get("sha256") == expected), None)
        if existing:
            self.studio_backup_retention()
            return {"confirmed": True, **existing}
        remote = "Backups/MabelTV/snapshots/" + name[15:19] + "/" + name[20:22] + "/" + name
        try:
            info = self._studio_cloud_stat(remote)
            if info.get("Size") != path.stat().st_size:
                return {"confirmed": False}
            with tempfile.TemporaryFile() as downloaded:
                result = subprocess.run(["rclone", "--config", str(self.studio_cloud_config), "cat", "mabeltv_icloud:" + remote,
                                         "--contimeout", "20s", "--timeout", "60s", "--retries", "1"],
                                        stdout=downloaded, stderr=subprocess.DEVNULL, timeout=180, check=False)
                if result.returncode:
                    return {"confirmed": False}
                downloaded.seek(0)
                digest = hashlib.file_digest(downloaded, "sha256").hexdigest()
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return {"confirmed": False}
        if digest != expected:
            raise ValueError("The iCloud backup checksum does not match. Local and OneDrive backups were kept")
        receipt = {"id": name, "sha256": digest, "bytes": path.stat().st_size, "path": remote,
                   "remoteId": info.get("ID", ""), "modified": info.get("ModTime", ""),
                   "verified": time.time(), "status": "complete", "created": time.time()}
        self.state_database.studio_add("backupreceipt", receipt)
        self.studio_backup_retention()
        return {"confirmed": True, **receipt}

    def studio_backup_retention(self):
        """Prune only known, verified immutable archives; never scan other folders."""
        verified = [value for value in self.state_database.studio_records("backupreceipt") if NAME.fullmatch(value["id"])]
        if not verified:
            return
        keep = retained_backups(value["id"] for value in verified)
        root = self.database_path.parent / "backup-export"
        newest = set(sorted((value["id"] for value in verified), reverse=True)[:7])
        for value in verified:
            if value["id"] not in newest:
                for suffix in ("", ".sha256"):
                    local = root / (value["id"] + suffix)
                    if not local.is_symlink():
                        local.unlink(missing_ok=True)
        expired = [value for value in verified if value["id"] not in keep and not value.get("retired") and value.get("remoteId")]
        for value in expired[:5]:
            remote = "Backups/MabelTV/snapshots/" + value["id"][15:19] + "/" + value["id"][20:22] + "/" + value["id"]
            try:
                current = self._studio_cloud_stat(remote)
                if (current.get("ID", ""), current.get("ModTime", ""), current.get("Size")) != (value["remoteId"], value["modified"], value["bytes"]):
                    continue
                subprocess.run(["rclone", "--config", str(self.studio_cloud_config), "deletefile", "mabeltv_icloud:" + remote,
                                "--contimeout", "10s", "--timeout", "15s", "--retries", "1"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=25, check=True)
                self.state_database.studio_add("backupreceipt", {**value, "retired": time.time()})
            except (OSError, ValueError, subprocess.SubprocessError):
                continue
