from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from tests.python.library_test_support import *


class StudioParallelTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.addCleanup(self.fixture.close)
        self.library = self.fixture.library
        self.database = self.library.state_database
        self.library.studio_cloud_files = [
            {"id": f"{i:024x}", "name": f"Film {i}.mp4", "path": f"Films/{i}.mp4", "bytes": 100,
             "modified": "2026-11-02", "kind": "video", "extension": ".mp4"} for i in range(15)]
        self.library.studio_add_jobs({"sources": [{"type": "cloud", "id": item["id"]}
            for item in self.library.studio_cloud_files], "destination": {"kind": "film"}})

    def poll(self, worker="a" * 32, **fields):
        return self.library.studio_worker_poll({"id": worker, "name": "Studio", "capabilities": ["parallel-stages", "intel-policy-v2"],
                                               "activeJobs": [], **fields})

    def test_parallel_claims_are_bounded_and_keep_independent_leases(self):
        first = self.poll()["jobs"]
        self.assertEqual(len(first), 12)
        updates = [{"id": item["id"], "claim": item["claim"], "stage": "downloading", "percent": i}
                   for i, item in enumerate(first)]
        second = self.poll(activeJobs=updates)
        self.assertFalse(second["jobs"])
        self.assertEqual(len(second["acknowledgedJobs"]), 12)
        for item in self.database.studio_records("job"):
            if item["id"] in {job["id"] for job in first}:
                self.assertEqual(item["stage"], "downloading")

    def test_cloud_confirmation_backlog_does_not_occupy_processing_capacity(self):
        first = self.poll()["jobs"]
        updates = [{"id": item["id"], "claim": item["claim"], "stage": "saving-cloud", "percent": 100}
                   for item in first]
        reply = self.poll(activeJobs=updates)
        self.assertEqual(len(reply["jobs"]), 3)
        self.assertEqual(len(reply["acknowledgedJobs"]), 12)

    def test_one_cancellation_does_not_cancel_other_progress_and_refills_one_slot(self):
        first = self.poll()["jobs"]
        self.library.studio_job_action({"id": first[0]["id"], "action": "cancel"})
        updates = [{"id": item["id"], "claim": item["claim"], "percent": 73} for item in first]
        reply = self.poll(activeJobs=updates)
        self.assertEqual(len(reply["jobs"]), 1)
        commands = {item["id"]: item["command"] for item in reply["acknowledgedJobs"]}
        self.assertEqual(commands[first[0]["id"]], "cancel")
        saved = {item["id"]: item for item in self.database.studio_records("job")}
        self.assertEqual(saved[first[0]["id"]]["status"], "cancelled")
        self.assertNotEqual(saved[first[0]["id"]]["percent"], 73)
        self.assertTrue(all(saved[item["id"]]["percent"] == 73 for item in first[1:]))

    def test_parallel_workers_cannot_claim_each_others_jobs(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda worker: self.poll(worker), ["a" * 32, "b" * 32]))
        claimed = [item["id"] for reply in replies for item in reply["jobs"]]
        self.assertEqual(len(claimed), 15)
        self.assertEqual(len(set(claimed)), 15)

    def test_single_stage_worker_receives_one_job_and_cannot_claim_while_reporting_active(self):
        first = self.library.studio_worker_poll({"id": "c" * 32, "capabilities": ["intel-policy-v2"]})["job"]
        reply = self.library.studio_worker_poll({"id": "c" * 32, "capabilities": ["intel-policy-v2"], "active": {"id": first["id"], "claim": first["claim"]}})
        self.assertIsNone(reply["job"])
        self.assertEqual(reply["acknowledged"]["id"], first["id"])
        self.assertFalse(reply["jobs"])

    def test_invalid_and_duplicate_parallel_progress_is_rejected(self):
        for progress in ([{}], [{"id": "one"}] * 2, [{"id": str(i)} for i in range(65)], "wrong"):
            with self.assertRaises(ValueError):
                self.poll(activeJobs=progress)
        with self.assertRaises(ValueError):
            self.poll(capabilities=[], activeJobs=[])

    def test_unbounded_background_claims_survive_batched_heartbeats_but_not_a_lost_session(self):
        session = "d" * 32
        self.poll(session=session)
        template = self.database.studio_records("job")[0]
        for i in range(100):
            self.database.studio_add("job", {**template, "id": f"{i + 100:032x}", "status": "active",
                "stage": "saving-cloud", "worker": "a" * 32, "workerSession": session,
                "claim": f"background-{i}", "lease": time.time() - 100})
        reply = self.poll(session=session)
        self.assertFalse(any(item["id"] in {f"{i + 100:032x}" for i in range(100)} for item in reply["jobs"]))
        saved = next(item for item in self.database.studio_records("job") if item["id"] == f"{100:032x}")
        self.assertTrue(saved["claim"].startswith("background-"))
        # A stopped/restarted client uses a new session and can recover those
        # old leases; the worker's shared identity alone cannot keep them stuck.
        for item in self.database.studio_records("job"):
            if item.get("stage") != "saving-cloud":
                item.update(status="complete")
                self.database.studio_add("job", item)
        recovered = self.poll(session="e" * 32)["jobs"]
        self.assertEqual(len(recovered), 12)
        self.assertTrue(all(item["workerSession"] == "e" * 32 for item in recovered))
