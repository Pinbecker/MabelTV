import unittest
from unittest import mock

try:
    from tests.python.library_test_support import LibraryFixture
except ModuleNotFoundError:
    from library_test_support import LibraryFixture


class FilmGenreTests(unittest.TestCase):
    def test_confirmed_tmdb_match_retains_genres_in_saved_and_public_metadata(self):
        fixture = LibraryFixture()
        self.addCleanup(fixture.close)
        library = fixture.library
        film = library.adult_root / 'Film.mkv'
        film.write_bytes(b'video')
        library.tmdb_request = mock.Mock(return_value={
            'title': 'Film', 'genres': [{'id': 12, 'name': 'Adventure'}, {'id': 14, 'name': 'Fantasy'}],
        })
        library.fetch_automatic_subtitle = mock.Mock(return_value={})
        library.tmdb_apply({'file': film.name, 'tmdb_id': 120})
        self.assertEqual(library.adult_media_states()[film.name]['metadata']['genres'], ['Adventure', 'Fantasy'])
        self.assertEqual(library.library()['adult_library'][0]['metadata']['genres'], ['Adventure', 'Fantasy'])


if __name__ == '__main__':
    unittest.main()
