from __future__ import annotations
from tests.python.library_test_support import *

from mabeltv_backend.studio_cloud_filing import component
from mabeltv_backend import studio_organiser_model as model


class StudioOrganiserTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.database = self.library.state_database
        key = self.fixture.root / 'secrets' / 'openai' / 'api-key'
        key.parent.mkdir(parents=True)
        key.write_text('sk-unit-test-only')
        self.library.studio_cloud_checked = time.time()
        self.library.studio_cloud_files = [self.file('one', 'Films/Arrival.2016/Arrival.2016.mkv'),
                                         self.file('sub', 'Films/Arrival.2016/Arrival.2016.en.srt', 'file')]
        self.remote = {f'Media/{item["path"]}': self.stat(item) for item in self.library.studio_cloud_files}
        self.commands = []
        self.library._studio_cloud_stat_optional = lambda path: self.remote.get(path)
        self.library._studio_cloud_stat = lambda path: self.remote[path]
        self.library._studio_rclone = mock.Mock(return_value={'Features': {'Move': True}})
        self.library._studio_cloud_command = self.command
        self.library.my_tv_cached_tmdb_request = mock.Mock(side_effect=self.tmdb)

    def tearDown(self):
        self.fixture.close()

    def file(self, identity, path, kind='video'):
        return {'id': identity, 'path': path, 'name': path.split('/')[-1], 'folder': str(Path(path).parent),
                'kind': kind, 'bytes': 100, 'modified': '2026-01-01', 'remoteId': 'remote-' + identity,
                'extension': Path(path).suffix}

    def stat(self, item):
        return {'ID': item['remoteId'], 'Size': item['bytes'], 'ModTime': item['modified'], 'IsDir': False}

    def command(self, args):
        self.commands.append(args)
        self.assertEqual(args[0], 'moveto')
        self.assertIn('--ignore-existing', args)
        self.assertEqual(args[args.index('--max-transfer') + 1], '1B')
        source, target = args[1][len('mabeltv_icloud:'):], args[2][len('mabeltv_icloud:'):]
        if target not in self.remote:
            self.remote[target] = self.remote.pop(source)

    def tmdb(self, endpoint, query):
        if endpoint == 'search/multi':
            return {'results': [{'id': 329865, 'media_type': 'movie', 'title': 'Arrival', 'release_date': '2016-11-10'}]}
        return {'id': 329865, 'title': 'Arrival', 'release_date': '2016-11-10', 'poster_path': '/arrival.jpg',
                'overview': 'A linguist makes contact.', 'runtime': 116,
                'credits': {'crew': [{'job': 'Director', 'name': 'Denis Villeneuve'}]}}

    def step(self):
        self.library.studio_organiser_after = 0
        self.library.studio_organiser_step()

    def test_film_and_subtitles_move_without_conversion_and_keep_metadata(self):
        self.library.refresh_tv = mock.Mock()
        revision = self.database.revisions()['settings']
        with mock.patch('mabeltv_backend.studio_organiser.title_hint') as ai:
            self.step()
        ai.assert_not_called()
        self.assertEqual(len(self.commands), 2)
        paths = {item['path'] for item in self.library.studio_cloud_files}
        self.assertEqual(paths, {'Films/Arrival.2016.mkv', 'Films/Arrival.2016.en.srt'})
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.assertEqual(title['metadata']['tmdb_id'], 329865)
        self.assertEqual(self.database.studio_records('filing')[0]['status'], 'complete')
        self.assertEqual(self.database.revisions()['settings'], revision)
        self.library.refresh_tv.assert_not_called()
        self.assertEqual(self.database.integrity_report()['foreign_key_errors'], [])
        self.assertIn('credits,release_dates', self.library.my_tv_cached_tmdb_request.call_args.args[1]['append_to_response'])

    def test_confirmed_match_survives_renaming_but_not_a_changed_file(self):
        self.library.studio_cloud_match({'id': 'one', 'match': {'tmdb_id': 329865, 'media_type': 'movie'}})
        self.step()
        with mock.patch.object(self.library, 'my_tv_cached_tmdb_request') as provider:
            title = self.library.studio_cloud_match({'id': 'one', 'automatic': True, 'retry': True})['item']
        provider.assert_not_called()
        self.assertTrue(title['metadata_confirmed'])
        self.assertEqual(title['metadata']['tmdb_id'], 329865)
        self.library.studio_cloud_files[0]['modified'] = '2026-01-02'
        self.assertIsNone(self.library.studio_cloud_catalogue({})['items'][0]['metadata'])

    def test_mcu_numbering_survives_flattening_and_future_catalogue_checks(self):
        source = self.file('one', 'Films/Marvel Cinematic Universe/01 - Iron Man (2008)/Iron Man (2008).mkv')
        self.library.studio_cloud_files = [source]
        title = self.library.studio_cloud_catalogue({})['items'][0]
        title['metadata'] = {'title': 'Iron Man', 'year': '2008', 'media_type': 'movie'}
        details = {'belongs_to_collection': {'id': 131292, 'name': 'Iron Man Collection'}}
        plan = self.library.studio_filing_plan(title, details)
        self.assertEqual(plan[0]['target'], 'Films/MCU/01 - Iron Man (2008).mkv')
        source.update(path=plan[0]['target'], name='01 - Iron Man (2008).mkv')
        self.assertEqual(self.library.studio_filing_plan(title, details), [])

    def test_filing_policy_change_reuses_uncertain_ai_decision(self):
        self.library.studio_cloud_files[0]['name'] = 'opaque-name.mkv'
        with mock.patch('mabeltv_backend.studio_organiser.title_hint', return_value={'title': ''}) as ai:
            self.step()
            self.assertEqual(ai.call_count, 1)
            with mock.patch('mabeltv_backend.studio_organiser.POLICY_VERSION', 999):
                self.step()
            self.assertEqual(ai.call_count, 1)

    def test_second_franchise_film_groups_both_and_removing_it_flattens_the_survivor(self):
        first = self.file('blade', 'Films/Blade Runner (1982).mkv')
        second = self.file('blade2', 'Films/Blade Runner 2049 (2017).mkv')
        self.library.studio_cloud_files = [first]
        self.remote = {'Media/'+first['path']: self.stat(first)}
        entries = {78: ('Blade Runner','1982'), 335984: ('Blade Runner 2049','2017')}
        collection = {'id': 422837, 'name': 'Blade Runner Collection'}
        def catalogue(endpoint, query):
            if endpoint == 'search/multi':
                return {'results': [{'id': identity, 'media_type':'movie', 'title':name, 'release_date':year+'-01-01'}
                    for identity,(name,year) in entries.items() if query['query'] == name]}
            identity = int(endpoint.split('/')[1])
            name, year = entries[identity]
            return {'id':identity,'title':name,'release_date':year+'-01-01','belongs_to_collection':collection}
        self.library.my_tv_cached_tmdb_request = mock.Mock(side_effect=catalogue)
        with mock.patch('mabeltv_backend.studio_organiser.title_hint') as ai:
            self.step()
            self.assertFalse(self.commands)
            self.library.studio_cloud_files.append(second)
            self.remote['Media/'+second['path']] = self.stat(second)
            self.step()
            self.step()
            self.assertEqual({item['path'] for item in self.library.studio_cloud_files},
                {'Films/Blade Runner/Blade Runner (1982).mkv','Films/Blade Runner/Blade Runner 2049 (2017).mkv'})
            self.library.studio_cloud_files = [item for item in self.library.studio_cloud_files if item['id'] != 'blade2']
            self.remote.pop('Media/Films/Blade Runner/Blade Runner 2049 (2017).mkv')
            self.step()
            self.assertEqual(self.library.studio_cloud_files[0]['path'], 'Films/Blade Runner (1982).mkv')
        ai.assert_not_called()

    def test_uncertain_model_answer_does_not_move_or_invent_metadata(self):
        self.library.studio_cloud_files[0]['name'] = 'opaque-name.mkv'
        with mock.patch('mabeltv_backend.studio_organiser.title_hint', return_value={'title': 'Arrival'}), \
             mock.patch('mabeltv_backend.studio_organiser.choose_title', return_value=None):
            self.step()
        self.assertFalse(self.commands)
        self.assertFalse(self.database.studio_cloud_metadata_records())
        self.assertEqual(self.database.studio_records('organiser')[0]['status'], 'unmatched')
        self.step()
        self.assertFalse(self.commands)

    def test_ai_choice_is_filled_from_verified_catalogue_details(self):
        self.library.studio_cloud_files[0]['name'] = 'Arrival-released.mkv'
        with mock.patch('mabeltv_backend.studio_organiser.title_hint', return_value={'title': 'Arrival'}), \
             mock.patch('mabeltv_backend.studio_organiser.choose_title', return_value={'tmdb_id': 329865, 'media_type': 'movie', 'year': '2016', 'title': 'Invented name'}):
            self.step()
        record = self.database.studio_cloud_metadata_records()['one']
        self.assertEqual(record['metadata']['title'], 'Arrival')
        self.assertEqual(record['metadata']['year'], '2016')

    def test_destination_collision_keeps_both_files(self):
        title = self.library.studio_cloud_catalogue({})['items'][0]
        title['metadata'] = {'title': 'Arrival', 'year': '2016', 'media_type': 'movie'}
        plan = self.library.studio_filing_plan(title, {})
        self.remote['Media/' + plan[0]['target']] = {**self.remote['Media/' + plan[0]['source']], 'ID': 'different'}
        with self.assertRaisesRegex(ValueError, 'Both files were kept'):
            self.library.studio_filing(title, {})
        self.assertFalse(self.commands)
        self.assertIn('Media/Films/Arrival.2016/Arrival.2016.mkv', self.remote)

    def test_changed_source_does_not_move(self):
        self.remote['Media/Films/Arrival.2016/Arrival.2016.mkv']['Size'] = 200
        self.step()
        self.assertFalse(self.commands)
        self.assertEqual(self.library.studio_organiser_status()['status'], 'failed')

    def test_lost_acknowledgement_recovers_existing_move_without_overwrite(self):
        title = self.library.studio_cloud_catalogue({})['items'][0]
        title['metadata'] = {'title': 'Arrival', 'year': '2016', 'media_type': 'movie'}
        plan = self.library.studio_filing_plan(title, {})
        first = plan[0]
        self.remote['Media/' + first['target']] = self.remote.pop('Media/' + first['source'])
        operation = {'id': 'recovery', 'policy': 3, 'title': 'Arrival', 'status': 'active', 'items': plan,
                     'completed': 0, 'created': time.time()}
        self.database.studio_add('filing', operation)
        self.assertTrue(self.library.studio_filing_resume(operation))
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(operation['completed'], 2)

    def test_non_server_side_backend_is_rejected(self):
        self.library._studio_rclone.return_value = {'Features': {'Move': False}}
        self.step()
        self.assertFalse(self.commands)
        self.assertIn('No videos were transferred', self.library.studio_organiser_status()['message'])

    def test_queued_or_paused_source_is_not_relocated(self):
        self.database.studio_add_jobs([{'id': 'job', 'fingerprint': 'job', 'title': 'Arrival', 'source': {'id': 'one', 'type': 'cloud'},
            'status': 'paused', 'created': time.time(), 'destination': {'kind': 'film'}}])
        self.step()
        self.assertFalse(self.commands)
        self.library.my_tv_cached_tmdb_request.assert_not_called()

    def test_new_archive_matches_while_active_but_filing_waits_for_publication(self):
        job = {'id': 'a'*32, 'fingerprint': 'archive', 'title': 'Arrival', 'source': {'type': 'iplayer', 'pid': 'm0000001'},
               'status': 'active', 'created': time.time(), 'destination': {'kind': 'film'}}
        self.database.studio_add_jobs([job])
        self.library.studio_cloud_archive_metadata(self.library.studio_cloud_files[0],
            {'publicationJob': job['id'], 'variants': ['original'], 'archiveGroup': 'b'*32, 'title': 'Arrival'})
        self.step()
        self.assertFalse(self.commands)
        self.assertEqual(self.library.studio_cloud_item('one')['metadata']['tmdb_id'], 329865)
        calls = self.library.my_tv_cached_tmdb_request.call_count
        self.step()
        self.assertEqual(self.library.my_tv_cached_tmdb_request.call_count, calls)
        self.database.studio_add('job', {**job, 'status': 'complete'})
        self.step()
        self.assertTrue(self.commands)

    def test_unconfirmed_reserved_archive_is_not_relocated_while_its_receipt_is_pending(self):
        job={'id':'a'*32,'fingerprint':'pending-archive','title':'Arrival','source':{'type':'iplayer','pid':'m0000001'},
             'status':'active','created':time.time(),'destination':{'kind':'film'}}
        self.database.studio_add_jobs([job])
        self.database.studio_add('archiveintent',{'id':'intent','publicationJob':job['id'],
            'path':self.library.studio_cloud_files[0]['path'],'status':'pending'})
        self.step()
        self.assertFalse(self.commands)
        self.library.my_tv_cached_tmdb_request.assert_not_called()

    def test_series_remains_grouped_after_a_recoverable_root_change(self):
        self.library.studio_cloud_files = [self.file('ep1', 'TV/Ludwig/Season 0/Ludwig S00E01.mp4'),
                                         self.file('ep2', 'TV/Ludwig/Season 2/Ludwig S02E03.mp4')]
        original_paths = {item['id']: item['path'] for item in self.library.studio_cloud_files}
        for item in self.library.studio_cloud_files:
            item['path'] = item['path'].replace('TV/Ludwig/', 'TV/Ludwig (2024)/')
        self.database.studio_add('filing', {'id':'legacy', 'status':'complete', 'created':0,
            'items':[{'id':item['id'],'source':original_paths[item['id']],'target':item['path']} for item in self.library.studio_cloud_files]})
        self.remote = {f'Media/{item["path"]}': self.stat(item) for item in self.library.studio_cloud_files}
        details = {'name': 'Ludwig', 'first_air_date': '2024-09-25'}
        self.library.my_tv_cached_tmdb_request.side_effect = lambda endpoint, query: details
        original = self.library.studio_cloud_catalogue({})['items'][0]
        self.library.studio_cloud_match({'id': original['id'], 'match': {'tmdb_id': 123, 'media_type': 'tv'}})
        self.step()
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.assertNotEqual(title['id'], original['id'])
        self.assertEqual(title['episode_count'], 2)
        self.assertEqual(title['metadata']['tmdb_id'], 123)
        self.assertTrue(title['metadata_confirmed'])
        self.assertEqual(self.library.studio_cloud_files[0]['path'],original_paths['ep1'])
        self.assertEqual(self.library.studio_cloud_files[1]['path'],original_paths['ep2'])

    def test_finished_bbc_job_resolves_an_opaque_pid_filename(self):
        self.library.studio_cloud_files = [self.file('one', 'MabelTV Studio/download/b01pzqj3.mp4')]
        self.database.studio_add_jobs([{'id': 'download', 'fingerprint': 'bbc', 'title': 'Arrival',
            'source': {'type': 'iplayer'}, 'status': 'complete', 'created': time.time(),
            'destination': {'kind': 'mabel'}, 'savedCloudPath': 'MabelTV Studio/download/b01pzqj3.mp4'}])
        self.remote = {f'Media/{item["path"]}': self.stat(item) for item in self.library.studio_cloud_files}
        self.step()
        self.assertEqual(self.library.studio_cloud_catalogue({})['items'][0]['metadata']['tmdb_id'], 329865)

    def test_no_key_does_not_start_an_organiser(self):
        (self.fixture.root / 'secrets' / 'openai' / 'api-key').unlink()
        self.step()
        self.library.my_tv_cached_tmdb_request.assert_not_called()
        self.assertIsNone(self.library.studio_organiser_status())

    def test_stopped_or_abandoned_work_does_not_linger_as_active(self):
        self.database.studio_add('organiserstatus',{'id':'current','status':'active','updated':time.time()-3600})
        self.assertEqual(self.library.studio_organiser_status()['status'],'cancelled')
        self.database.studio_add('organiserstatus',{'id':'current','status':'active','updated':time.time()})
        (self.fixture.root/'secrets/openai/api-key').unlink()
        self.assertEqual(self.library.studio_organiser_status()['status'],'cancelled')

    def test_model_cannot_select_an_invalid_candidate_or_boolean_index(self):
        for value in [{'index': 99, 'confidence': 100}, {'index': False, 'confidence': 100}, {'index': 0, 'confidence': 96}]:
            with mock.patch.object(model, 'structured', return_value=value):
                self.assertIsNone(model.choose_title('unused', {}, [{'tmdb_id': 1}]))
        self.assertEqual(component('../CON:<name>/x'), 'CON name x')

    def test_quota_error_is_redacted_and_backed_off(self):
        from urllib.error import HTTPError
        with mock.patch.object(model, 'urlopen', side_effect=HTTPError('url', 429, 'sk-secret-fragment', {}, None)):
            with self.assertRaisesRegex(ValueError, 'waiting for API allowance') as error:
                model.title_hint('sk-secret-fragment', {})
        self.assertNotIn('secret', str(error.exception))

    def test_refresh_restart_and_settings_changes_make_no_additional_ai_calls(self):
        self.library.studio_cloud_files[0]['name'] = 'Arrival mystery.mkv'
        with mock.patch('mabeltv_backend.studio_organiser.title_hint', return_value={'title': 'Arrival'}) as hint, \
             mock.patch('mabeltv_backend.studio_organiser.choose_title', return_value={'tmdb_id':329865, 'media_type':'movie'}) as choose:
            self.step()
            self.assertEqual((hint.call_count, choose.call_count), (1, 1))
            self.library.write_state('settings', {'volume': {'maximum': 60}})
            self.library.state_database = type(self.database)(self.fixture.database)
            for _ in range(12):
                self.library.studio_cloud_checked = time.time()
                self.step()
            self.assertEqual((hint.call_count, choose.call_count), (1, 1))
            new = self.file('new', 'Films/Arrival.other.release.mkv')
            self.library.studio_cloud_files.append(new)
            self.remote['Media/' + new['path']] = self.stat(new)
            self.step()
            self.assertEqual((hint.call_count, choose.call_count), (2, 2))

    def test_uncertain_answers_stay_cached_and_manual_matching_needs_no_ai(self):
        self.library.studio_cloud_files[0]['name'] = 'unrecognisable.mkv'
        with mock.patch('mabeltv_backend.studio_organiser.title_hint', return_value={'title': ''}) as hint:
            self.step()
            self.library.state_database = type(self.database)(self.fixture.database)
            later = time.time() + 7 * 86400
            with mock.patch('mabeltv_backend.studio_organiser.time.time', return_value=later):
                self.step()
            self.assertEqual(hint.call_count, 1)
            self.library.studio_cloud_match({'id':'one','match':{'tmdb_id':329865,'media_type':'movie'}})
            self.step()
            self.assertEqual(hint.call_count, 1)
        self.assertEqual(self.library.studio_cloud_files[0]['path'],'Films/Arrival.2016.mkv')

    def test_ai_response_cache_survives_interruption_before_title_linking(self):
        self.library.studio_cloud_files[0]['name'] = 'Arrival mystery.mkv'
        title = self.library.studio_cloud_catalogue({})['items'][0]
        with mock.patch('mabeltv_backend.studio_organiser.title_hint', return_value={'title':'Arrival'}) as hint, \
             mock.patch('mabeltv_backend.studio_organiser.choose_title', return_value={'tmdb_id':329865,'media_type':'movie'}) as choose:
            first = self.library._studio_organiser_resolve(title, [], 'unused')[0]
            self.library.state_database = type(self.database)(self.fixture.database)
            second = self.library._studio_organiser_resolve(title, [], 'unused')[0]
            self.assertEqual(first, second)
            self.assertEqual((hint.call_count, choose.call_count), (1, 1))
        self.assertEqual(len(self.database.studio_records('aicache')), 2)
        self.assertFalse(self.database.studio_cloud_metadata_records())

    def test_new_series_episode_uses_existing_identity_without_rewriting_correct_names(self):
        self.library.studio_cloud_files = [self.file('ep1','TV/Ludwig/Season 1/Ludwig S01E01.mp4')]
        self.remote = {f'Media/{item["path"]}':self.stat(item) for item in self.library.studio_cloud_files}
        self.library.my_tv_cached_tmdb_request.side_effect = lambda endpoint,query: {'name':'Ludwig','first_air_date':'2024-09-25'}
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.library.studio_cloud_match({'id':title['id'],'match':{'tmdb_id':123,'media_type':'tv'}})
        self.step()
        new = self.file('ep2','TV/Ludwig/Season 01/Ludwig S01E02.mp4')
        self.library.studio_cloud_files.append(new)
        self.remote['Media/' + new['path']] = self.stat(new)
        with mock.patch('mabeltv_backend.studio_organiser.title_hint') as ai:
            self.step()
        ai.assert_not_called()
        self.assertEqual(len(self.commands),0)
        self.assertIn('S01E02',new['path'])
        self.assertEqual(len(self.library.studio_cloud_catalogue({})['items']),1)

    def test_title_memos_are_not_evicted_by_the_200_item_job_history_limit(self):
        for index in range(205):
            self.database.studio_memo('organiser',{'id':str(index),'status':'complete','fingerprint':'stable'})
        reopened = type(self.database)(self.fixture.database)
        self.assertEqual(len(reopened.studio_records('organiser')),205)
        self.library.write_state('settings',{'volume':{'maximum':60}})
        self.assertEqual(len(reopened.studio_records('organiser')),205)

    def test_usage_records_tokens_without_credentials_or_media_data(self):
        self.database.studio_ai_usage({'model':'gpt-6-luna','input_tokens':100,'output_tokens':20})
        self.database.studio_ai_usage({'model':'gpt-6-luna','input_tokens':50,'output_tokens':5})
        usage = self.library.studio_status()['organiserUsage'][0]
        self.assertEqual((usage['requests'],usage['input_tokens'],usage['output_tokens']),(2,150,25))
        self.assertNotIn('sk-',json.dumps(usage))

    def test_owner_correction_survives_multiple_series_root_changes(self):
        self.library.studio_cloud_files = [self.file('ep','TV/Ludwig/Season 1/Ludwig S01E01.mp4')]
        self.remote = {f'Media/{item["path"]}':self.stat(item) for item in self.library.studio_cloud_files}
        self.library.my_tv_cached_tmdb_request.side_effect = lambda endpoint,query: {
            'name':'Different Show' if endpoint.endswith('/555') else 'Ludwig','first_air_date':'2024-09-25'}
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.library.studio_cloud_match({'id':title['id'],'match':{'tmdb_id':123,'media_type':'tv'}})
        self.step()
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.library.studio_cloud_match({'id':title['id'],'match':{'tmdb_id':555,'media_type':'tv'}})
        with mock.patch('mabeltv_backend.studio_organiser.title_hint') as ai:
            self.step()
        ai.assert_not_called()
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.assertEqual(title['metadata']['tmdb_id'],555)
        self.assertTrue(title['metadata_confirmed'])
        self.assertEqual(title['path'],'TV/Ludwig')

    def test_late_automatic_miss_cannot_erase_a_resolved_title(self):
        self.step()
        title = self.library.studio_cloud_catalogue({})['items'][0]
        self.database.studio_save_cloud_metadata({'id':title['id'],'fingerprint':title['fingerprint'],
            'status':'unmatched','confirmed':False,'updated':time.time()},None,automatic=True)
        self.assertEqual(self.library.studio_cloud_catalogue({})['items'][0]['metadata']['tmdb_id'],329865)


if __name__ == '__main__':
    unittest.main()
