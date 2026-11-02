from tests.python.library_test_support import *


class StudioTorrentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.database = self.library.state_database

    def tearDown(self):
        self.fixture.close()

    def poll(self, identity='1'*32, **fields):
        return self.library.studio_worker_poll({'id':identity, 'name':'Studio', 'capabilities':['torrent'], **fields})

    def answer(self, result, worker='1'*32):
        request = self.poll(worker)['requests'][0]
        self.poll(worker, responses=[{'id':request['id'],'claim':request['claim'],'result':result}])
        return self.library.studio_request_status(request['id'])

    @staticmethod
    def item(index=1, seeds=100):
        identity = f'{index:040x}'
        return {'hash':identity,'title':f'Proof film {index}', 'bytes':1024, 'seeders':seeds, 'leechers':2,
                'magnet':'magnet:?xt=urn:btih:'+identity+'&dn=Proof&ws=http://127.0.0.1/private&tr=udp://tracker.opentrackr.org:1337/announce'}

    def inspected(self):
        search = self.library.studio_torrent_search({'query':'Proof'})
        search = self.answer({'items':[self.item()]})
        inspection = self.library.studio_torrent_inspect({'request':search['id'],'hash':self.item()['hash']})
        return self.answer({'hash':self.item()['hash'],'title':'Proof', 'files':[
            {'index':0,'path':'Proof/Show.S00E01.mkv','bytes':1024},
            {'index':1,'path':'Proof/Show.S02E01.mkv','bytes':2048},
            {'index':2,'path':'Proof/installer.exe','bytes':30}]})

    def test_offline_search_is_durable_cached_and_hidden_from_older_workers(self):
        search = self.library.studio_torrent_search({'query':'Big Buck Bunny'})
        self.assertEqual(search['id'],self.library.studio_torrent_search({'query':'big buck bunny'})['id'])
        self.assertFalse(self.library.studio_worker_poll({'id':'2'*32})['requests'])
        reopened = type(self.database)(self.fixture.database)
        self.assertEqual(reopened.studio_records('request')[0]['status'],'queued')
        claimed = self.poll()['requests'][0]
        self.assertNotIn('claim',self.library.studio_request_status(search['id']))
        self.assertEqual(claimed['id'],search['id'])
        self.assertFalse(self.poll('2'*32)['requests'])

    def test_results_are_ranked_deduplicated_and_bounded_and_magnets_drop_webseeds(self):
        self.library.studio_torrent_search({'query':'Proof'})
        result = self.answer({'items':[self.item(index,index) for index in range(1,25)]})
        items = result['result']['items']
        self.assertEqual(len(items),10)
        self.assertEqual([item['seeders'] for item in items],list(range(24,14,-1)))
        self.assertNotIn('ws=',items[0]['magnet'])
        self.assertNotIn('127.0.0.1',items[0]['magnet'])
        self.assertIn('tracker.opentrackr.org',items[0]['magnet'])
        for value in ('https://example.com/file.torrent','magnet:?xt=urn:btih:'+'f'*40):
            with self.assertRaises(ValueError):
                self.library.studio_torrent_magnet(value,self.item()['hash'])

    def test_inspection_freezes_selected_videos_and_infers_specials_and_seasons(self):
        inspection = self.inspected()
        self.assertEqual([item.get('series') for item in inspection['result']['files']],[0,2,None])
        source={'type':'torrent','request':inspection['id'],'files':[0,1],'path':'C:/injected','magnet':'injected'}
        frozen=self.library.studio_torrent_source(source)
        self.assertEqual(frozen['bytes'],3072)
        self.assertEqual(len(frozen['files']),2)
        self.assertNotIn('injected',json.dumps(frozen))
        for selection in ([2],[0,0],[True],[-1],[9],[]):
            with self.assertRaises(ValueError):
                self.library.studio_torrent_source({**source,'files':selection})

    def test_torrent_jobs_offer_all_three_archives_and_require_capable_worker(self):
        inspection=self.inspected()
        ids=[]
        for copies in ('original','optimised','both'):
            value=self.library.studio_add_jobs({'sources':[{'type':'torrent','request':inspection['id'],'files':[0]}],
                'destination':{'kind':'icloud','cloudCopies':copies}})
            ids.extend(value['ids'])
        self.assertEqual(len(set(ids)),3)
        for job in self.database.studio_records('job'):
            self.assertTrue(job['destination']['temporaryWork'])
            self.assertTrue(job['destination']['saveCloud'])
            self.assertEqual(job['destination']['prepare'],job['destination']['cloudCopies']!='original')
        self.assertIsNone(self.library.studio_worker_poll({'id':'2'*32})['job'])
        self.assertIn(self.poll()['job']['id'],ids)

    def test_request_heartbeat_prevents_a_second_worker_reclaiming_slow_metadata(self):
        with mock.patch('mabeltv_backend.repositories.studio.time.time',return_value=1000):
            self.library.studio_torrent_search({'query':'Proof'})
            claim=self.poll()['requests'][0]
        with mock.patch('mabeltv_backend.repositories.studio.time.time',return_value=1290):
            self.poll(requestActive={'id':claim['id'],'claim':claim['claim']})
        with mock.patch('mabeltv_backend.repositories.studio.time.time',return_value=1310):
            self.assertFalse(self.poll('2'*32)['requests'])
        with mock.patch('mabeltv_backend.repositories.studio.time.time',return_value=1600):
            renewed=self.poll('2'*32)['requests'][0]
            self.assertEqual(renewed['id'],claim['id'])
            self.assertNotEqual(renewed['claim'],claim['claim'])

    def test_malformed_or_unsafe_metadata_fails_without_creating_a_job(self):
        for path in ('../escape.mp4','C:/escape.mp4','Proof/../escape.mp4','Proof\\escape.mp4','Proof/bad?.mp4'):
            with self.assertRaises(ValueError):
                self.library.studio_torrent_files([{'index':0,'path':path,'bytes':1024}])
        for payload in ({'capabilities':[{}]}, {'capabilities':'torrent'}, {'requestActive':[]}):
            with self.assertRaises(ValueError):
                self.poll(**payload)
        self.assertFalse(self.database.studio_records('job'))
