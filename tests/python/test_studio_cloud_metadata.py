from __future__ import annotations
from tests.python.library_test_support import *


class StudioCloudMetadataTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.database = self.library.state_database
        self.library.studio_cloud_files = [self.file('one', 'Films/Arrival.2016.1080p.mkv')]

    def tearDown(self):
        self.fixture.close()

    def file(self, identity, path, kind='video'):
        return {'id': identity, 'path': path, 'name': path.split('/')[-1], 'folder': str(Path(path).parent),
                'kind': kind, 'bytes': 100, 'modified': '2026-01-01', 'extension': Path(path).suffix}

    def tmdb(self, endpoint, query):
        if endpoint == 'search/multi':
            return {'results': [{'media_type': 'movie', 'id': 329865, 'title': 'Arrival', 'release_date': '2016-11-10'}]}
        return {'title': 'Arrival', 'release_date': '2016-11-10', 'poster_path': '/arrival.jpg',
                'overview': 'A linguist makes contact.', 'runtime': 116}

    def test_title_ownership_checks_whole_catalogue_and_distinguishes_remakes(self):
        query = {'tmdb_id': ['329865'], 'media_type': ['movie'], 'title': ['Arrival'], 'year': ['2016']}
        self.assertEqual(self.library.studio_cloud_catalogue(query)['total'], 1)
        self.assertEqual(self.library.studio_cloud_catalogue({**query, 'year': ['1996']})['total'], 0)
        self.assertEqual(self.library.studio_cloud_catalogue({**query, 'media_type': ['tv']})['total'], 0)
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request', side_effect=self.tmdb):
            self.library.studio_cloud_match({'id': 'one', 'automatic': True})
        self.assertEqual(self.library.studio_cloud_catalogue({**query, 'title': ['Another title']})['total'], 1)
        self.assertEqual(self.library.studio_cloud_catalogue({**query, 'tmdb_id': ['999']})['total'], 0)

    def test_catalogue_only_contains_video_titles_in_films_tv_and_kids(self):
        self.library.studio_cloud_files += [self.file('audio', 'Audiobooks/Book.mp4'),
            self.file('family', 'Family Videos/Holiday.mp4'), self.file('podcast', 'Podcasts & Radio/Show.mp4'),
            self.file('audio2', 'Films/Book.m4b', 'audio'), self.file('kids', 'Kids/Paddington.mp4'),
            self.file('ep1', 'TV/Ludwig/Season 1/Ludwig S01E01.mp4'),
            self.file('ep2', 'TV/Ludwig/Season 2/Ludwig S02E01.mp4')]
        all_titles = self.library.studio_cloud_catalogue({})['items']
        self.assertEqual(len(all_titles), 3)
        self.assertEqual({i['category'] for i in all_titles}, {'films', 'tv', 'kids'})
        film = self.library.studio_cloud_catalogue({'category': ['films']})['items'][0]
        self.assertEqual((film['title'], film['year']), ('Arrival', '2016'))
        series = self.library.studio_cloud_catalogue({'category': ['tv']})['items'][0]
        self.assertEqual((series['title'], series['episode_count']), ('Ludwig', 2))
        with self.assertRaises(ValueError):
            self.library.studio_cloud_catalogue({'category': ['audio']})

    def test_tv_extras_and_specials_stay_with_the_show_without_moving_files(self):
        paths = ['TV/The Office (UK)/Season 01/The Office S01E01.avi',
                 'TV/The Office (UK)/Extras/Bloopers.avi',
                 'TV/The Office (UK)/Specials/Christmas Special Part 1.avi',
                 'TV/The Office (UK)/Specials/Christmas Special Part 2.avi']
        self.library.studio_cloud_files += [self.file(str(i), path) for i, path in enumerate(paths)]
        films = self.library.studio_cloud_catalogue({'category': ['films']})['items']
        self.assertEqual([item['id'] for item in films], ['one'])
        show = self.library.studio_cloud_catalogue({'category': ['tv']})['items'][0]
        self.assertEqual(show['path'], 'TV/The Office (UK)')
        self.assertEqual(show['episode_count'], 4)
        episodes = self.library.studio_cloud_catalogue({'series': [show['id']]})['items']
        self.assertEqual({item['path'] for item in episodes}, set(paths))
        self.assertEqual([item['series'] for item in episodes], [0, 0, 0, 1])
        self.assertFalse(show['virtualSeries'])

    def test_kids_tv_bonus_files_group_but_film_extras_do_not_become_tv(self):
        self.library.studio_cloud_files = [self.file('bonus', 'Kids/TV/Puffin Rock/Extras/Behind the scenes.mp4'),
                                         self.file('film', 'Films/Arrival/Extras/Featurette.mp4')]
        titles = self.library.studio_cloud_catalogue({})['items']
        self.assertEqual([(item['kind'], item['category']) for item in titles], [('video', 'films'), ('series', 'kids')])

    def test_automatic_match_persists_canonical_metadata_without_publishing_or_player_refresh(self):
        self.library.refresh_tv = mock.Mock()
        revision = self.database.revisions()['settings']
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request', side_effect=self.tmdb):
            item = self.library.studio_cloud_match({'id': 'one', 'automatic': True})['item']
        self.assertEqual(item['metadata']['poster_path'], '/arrival.jpg')
        reopened = type(self.database)(self.fixture.database)
        record = reopened.studio_cloud_metadata_records()['one']
        self.assertEqual(record['metadata']['overview'], 'A linguist makes contact.')
        stored = reopened.studio_records('cloudmetadata')[0]
        self.assertNotIn('poster_path', stored)
        self.assertNotIn('metadata', stored)
        db = reopened.connect()
        try:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM my_tv_titles').fetchone()[0], 0)
        finally:
            db.close()
        self.library.refresh_tv.assert_not_called()
        self.assertEqual(self.database.revisions()['settings'], revision)
        self.assertEqual(reopened.integrity_report()['foreign_key_errors'], [])

    def test_ambiguous_or_inexact_matches_require_a_choice(self):
        for candidates in [[], [{'media_type': 'movie', 'id': 1, 'title': 'The Arrival', 'release_date': '2016'}],
                           [{'media_type': 'movie', 'id': n, 'title': 'Arrival', 'release_date': '2016'} for n in [1, 2]]]:
            with mock.patch.object(self.library, 'my_tv_cached_tmdb_request', return_value={'results': candidates}):
                result = self.library.studio_cloud_match({'id': 'one', 'automatic': True, 'retry': True})['item']
            self.assertIsNone(result['metadata'])
            self.assertEqual(result['match_status'], 'unmatched')

    def test_explicit_correction_survives_automatic_retry_and_settings_replacement(self):
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request', side_effect=self.tmdb):
            self.library.studio_cloud_match({'id': 'one', 'match': {'media_type': 'movie', 'tmdb_id': 329865}})
        self.library.write_state('settings', {'volume': {'maximum': 60}})
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request') as request:
            result = self.library.studio_cloud_match({'id': 'one', 'automatic': True, 'retry': True})
        request.assert_not_called()
        self.assertEqual(result['item']['metadata']['tmdb_id'], 329865)

    def test_changed_file_requires_new_match_and_removed_titles_cannot_be_matched(self):
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request', side_effect=self.tmdb):
            self.library.studio_cloud_match({'id': 'one', 'automatic': True})
        self.library.studio_cloud_files[0]['bytes'] = 200
        self.assertIsNone(self.library.studio_cloud_catalogue({})['items'][0]['metadata'])
        self.library.studio_cloud_files.clear()
        with self.assertRaises(ValueError):
            self.library.studio_cloud_match({'id': 'one', 'automatic': True})

    def test_batch_jobs_take_the_correct_cloud_metadata_for_each_source(self):
        self.library.studio_cloud_files.append(self.file('two', 'Films/Another.mp4'))
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request', side_effect=self.tmdb):
            self.library.studio_cloud_match({'id': 'one', 'match': {'media_type': 'movie', 'tmdb_id': 329865}})
            self.library.studio_cloud_match({'id': 'two', 'match': {'media_type': 'movie', 'tmdb_id': 123}})
        self.library.studio_add_jobs({'sources': [{'type': 'cloud', 'id': i} for i in ['one', 'two']],
            'destination': {'kind': 'film'}})
        jobs = self.database.studio_records('job')
        self.assertEqual({j['source']['id']: j['match']['tmdb_id'] for j in jobs}, {'one': 329865, 'two': 123})

    def test_non_video_is_rejected_even_for_download_only(self):
        self.library.studio_cloud_files.append(self.file('book', 'Audiobooks/Book.m4b', 'audio'))
        with self.assertRaises(ValueError):
            self.library.studio_add_jobs({'sources': [{'type': 'cloud', 'id': 'book'}],
                'destination': {'kind': 'local', 'prepare': False}})

    def test_cloud_items_cannot_be_sent_back_to_icloud(self):
        with self.assertRaisesRegex(ValueError,'already in iCloud'):
            self.library.studio_add_jobs({'sources':[{'type':'cloud','id':'one'}], 'destination':{'kind':'icloud'}})


if __name__ == '__main__':
    unittest.main()
