from tests.python.library_test_support import *


class TvPlaybackConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.source = self.library.my_tv_root / 'Selected.mp4'
        self.source.write_bytes(b'film')

    def tearDown(self):
        self.fixture.close()

    def state(self, token='new', source=None):
        return {'seek_available': True, 'seek_token': token,
                'seek_file': str(source or self.source), 'standby': False}

    def test_waits_for_selected_file_and_new_playback_generation(self):
        states = [{}, self.state(source=self.source.with_name('Other.mp4')),
                  self.state('old'), self.state()]
        with mock.patch.object(self.library, 'player_mode_status', side_effect=states), \
                mock.patch.object(mabeltv_library.time, 'sleep') as sleep:
            self.library.confirm_tv_playback(self.source, 'old')
        self.assertEqual(sleep.call_count, 3)

    def test_missing_wrong_or_unchanged_playback_never_reports_success(self):
        for state in ({}, self.state('old'), self.state(source=self.source.with_name('Other.mp4'))):
            with self.subTest(state=state), \
                    mock.patch.object(self.library, 'player_mode_status', return_value=state), \
                    mock.patch.object(mabeltv_library.time, 'monotonic', side_effect=[0, 12]), \
                    self.assertRaisesRegex(ValueError, 'not confirmed'):
                self.library.confirm_tv_playback(self.source, 'old')

    def test_late_socket_reply_requires_actual_playback_without_resending(self):
        client = mock.MagicMock()
        client.__enter__.return_value = client
        client.recv.side_effect = mabeltv_library.socket.timeout('late acknowledgement')
        with mock.patch.object(self.library, 'remote_source', return_value=('my_tv', self.source, 'Selected', 'id', 0)), \
                mock.patch.object(self.library, 'player_mode_status', side_effect=[self.state('old'), {}, self.state()]), \
                mock.patch.object(mabeltv_library.socket, 'AF_UNIX', 1, create=True), \
                mock.patch.object(mabeltv_library.socket, 'socket', return_value=client), \
                mock.patch.object(mabeltv_library.time, 'sleep'):
            result = self.library.play_on_tv({'kind': 'my_tv', 'file': self.source.name})
        self.assertTrue(result['ok'])
        client.sendall.assert_called_once()

    def test_socket_ok_with_no_playback_is_not_success(self):
        client = mock.MagicMock()
        client.__enter__.return_value = client
        client.recv.return_value = b'ok\n'
        with mock.patch.object(self.library, 'remote_source', return_value=('my_tv', self.source, 'Selected', 'id', 0)), \
                mock.patch.object(self.library, 'player_mode_status', return_value=self.state('old')), \
                mock.patch.object(mabeltv_library.socket, 'AF_UNIX', 1, create=True), \
                mock.patch.object(mabeltv_library.socket, 'socket', return_value=client), \
                mock.patch.object(mabeltv_library.time, 'monotonic', side_effect=[0, 12]), \
                self.assertRaisesRegex(ValueError, 'not confirmed'):
            self.library.play_on_tv({'kind': 'my_tv', 'file': self.source.name})
        client.sendall.assert_called_once()

    def test_up_next_also_confirms_exact_selected_file(self):
        with mock.patch.object(self.library, 'queue_programme', return_value={
                'id': 'entry', 'channel_number': 1, 'file_name': self.source.name}), \
                mock.patch.object(self.library, 'remote_source', return_value=('channel', self.source, 'Selected', None, 0)), \
                mock.patch.object(self.library, 'player_mode_status', return_value=self.state('old')), \
                mock.patch.object(self.library, 'play_queue_on_tv', return_value={'ok': True}), \
                mock.patch.object(self.library, 'confirm_tv_playback') as confirm:
            self.library.play_on_tv({'kind': 'channel', 'channel': 1, 'file': self.source.name, 'queue_id': 'entry'})
        confirm.assert_called_once_with(self.source, 'old')

    def test_missed_countdown_skip_still_checks_whether_film_started(self):
        client = mock.MagicMock()
        client.__enter__.return_value = client
        client.recv.side_effect = [b'ok\n', mabeltv_library.socket.timeout('skip was late')]
        with mock.patch.object(self.library, 'remote_source', return_value=('channel', self.source, 'Selected', 'id', 0)), \
                mock.patch.object(self.library, 'channel', return_value={'number': 1, 'content_type': 'films'}), \
                mock.patch.object(self.library, 'player_mode_status', side_effect=[self.state('old'), {}, self.state()]), \
                mock.patch.object(mabeltv_library.socket, 'AF_UNIX', 1, create=True), \
                mock.patch.object(mabeltv_library.socket, 'socket', return_value=client), \
                mock.patch.object(mabeltv_library.time, 'sleep'):
            result = self.library.play_on_tv({'kind': 'channel', 'channel': 1, 'file': self.source.name})
        self.assertTrue(result['ok'])
        self.assertEqual(len(client.sendall.call_args_list), 2)
        self.assertEqual(client.sendall.call_args_list[1].args[0], b'select\n')
