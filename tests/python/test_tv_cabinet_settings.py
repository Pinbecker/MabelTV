import unittest
from unittest import mock

try:
    from tests.python.library_test_support import LibraryFixture
except ModuleNotFoundError:
    from library_test_support import LibraryFixture


class CabinetSettingsTests(unittest.TestCase):
    def test_finding_nemo_can_be_saved_selected_away_and_restored(self):
        fixture = LibraryFixture()
        self.addCleanup(fixture.close)
        library = fixture.library
        library.refresh_tv = mock.Mock(return_value=True)
        for cabinet in ("finding-nemo", "charcoal-90s", "finding-nemo"):
            settings = library.tv_settings(library.settings())
            settings["tv_border"] = cabinet
            self.assertTrue(library.manage({"action": "set-tv-settings", "settings": settings}))
            self.assertEqual(library.settings()["tv_border"], cabinet)
            self.assertEqual(library.library()["tv_settings"]["tv_border"], cabinet)
        self.assertEqual(library.refresh_tv.call_count, 3)


if __name__ == "__main__":
    unittest.main()
