from tests.python.library_test_support import *


class StudioCollectionsTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.studio_cloud_files = [
            self.file('one', 'Films/Harry Potter/First.mp4'),
            self.file('two', 'Films/Second.mp4'),
            self.file('ep', 'TV/Example/Season 1/Example S01E01.mp4'),
        ]

    def tearDown(self):
        self.fixture.close()

    @staticmethod
    def file(identity, path):
        return {'id': identity, 'path': path, 'folder': str(Path(path).parent).replace('\\', '/'),
                'name': path.split('/')[-1], 'kind': 'video', 'bytes': 100,
                'modified': 'same', 'extension': '.mp4', 'remoteId': identity}

    def test_existing_cloud_folders_and_new_collections_filter_without_changing_local_library(self):
        before = self.library.my_tv_folders()
        cloud = self.library.studio_cloud_catalogue({})
        self.assertEqual(cloud['collections'], ['Harry Potter'])
        self.library.studio_cloud_collection({'ids': ['two'], 'collection': 'Weekend', 'create': True})
        selected = self.library.studio_cloud_catalogue({'collection': ['Weekend']})
        self.assertEqual([item['id'] for item in selected['items']], ['two'])
        self.assertEqual(self.library.my_tv_folders(), before)
        self.assertEqual(self.library.studio_cloud_files[1]['path'], 'Films/Second.mp4')
        reopened = type(self.library.state_database)(self.fixture.database)
        self.assertTrue(any(item['collection'] == 'Weekend' for item in reopened.studio_records('cloudmembership')))

    def test_series_membership_survives_a_cloud_folder_rename(self):
        series = next(item for item in self.library.studio_cloud_catalogue({})['items'] if item['kind'] == 'series')
        self.library.studio_cloud_collection({'ids': [series['id']], 'collection': 'Shows', 'create': True})
        self.library.studio_cloud_files[2] = self.file('ep', 'TV/Renamed/Season 1/Example S01E01.mp4')
        selected = self.library.studio_cloud_catalogue({'collection': ['Shows']})
        self.assertEqual(len(selected['items']), 1)
        self.assertEqual(selected['items'][0]['collection'], 'Shows')

    def test_unfiled_overrides_inherited_folder_and_revision_changes(self):
        before = self.library.studio_cloud_status()['collectionRevision']
        self.library.studio_cloud_collection({'ids': ['one'], 'collection': ''})
        selected = self.library.studio_cloud_catalogue({'collection': ['']})
        self.assertEqual({item['id'] for item in selected['items'] if item['kind'] != 'series'}, {'one', 'two'})
        self.assertGreater(self.library.studio_cloud_status()['collectionRevision'], before)

    def test_invalid_or_stale_batch_does_not_create_partial_membership(self):
        for payload in [
            {'ids': ['one', 'missing'], 'collection': 'Weekend', 'create': True},
            {'ids': ['one'], 'collection': '../unsafe', 'create': True},
            {'ids': ['one'], 'collection': 'Unknown'},
            {'ids': [], 'collection': 'Weekend', 'create': True},
        ]:
            with self.assertRaises(ValueError):
                self.library.studio_cloud_collection(payload)
        self.assertEqual(self.library.state_database.studio_records('cloudcollection'), [])
        self.assertEqual(self.library.state_database.studio_records('cloudmembership'), [])

    def test_destination_collection_names_are_scoped_to_their_library_and_old_workers_wait(self):
        (self.library.my_tv_root / 'Local favourites').mkdir(parents=True)
        self.library.studio_cloud_collection({'ids': ['two'], 'collection': 'Cloud favourites', 'create': True})
        for kind, good, wrong in [('film', 'Local favourites', 'Cloud favourites'), ('icloud', 'Cloud favourites', 'Local favourites')]:
            self.assertEqual(self.library.studio_destination({'kind': kind, 'collection': good})['collection'], good)
            with self.assertRaises(ValueError):
                self.library.studio_destination({'kind': kind, 'collection': wrong})
        self.library.studio_add_jobs({'sources': [{'type': 'iplayer', 'pid': 'm0000001'}],
                                     'destination': {'kind': 'film', 'collection': 'Local favourites'}})
        self.assertIsNone(self.library.studio_worker_poll({'id': 'a' * 32})['job'])
        claimed = self.library.studio_worker_poll({'id': 'a' * 32, 'capabilities': ['library-collections']})['job']
        self.assertEqual(claimed['destination']['collection'], 'Local favourites')

    def test_confirmed_cloud_versions_inherit_the_selected_collection_without_moving_files(self):
        identity = 'a' * 32
        self.library.state_database.studio_add('job', {'id': identity, 'destination': {'kind': 'icloud', 'collection': 'Weekend'}})
        item = self.library.studio_cloud_files[1]
        self.library.studio_cloud_archive_metadata(item, {'publicationJob': identity, 'archiveGroup': 'b' * 32, 'variants': ['original']})
        selected = self.library.studio_cloud_catalogue({'collection': ['Weekend']})
        self.assertEqual([value['id'] for value in selected['items']], ['two'])
        self.assertEqual(item['path'], 'Films/Second.mp4')

    def test_series_collection_change_keeps_episode_paths_and_metadata_and_survives_reopen(self):
        identity = self.library.create_my_tv_series('Example show')
        root = self.library.my_tv_series_root / identity
        (root / 'S01E01.mp4').write_bytes(b'video')
        (self.library.my_tv_root / 'Weekend').mkdir(parents=True, exist_ok=True)
        before = self.library.my_tv_series_library()[0]
        revisions = self.library.state_database.revisions()
        with mock.patch.object(self.library, 'refresh_tv') as refresh:
            self.library.manage({'action': 'move-my-tv-series-collection', 'series': identity, 'folder': 'Weekend'})
            refresh.assert_not_called()
        after = self.library.my_tv_series_library()[0]
        self.assertEqual(after['folder'], 'Weekend')
        self.assertEqual(after['episodes'], before['episodes'])
        self.assertTrue((root / 'S01E01.mp4').is_file())
        self.assertGreater(self.library.state_database.revisions()['library'], revisions['library'])
        reopened = type(self.library.state_database)(self.fixture.database)
        self.assertEqual(reopened.read('my_tv_series')['series'][identity]['folder'], 'Weekend')
