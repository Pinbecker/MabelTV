from tests.python.library_test_support import *


class StudioCloudCopiesTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.database = self.library.state_database
        self.original = {'id':'a'*24,'name':'Film.mkv','path':'Films/Film.mkv','folder':'Films',
            'kind':'video','extension':'.mkv','bytes':100,'modified':'2026-11-01','remoteId':'remote-original'}
        self.library.studio_cloud_files = [dict(self.original)]
        self.published = self.library.my_tv_root/'Published.mp4'
        self.published.write_bytes(b'published')

    def tearDown(self):
        self.fixture.close()

    def cloud_source(self):
        return {'type':'cloud', **{key:self.original[key] for key in ('id','bytes','modified','remoteId')}}

    def claimed_replacement(self):
        identity = self.library.studio_add_jobs({'sources':[self.cloud_source()],
            'destination':{'kind':'film','cloudCopies':'optimised'},'replaceCloudOriginal':True})['ids'][0]
        job = self.library.studio_worker_poll({'id':'c'*32,'name':'Worker','capabilities':['intel-policy-v2']})['job']
        self.assertEqual(job['id'], identity)
        output = {**self.original,'id':'b'*24,'name':'Film [Optimised].mp4','path':'Films/Film [Optimised].mp4',
            'extension':'.mp4','bytes':60,'remoteId':'remote-optimised'}
        self.library.studio_cloud_files.append(output)
        self.library.studio_cloud_archive_metadata(output, {'variants':['optimised'],'archiveGroup':'d'*32,'publicationJob':job['id']})
        stats = {'Media/'+item['path']:{'ID':item['remoteId'],'Size':item['bytes'],'ModTime':item['modified'],'IsDir':False}
                 for item in (self.original,output)}
        return job, output, stats

    def test_all_new_downloads_archive_selected_versions_and_tv_preparation_is_automatic(self):
        for copies in ('original','optimised','both'):
            for kind in ('film','icloud'):
                result = self.library.studio_add_jobs({'sources':[{'type':'iplayer','pid':'m0000001','title':'Film'}],
                    'destination':{'kind':kind,'prepare':False,'keepOptimised':True,'saveCloud':False,'cloudCopies':copies}})
                job = next(item for item in self.database.studio_records('job') if item['id']==result['ids'][0])
                self.assertTrue(job['destination']['saveCloud'])
                self.assertEqual(job['destination']['cloudCopies'],copies)
                self.assertEqual(job['destination']['prepare'],kind!='icloud' or copies!='original')
                self.assertTrue(job['destination']['temporaryWork'])
                self.assertFalse(job['destination']['keepOptimised'])
        with self.assertRaises(ValueError):
            self.library.studio_destination({'kind':'local'})
        for invalid in ([],{},False,'none'):
            with self.assertRaises(ValueError):
                self.library.studio_destination({'kind':'film','cloudCopies':invalid})

    def test_original_and_both_are_available_for_existing_cloud_without_replacement_consent(self):
        for copies in ('original','both'):
            value = self.library.studio_add_jobs({'sources':[self.cloud_source()],
                'destination':{'kind':'film','cloudCopies':copies}})
            job = next(item for item in self.database.studio_records('job') if item['id']==value['ids'][0])
            self.assertEqual(job['destination']['cloudCopies'],copies)
            self.assertNotIn('replaceCloudOriginal',job['destination'])

    def test_optimised_only_requires_explicit_consent_to_the_displayed_original_version(self):
        base = {'sources':[self.cloud_source()],'destination':{'kind':'film','cloudCopies':'optimised'}}
        with self.assertRaisesRegex(ValueError,'Confirm'):
            self.library.studio_add_jobs(base)
        changed = {**base,'replaceCloudOriginal':True,'sources':[{**self.cloud_source(),'bytes':99}]}
        with self.assertRaisesRegex(ValueError,'Confirm'):
            self.library.studio_add_jobs(changed)
        self.assertEqual(self.database.studio_records('job'),[])

    def test_original_is_deleted_only_after_confirmed_output_and_tv_publication(self):
        job, output, stats = self.claimed_replacement()
        payload = {'job':job['id'],'claim':job['claim'],'output':output['id'],'upload':'upload'}
        with mock.patch.object(self.library,'upload_status',return_value={'complete':False}):
            with self.assertRaisesRegex(ValueError,'published'):
                self.library.studio_cloud_replace_original(payload)
        self.assertEqual(self.database.studio_records('cloudop'),[])
        def command(args):
            self.assertEqual(args[0],'deletefile')
            self.assertEqual(args[1],'mabeltv_icloud:Media/'+self.original['path'])
            stats.pop('Media/'+self.original['path'])
        with mock.patch.object(self.library,'upload_status',return_value={'complete':True}), \
             mock.patch.object(self.library,'upload_destination',return_value=self.published), \
             mock.patch.object(self.library,'_studio_cloud_stat_optional',side_effect=lambda path:stats.get(path)), \
             mock.patch.object(self.library,'_studio_cloud_command',side_effect=command) as deletion:
            first = self.library.studio_cloud_replace_original(payload)
            second = self.library.studio_cloud_replace_original(payload)
            self.assertEqual(first['id'],second['id'])
            deletion.assert_not_called()
            self.library.studio_cloud_operations_step()
            deletion.assert_called_once()
            self.assertTrue(self.library.studio_cloud_replace_original(payload)['complete'])
        self.assertEqual(self.database.studio_records('cloudop')[0]['status'],'complete')
        self.assertEqual([item['id'] for item in self.library.studio_cloud_files],[output['id']])

    def test_changed_original_or_optimised_copy_never_triggers_deletion(self):
        job, output, stats = self.claimed_replacement()
        payload = {'job':job['id'],'claim':job['claim'],'output':output['id'],'upload':'upload'}
        with mock.patch.object(self.library,'upload_status',return_value={'complete':True}), \
             mock.patch.object(self.library,'upload_destination',return_value=self.published), \
             mock.patch.object(self.library,'_studio_cloud_stat_optional',side_effect=lambda path:stats.get(path)):
            stats['Media/'+output['path']]['Size']=59
            with self.assertRaisesRegex(ValueError,'optimised cloud copy changed'):
                self.library.studio_cloud_replace_original(payload)
            stats['Media/'+output['path']]['Size']=60
            stats['Media/'+self.original['path']]['ModTime']='changed'
            with self.assertRaisesRegex(ValueError,'original changed'):
                self.library.studio_cloud_replace_original(payload)
        self.assertEqual(self.database.studio_records('cloudop'),[])

    def test_confirmed_original_and_optimised_are_one_movie_and_keep_archive_identity_after_matching(self):
        for index,variant in enumerate(('original','optimised')):
            remote = {'ID':'cloud-'+variant,'Size':100-index*40,'ModTime':'2026-11-01','IsDir':False}
            with mock.patch.object(self.library,'_studio_rclone',return_value=remote):
                result = self.library.studio_cloud_confirm({'path':f'Films/Arrival [{variant}].mp4','bytes':remote['Size'],
                    'variants':[variant],'archiveGroup':'d'*32,'publicationJob':'e'*32,'title':'Arrival'})
            self.assertTrue(result['confirmed'])
        # The initial unrelated original is removed from this isolated fixture.
        self.library.studio_cloud_files = [item for item in self.library.studio_cloud_files if item['id']!=self.original['id']]
        catalogue = self.library.studio_cloud_catalogue({})
        self.assertEqual(catalogue['total'],1)
        self.assertEqual(len(catalogue['items'][0]['versions']),2)
        representative = catalogue['items'][0]
        self.assertIn('original',representative['variants'])
        self.library._studio_organiser_link(representative,{'media_type':'movie','tmdb_id':329865,'title':'Arrival','year':'2016'})
        record = self.database.studio_cloud_metadata_records()[representative['id']]
        self.assertEqual(record['archiveGroup'],'d'*32)
        self.assertEqual(record['publicationJob'],'e'*32)
        self.assertEqual(record['variants'],['original'])
        items = self.library.studio_cloud_media_titles()[0]
        self.assertTrue(all(item['metadata']['tmdb_id']==329865 for item in items))

    def test_verification_follows_unchanged_file_identity_and_refuses_a_changed_cloud_version(self):
        frozen=self.original
        payload={'verifyId':frozen['id'],**{key:frozen[key] for key in ('bytes','modified','remoteId')},'lookupOnly':True}
        stats={'ID':frozen['remoteId'],'Size':100,'ModTime':frozen['modified'],'IsDir':False}
        with mock.patch.object(self.library,'_studio_rclone',return_value=stats):
            self.assertTrue(self.library.studio_cloud_confirm(payload)['confirmed'])
            self.library.studio_cloud_files[0]['path']='Films/Franchise/Film.mkv'
            self.assertTrue(self.library.studio_cloud_confirm(payload)['confirmed'])
            stats['ModTime']='changed'
            self.assertFalse(self.library.studio_cloud_confirm(payload)['confirmed'])

    def test_finished_legacy_publication_can_archive_without_republishing(self):
        identity=self.library.studio_add_jobs({'sources':[{'type':'iplayer','pid':'m0000001'}],
            'destination':{'kind':'film'}})['ids'][0]
        job=self.database.studio_records('job')[0]
        job.update(status='complete',result={'complete':True,'file_name':'Published.mp4'})
        self.database.studio_add('job',job)
        self.library.studio_job_action({'id':identity,'action':'archive','cloudCopies':'both'})
        queued=self.database.studio_records('job')[0]
        self.assertTrue(queued['cloud_only'])
        self.assertEqual(queued['destination']['cloudCopies'],'both')
        self.assertEqual(queued['result']['file_name'],'Published.mp4')

    def test_archive_reservation_needs_a_current_claim_and_binds_arrival_before_filing(self):
        self.library.studio_add_jobs({'sources':[{'type':'iplayer','pid':'m0000001','title':'Incoming'}],
            'destination':{'kind':'film','cloudCopies':'optimised'}})
        job=self.library.studio_worker_poll({'id':'1'*32,'capabilities':['intel-policy-v2']})['job']
        payload={'reserve':True,'publicationJob':job['id'],'claim':job['claim'],'archiveAsset':'a'*32+':optimised',
            'archiveGroup':'a'*32,'variants':['optimised'],'path':'Films/Incoming [Optimised].mp4','bytes':100,'title':'Incoming'}
        with self.assertRaises(ValueError):
            self.library.studio_cloud_confirm({**payload,'claim':'stale'})
        self.assertEqual(self.library.studio_cloud_confirm(payload),{'reserved':True})
        row={'Path':payload['path'],'Size':100,'ID':'incoming-cloud-id','ModTime':'2026-11-02','IsDir':False}
        with mock.patch.object(self.library,'_studio_rclone',return_value=[row]):
            self.library._studio_cloud_scan()
        intent=self.database.studio_records('archiveintent')[0]
        self.assertEqual(intent['status'],'complete')
        record=self.database.studio_cloud_metadata_records()[intent['file']]
        self.assertEqual(record['publicationJob'],job['id'])
        self.assertEqual(record['archiveAsset'],payload['archiveAsset'])
        with mock.patch.object(self.library,'_studio_rclone',return_value=row):
            result=self.library.studio_cloud_confirm({**payload,'reserve':False,'lookupOnly':True})
        self.assertTrue(result['confirmed'])
