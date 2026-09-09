from __future__ import annotations

import http.client
import importlib.util
import threading
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = PROJECT_ROOT / "tests" / "browser" / "fixture_server.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_browser_fixture", FIXTURE_PATH)
assert SPEC and SPEC.loader
fixture_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture_server)


class BrowserFixtureTests(unittest.TestCase):
    def test_static_assets_reuse_one_http_connection(self) -> None:
        server = fixture_server.mabeltv_library.LibraryServer(
            ("127.0.0.1", 0), fixture_server.FixtureLibrary())
        server.RequestHandlerClass = fixture_server.FixtureHandler
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=5)
        try:
            connection.request("GET", "/portal/js/core/foundation.js")
            first = connection.getresponse()
            self.assertEqual(first.status, 200)
            first.read()
            socket = connection.sock
            self.assertIsNotNone(socket)

            connection.request("GET", "/portal/js/core/load.js")
            second = connection.getresponse()
            self.assertEqual(second.status, 200)
            second.read()
            self.assertIs(connection.sock, socket)
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
