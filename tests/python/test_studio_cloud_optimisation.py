from __future__ import annotations
from tests.python.library_test_support import *


class StudioCloudOptimisationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.item = self.file("one", "Films/Iron Man (2008).mkv", 11 * 1024 ** 3)
        self.library.studio_cloud_files = [self.item]
        self.metadata = {"title": "Iron Man", "year": "2008", "media_type": "movie", "tmdb_id": 1726, "runtime": 126}
        self.library.studio_cloud_title_for_file = lambda _: {"id": "one", "title": "Iron Man", "metadata": self.metadata}

    def file(self, identity, path, size):
        return {"id": identity, "path": path, "name": Path(path).name, "folder": str(Path(path).parent),
                "kind": "video", "extension": Path(path).suffix, "bytes": size,
                "modified": "2026-11-02T00:00:00Z", "remoteId": "remote-" + identity}

    def tearDown(self):
        self.fixture.close()

    def payload(self):
        return {"sources": [{"type": "cloud", **{k: self.item[k] for k in ["id", "bytes", "modified", "remoteId"]}}],
                "destination": {"kind": "icloud", "optimiseCloud": True, "cloudCopies": "optimised"},
                "replaceCloudOriginal": True}

    def test_preview_explains_container_original_size_and_selected_size_target(self):
        preview = self.library.studio_cloud_optimise_preview({"ids": ["one"]})
        file = preview["files"][0]
        self.assertEqual((file["type"], file["bytes"]), ("MKV", 11 * 1024 ** 3))
        self.assertEqual(file["estimatedBytes"], int(self.item["bytes"] * .4 * .98))
        self.assertEqual(preview["compression"], "compact")
        self.assertIn("1080p", preview["output"])
        self.assertEqual(file["remoteId"], self.item["remoteId"])

    def test_size_target_is_available_even_without_catalogue_duration(self):
        self.metadata = {}
        preview = self.library.studio_cloud_optimise_preview({"ids": ["one"]})
        self.assertEqual(preview["files"][0]["estimatedBytes"], int(self.item["bytes"] * .4 * .98))

    def test_each_profile_estimate_and_job_choice_survive_a_worker_restart(self):
        for name, fraction in [("balanced", .6), ("compact", .4), ("smallest", .25)]:
            preview = self.library.studio_cloud_optimise_preview({"ids": ["one"], "compression": name})
            self.assertEqual(preview["files"][0]["estimatedBytes"], int(self.item["bytes"] * fraction * .98))
        payload = self.payload()
        payload["destination"]["compression"] = "smallest"
        identity = self.library.studio_add_jobs(payload)["ids"][0]
        self.assertIsNone(self.library.studio_worker_poll({"id": "d" * 32, "capabilities": ["cloud-optimise"]})["job"])
        worker = {"id": "e" * 32, "capabilities": ["cloud-optimise", "compression-presets", "intel-policy-v2"]}
        first = self.library.studio_worker_poll(worker)["job"]
        self.assertEqual(first["destination"]["compression"], "smallest")
        first.update(lease=0)
        self.library.state_database.studio_add("job", first)
        resumed = self.library.studio_worker_poll({**worker, "id": "f" * 32})["job"]
        self.assertEqual((resumed["id"], resumed["destination"]["compression"]), (identity, "smallest"))

    def test_invalid_profile_is_rejected_before_creating_a_job(self):
        payload = self.payload()
        payload["destination"]["compression"] = "unknown"
        with self.assertRaisesRegex(ValueError, "Choose Balanced"):
            self.library.studio_add_jobs(payload)
        self.assertEqual(self.library.state_database.studio_records("job"), [])

    def test_prepared_copy_uses_original_size_basis_and_is_not_repeatedly_shrunk(self):
        original = self.item["bytes"]
        self.item["bytes"] = int(original * .39)
        self.library.state_database.studio_save_cloud_metadata({"id": "one", "encodingProfile": "compact",
            "encodingSourceBytes": original, "fingerprint": self.library._studio_title_fingerprint(self.item)}, self.metadata, automatic=True)
        compact = self.library.studio_cloud_optimise_preview({"ids": ["one"], "compression": "compact"})["files"][0]
        self.assertTrue(compact["alreadyMeetsTarget"])
        self.assertEqual(compact["estimatedBytes"], self.item["bytes"])
        smaller = self.library.studio_cloud_optimise_preview({"ids": ["one"], "compression": "smallest"})["files"][0]
        self.assertEqual(smaller["estimatedBytes"], int(original * .25 * .98))

    def test_cloud_only_replacement_requires_exact_version_and_explicit_consent(self):
        payload = self.payload()
        payload["replaceCloudOriginal"] = False
        with self.assertRaisesRegex(ValueError, "Confirm"):
            self.library.studio_add_jobs(payload)
        payload = self.payload()
        payload["sources"][0]["bytes"] -= 1
        with self.assertRaisesRegex(ValueError, "Confirm"):
            self.library.studio_add_jobs(payload)
        result = self.library.studio_add_jobs(self.payload())
        job = self.library.state_database.studio_records("job")[0]
        self.assertEqual(result["ids"], [job["id"]])
        self.assertEqual(job["destination"]["kind"], "icloud")
        self.assertTrue(job["destination"]["prepare"])
        self.assertTrue(job["destination"]["replaceCloudOriginal"])

    def test_cloud_replacement_does_not_enable_an_unconfirmed_general_cloud_destination(self):
        payload = self.payload()
        del payload["destination"]["optimiseCloud"]
        with self.assertRaisesRegex(ValueError, "already in iCloud"):
            self.library.studio_add_jobs(payload)

    def test_older_companions_cannot_claim_cloud_optimisation(self):
        self.library.studio_add_jobs(self.payload())
        old = self.library.studio_worker_poll({"id": "d" * 32, "capabilities": ["torrent"]})
        self.assertIsNone(old["job"])
        new = self.library.studio_worker_poll({"id": "e" * 32, "capabilities": ["torrent", "cloud-optimise", "intel-policy-v2"]})
        self.assertTrue(new["job"]["destination"]["optimiseCloud"])
        payload = self.payload()
        payload["sources"] = [{"type": "iplayer", "pid": "m0000001"}]
        with self.assertRaisesRegex(ValueError, "existing iCloud"):
            self.library.studio_add_jobs(payload)

    def test_larger_output_cannot_delete_the_cloud_original(self):
        self.library.studio_add_jobs(self.payload())
        job = self.library.state_database.studio_records("job")[0]
        job.update(status="active", claim="claim")
        self.library.state_database.studio_add("job", job)
        output = self.file("new", "Films/Optimised.mp4", self.item["bytes"] + 1)
        self.library.studio_cloud_files.append(output)
        self.library.state_database.studio_save_cloud_metadata({"id": "new", "publicationJob": job["id"],
            "variants": ["optimised"], "files": []}, self.metadata, automatic=True)
        self.library._studio_cloud_stat = lambda _: {"ID": output["remoteId"], "Size": output["bytes"], "ModTime": output["modified"]}
        self.library._studio_cloud_command = mock.Mock()
        with self.assertRaisesRegex(ValueError, "would not save space"):
            self.library.studio_cloud_replace_original({"job": job["id"], "claim": "claim", "output": "new"})
        self.library._studio_cloud_command.assert_not_called()

    def test_size_and_release_sort_apply_before_pagination(self):
        self.library.studio_cloud_files = [self.file(str(i), f"Films/Film {i} (2008).mkv", i + 1) for i in range(105)]
        first = self.library.studio_cloud_catalogue({"sort": ["size-desc"]})
        self.assertEqual((first["items"][0]["bytes"], len(first["items"])), (105, 100))
        second = self.library.studio_cloud_catalogue({"sort": ["size-desc"], "offset": ["100"]})
        self.assertEqual([item["bytes"] for item in second["items"]], [5, 4, 3, 2, 1])
        self.library.studio_cloud_files += [self.file("newest", "Films/New film (2025).mkv", 1)]
        self.assertEqual(self.library.studio_cloud_catalogue({"sort": ["date-desc"]})["items"][0]["year"], "2025")
