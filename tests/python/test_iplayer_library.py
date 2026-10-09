from __future__ import annotations

import struct
from tests.python.library_test_support import *
from mabeltv_backend.iplayer import media_identity


def atom(kind: bytes, payload: bytes) -> bytes:
    return struct.pack('>I4s', len(payload) + 8, kind) + payload


def tagged_mp4(pid: str, title: str = 'Yakka Dee!: Series 1') -> bytes:
    values = {b'tven': pid.encode(), b'tvsh': title.encode(), b'\xa9nam': b'Banana',
              b'tvsn': struct.pack('>I', 1), b'tves': struct.pack('>I', 1)}
    tags = b''.join(atom(key, atom(b'data', b'\0' * 8 + value)) for key, value in values.items())
    return atom(b'ftyp', b'isom\0\0\0\0') + atom(b'mdat', b'ignored video') + atom(
        b'moov', atom(b'udta', atom(b'meta', b'\0' * 4 + atom(b'ilst', tags))))


class IPlayerLibraryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.complete_setup({'setup_code': '135790', 'owner_name': 'Taylor', 'child_name': 'Taylor',
            'pin': '8642', 'channels': mabeltv_library.DEFAULT_CHANNELS})
        self.channel = self.library.channels()[0]
        self.folder = self.fixture.media / self.channel['folder']
        self.folder.mkdir(parents=True, exist_ok=True)
        self.file = self.folder / 'Yakka Dee! Series 1 - 01. Banana.mp4'
        self.file.write_bytes(tagged_mp4('b09g3jlh'))

    def tearDown(self):
        self.fixture.close()

    def test_embedded_identity_survives_renaming_and_never_reads_video(self):
        self.assertEqual(media_identity(self.file), {'pid': 'b09g3jlh',
            'title': 'Yakka Dee!: Series 1', 'episode': 'Banana', 'series': 1, 'episodeNumber': 1})
        renamed = self.file.with_name('Renamed programme.mp4')
        self.file.rename(renamed)
        self.assertEqual(self.library.iplayer_library()['items'][0]['pid'], 'b09g3jlh')
        # Extended-size media atom is skipped using its length, not read.
        sparse = self.folder / 'Large.mp4'
        with sparse.open('wb') as stream:
            stream.write(struct.pack('>I4sQ', 1, b'mdat', 8 * 1024 * 1024))
            stream.seek(8 * 1024 * 1024)
            stream.write(tagged_mp4('b09g45l6'))
        self.assertEqual(media_identity(sparse)['pid'], 'b09g45l6')

    def test_deleted_replaced_and_recycled_files_never_count_as_present(self):
        first = self.library.iplayer_library()
        self.assertEqual(first['items'][0]['pid'], 'b09g3jlh')
        self.file.write_bytes(tagged_mp4('b09g45l6'))
        self.assertEqual(self.library.iplayer_library()['items'][0]['pid'], 'b09g45l6')
        recycled = self.library.bin / 'check' / self.file.name
        recycled.parent.mkdir(parents=True)
        self.file.rename(recycled)
        self.assertEqual(self.library.iplayer_library()['items'], [])
        self.assertEqual(self.library.iplayer_identity_cache, {})

    def test_imports_and_malformed_metadata_do_not_invent_bbc_identity(self):
        self.file.write_bytes(b'not an MP4')
        item = self.library.iplayer_library()['items'][0]
        self.assertNotIn('pid', item)
        self.assertEqual(item['file'], self.file.name)
        self.file.write_bytes(tagged_mp4('not-a-pid'))
        self.assertEqual(media_identity(self.file), {})

    def test_private_films_and_series_are_current_files_in_their_own_destinations(self):
        film = self.library.my_tv_root / 'BBC film.mp4'
        film.write_bytes(tagged_mp4('b007c94f', 'Shrek'))
        series_id = self.library.create_my_tv_series('Yakka Dee')
        root = self.library.my_tv_series_root / series_id / 'Season 1'
        root.mkdir(parents=True, exist_ok=True)
        (root / 'S01E01 - Banana.mp4').write_bytes(tagged_mp4('b09g3jlh'))
        items = self.library.iplayer_library()['items']
        self.assertEqual({item['location']['kind'] for item in items}, {'mabel', 'film', 'series'})
        film.unlink()
        self.assertFalse(any(item.get('pid') == 'b007c94f' for item in self.library.iplayer_library()['items']))

    def test_http_inventory_uses_existing_owner_authentication(self):
        server = mabeltv_library.LibraryServer(('127.0.0.1', 0), self.library)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_address[1])
        try:
            with self.assertRaises(urllib.error.HTTPError) as refused:
                urllib.request.urlopen(base + '/api/iplayer/library')
            self.assertEqual(refused.exception.code, 401)
            refused.exception.close()
            token = self.library.create_session()
            request = urllib.request.Request(base + '/api/iplayer/library',
                headers={'Cookie': 'mabeltv_library=' + token})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(json.load(response)['items'][0]['pid'], 'b09g3jlh')
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)
