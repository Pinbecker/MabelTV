"""Retire only a frozen previous variant after the recovered destination is verified."""
import os
import time


class StudioRecoveryMixin:
    def studio_finish_recovery(self, payload):
        with self.config_lock:
            return self._studio_finish_recovery(payload)

    def _studio_finish_recovery(self, payload):
        identity = str(payload.get("job", ""))
        job = next((value for value in self.state_database.studio_records("job") if value["id"] == identity), None)
        if not job or not payload.get("claim") or job.get("claim") != payload["claim"] or job["status"] != "active":
            raise ValueError("This recovery claim is no longer active")
        destination = job["destination"]
        if not job.get("originalRecovery") or destination.get("recoveryMode") != "replace":
            return {"complete": True}
        if job.get("recoveryReceipt"):
            receipt = job["recoveryReceipt"]
            if receipt.get("complete") and destination["kind"] != "icloud":
                previous = self.upload_destination(destination["replaceFrozen"]["receipt"])
                target = previous.with_suffix(".mp4")
                candidate = job.get("recoveryCandidate")
                if not candidate or not target.is_file():
                    raise ValueError("The recovered TV copy is no longer available")
                stat = target.stat()
                if [stat.st_size, stat.st_mtime_ns, stat.st_ino] != candidate["fingerprint"]:
                    raise ValueError("The recovered TV copy changed. Retained files were kept")
                if previous != target:
                    previous.unlink(missing_ok=True)
                (self.incoming / (job["id"] + ".recovery-previous")).unlink(missing_ok=True)
            return receipt
        frozen = destination["replaceFrozen"]
        if destination["kind"] == "icloud":
            delivery = next((value for value in self.state_database.studio_records("delivery") if value["id"] == identity), {})
            output = delivery.get("provenance", {}).get("cloudCopies", {}).get("original")
            if not output or not output.get("confirmed") or output.get("id") == frozen["id"]:
                raise ValueError("Wait for the recovered original to be verified in iCloud")
            item = self.studio_cloud_item(output["id"])
            checked = self._studio_cloud_stat("Media/" + item["path"])
            if checked.get("Size") != output["bytes"] or checked.get("ID", "") != output.get("remoteId", ""):
                raise ValueError("The recovered iCloud original changed. Both copies were kept")
            operation = self.studio_cloud_operation({"action": "delete", "confirmed": True, "items": [frozen]})
            value = next(value for value in self.state_database.studio_records("cloudop") if value["id"] == operation["id"])
            value["recoveryJob"] = job["id"]
            self.state_database.studio_add("cloudop", value)
            receipt = {"complete": False, "operation": operation["id"]}
            job["recoveryReceipt"] = receipt
            self.state_database.studio_add("job", job)
            return receipt
        output = self.upload_status(str(payload.get("upload", "")))
        if not output.get("complete"):
            raise ValueError("Wait for the recovered TV copy to be published")
        previous = self.upload_destination(frozen["receipt"])
        replacement = self.upload_destination(output)
        target = previous.with_suffix(".mp4")
        candidate = job.get("recoveryCandidate")
        rollback = self.incoming / (job["id"] + ".recovery-previous")
        if candidate:
            if replacement.is_file():
                ready = replacement.stat()
                if [ready.st_size, ready.st_mtime_ns, ready.st_ino] != candidate["fingerprint"]:
                    raise ValueError("The recovered working version changed")
                old = previous.stat()
                if [old.st_size, old.st_mtime_ns, old.st_ino] != [frozen["bytes"], frozen["mtime"], frozen["inode"]]:
                    raise ValueError("The previous TV version changed. Existing files were kept")
                if not rollback.exists():
                    os.link(previous, rollback)
                os.replace(replacement, target)
            if not target.is_file() or not rollback.is_file():
                raise ValueError("Interrupted recovery needs its retained files")
            stat = target.stat()
            if [stat.st_size, stat.st_mtime_ns, stat.st_ino] != candidate["fingerprint"]:
                raise ValueError("The interrupted recovered version changed. Existing files were kept")
        else:
            if previous == replacement or not replacement.is_file():
                raise ValueError("A separate verified TV replacement is required")
            stat = previous.stat()
            if [stat.st_size, stat.st_mtime_ns, stat.st_ino] != [frozen["bytes"], frozen["mtime"], frozen["inode"]]:
                raise ValueError("The previous TV version changed. Both copies were kept")
            if target != previous and target.exists():
                raise ValueError("A different MP4 already uses the previous version's name")
            if frozen["receipt"].get("kind") != output.get("kind"):
                raise ValueError("The requested TV section differs from the existing copy. Both were kept")
            old_state, _, _ = self._studio_recovery_states(frozen["receipt"], previous, replacement, target)
            stat = replacement.stat()
            job["recoveryCandidate"] = {"fingerprint": [stat.st_size, stat.st_mtime_ns, stat.st_ino], "state": old_state}
            self.state_database.studio_add("job", job)
            os.link(previous, rollback)
            os.replace(replacement, target)
        saved, commit, target_name = self._studio_recovery_states(frozen["receipt"], previous, replacement, target)
        saved = saved or job["recoveryCandidate"]["state"]
        saved.update(state="original", message="", updated=time.time())
        commit(saved)
        for sidecar in replacement.parent.glob(replacement.stem + ".*"):
            if sidecar.suffix.lower() in {".srt", ".vtt"} and sidecar.is_file():
                os.replace(sidecar, target.parent / (target.stem + sidecar.name[len(replacement.stem):]))
        receipt = {"complete": True, "file": target_name}
        job["recoveryReceipt"] = receipt
        self.state_database.studio_add("job", job)
        if previous != target:
            previous.unlink(missing_ok=True)
        rollback.unlink(missing_ok=True)
        self.refresh_tv()
        return receipt

    def _studio_recovery_states(self, previous_receipt, previous, replacement, target):
        kind = previous_receipt.get("kind")
        if kind == "my_tv":
            states = self.my_tv_media_states()
            old, new, name = [self.my_tv_relative_path(path) for path in (previous, replacement, target)]
            saved = states.pop(old, {}) or states.get(name, {})
            states.pop(new, None)
            def commit(value):
                states[name] = value
                self.write_my_tv_media_states(states)
            return saved, commit, name
        if kind == "my-tv-series":
            identity = previous_receipt["series_id"]
            root = self.my_tv_series_root / identity
            states = self.my_tv_series_states()
            old, new, name = [identity + "/" + path.relative_to(root).as_posix() for path in (previous, replacement, target)]
            saved = states["episodes"].pop(old, {}) or states["episodes"].get(name, {})
            states["episodes"].pop(new, None)
            def commit(value):
                states["episodes"][name] = value
                self.write_my_tv_series_states(states)
            return saved, commit, name
        if kind == "channel":
            number = int(previous_receipt["channel"])
            states = self.channel_media_states()
            old, new, name = [self.channel_programme_key(number, path.name) for path in (previous, replacement, target)]
            saved = states.setdefault("programmes", {}).pop(old, {}) or states["programmes"].get(name, {})
            states["programmes"].pop(new, None)
            def commit(value):
                states["programmes"][name] = value
                self.write_channel_media_states(states)
                if previous.name != target.name:
                    self.relocate_viewing_item(number, previous.name, number, target.name)
            return saved, commit, name
        raise ValueError("Unsupported TV replacement section")
