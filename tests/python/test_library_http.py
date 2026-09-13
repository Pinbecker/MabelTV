from __future__ import annotations

from tests.python.library_test_support import *


class LibraryHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.server = mabeltv_library.LibraryServer(("127.0.0.1", 0),
                                                    self.fixture.library)
        self.port = self.server.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.fixture.close()

    def request(self, path: str, payload: dict | None = None,
                origin: str | None = None) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.base + path, data=data,
                                         method="GET" if payload is None else "POST")
        if payload is not None:
            request.add_header("Content-Type", "application/json")
        if origin:
            request.add_header("Origin", origin)
        try:
            with self.opener.open(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.loads(error.read())
            finally:
                error.close()

    def test_setup_login_and_authenticated_dashboard_flow(self) -> None:
        status, state = self.request("/api/setup")
        self.assertEqual(status, 200)
        self.assertFalse(state["configured"])
        self.assertEqual(state["tv_name"], "KidsTV")
        self.assertNotIn("setup_code", state)

        status, _ = self.request("/api/setup", {
            "setup_code": "135790", "owner_name": "Taylor", "child_name": "Taylor",
            "pin": "8642",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/login", {"pin": "1111"})
        self.assertEqual(status, 403)
        status, _ = self.request("/api/login", {"pin": "8642"})
        self.assertEqual(status, 200)
        status, dashboard = self.request("/api/library")
        self.assertEqual(status, 200)
        self.assertEqual(dashboard["owner"]["name"], "Taylor")
        self.assertEqual(dashboard["owner"]["tv_name"], "TaylorTV")
        self.assertTrue(dashboard["owner"]["portal_pin_required"])
        status, security = self.request("/api/portal-security", {
            "current_pin": "8642", "required": False,
        })
        self.assertEqual(status, 200)
        self.assertFalse(security["portal_pin_required"])
        status, dashboard = self.request("/api/library")
        self.assertEqual(status, 200)
        self.assertFalse(dashboard["owner"]["portal_pin_required"])
        status, security = self.request("/api/portal-security", {
            "current_pin": "1111", "required": True,
        })
        self.assertEqual(status, 400)
        status, security = self.request("/api/portal-security", {
            "current_pin": "8642", "required": True,
        })
        self.assertEqual(status, 200)
        self.assertTrue(security["portal_pin_required"])
        status, _ = self.request("/api/library")
        self.assertEqual(status, 401)
        status, _ = self.request("/api/login", {"pin": "8642"})
        self.assertEqual(status, 200)
        status, state = self.request("/api/setup")
        self.assertEqual(status, 200)
        self.assertEqual(state["tv_name"], "TaylorTV")
        with mock.patch.object(self.server.library, "admin_action", return_value=""):
            status, identity = self.request("/api/identity", {"child_name": "Mabel"})
        self.assertEqual(status, 200)
        self.assertEqual(identity["tv_name"], "MabelTV")
        self.assertEqual(len(dashboard["channels"]), 4)
        status, live = self.request("/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(set(live), {"storage", "system", "uploads"})

    def test_cross_origin_mutation_is_rejected(self) -> None:
        status, body = self.request("/api/setup", {
            "setup_code": "135790", "pin": "8642",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        }, origin="https://example.invalid")
        self.assertEqual(status, 403)
        self.assertIn("did not come from", body["error"])

    def test_external_stream_token_works_without_browser_cookie_and_supports_range(self) -> None:
        movie = self.fixture.media / ".adult" / "VLC Film.mkv"
        movie.parent.mkdir(parents=True, exist_ok=True)
        movie.write_bytes(b"0123456789")
        started = self.fixture.library.start_external_stream({
            "kind": "adult", "file": "VLC Film.mkv",
        })
        request = urllib.request.Request(self.base + started["stream_url"])
        request.add_header("Range", "bytes=2-5")
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers["Content-Range"], "bytes 2-5/10")
            self.assertEqual(response.read(), b"2345")

    def test_offline_shell_assets_are_publicly_available(self) -> None:
        for path, marker in (("/service-worker.js", b"offline-media"),
                             ("/mabeltv-offline-schema.js", b"MabelOfflineSchema"),
                             ("/mabeltv-offline.js", b"startDownload"),
                             ("/portal-app.js", b"/* lg-tv-remote.js */"),
                             ("/portal/css/tokens.css", b"--control-min: 44px"),
                             ("/portal/css/components.css", b"@layer components"),
                             ("/portal/icons.svg", b'id="settings"'),
                             ("/portal/js/core/navigation.js", b"function initialise"),
                             ("/portal/css/experience-foundation.css", b"--experience-orange"),
                             ("/portal/css/experience-shell.css", b".portal-nav"),
                             ("/portal/css/experience-overlays.css", b"--experience-sheet-gutter"),
                             ("/portal/css/lg-tv-remote.css", b".lg-control-card"),
                             ("/portal/css/experience-light.css", b'data-experience-theme="light"'),
                             ("/portal/js/experience-theme.js", b"mabeltv-experience-theme"),
                             ("/portal/assets/providers/bbc-iplayer-app.jpg", b"\xff\xd8\xff"),
                             ("/portal/js/actions.js", b"managementBusy"),
                             ("/portal/js/lg-tv-remote.js", b"POINTER_INTERVAL_MS")):
            with urllib.request.urlopen(self.base + path, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get("Connection"), "close")
                self.assertIn(marker, response.read())

    def test_portal_bundle_can_be_injected_without_changing_production_default(self) -> None:
        injected = "'use strict'\nwindow.fixturePortalBundle = true\n"
        server = mabeltv_library.LibraryServer(
            ("127.0.0.1", 0), self.fixture.library,
            portal_app_script=injected,
        )
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/portal-app.js", timeout=5) as response:
                self.assertEqual(response.read().decode(), injected)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertTrue(mabeltv_library.PORTAL_APP_SCRIPT.startswith("(() => {"))

    def test_experience_is_the_only_portal_and_uses_strict_script_policy(self) -> None:
        with urllib.request.urlopen(self.base + "/", timeout=5) as response:
            default_html = response.read().decode()
            content_security_policy = response.headers["Content-Security-Policy"]
        self.assertIn('class="portal-v2 portal-experience"', default_html)
        self.assertNotIn('/portal/css/classic-foundation.css', default_html)
        self.assertIn("script-src 'self';", content_security_policy)
        self.assertNotIn("script-src 'self' 'unsafe-inline'", content_security_policy)

    def test_standalone_watch_page_has_its_required_inline_script_policy(self) -> None:
        self.request("/api/setup", {
            "setup_code": "135790", "pin": "8642",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.request("/api/login", {"pin": "8642"})

        with self.opener.open(self.base + "/watch/player", timeout=5) as response:
            content_security_policy = response.headers["Content-Security-Policy"]
            self.assertIn(
                "script-src 'self' 'unsafe-inline';", content_security_policy
            )

    def test_portal_asset_handler_rejects_path_traversal(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(
                self.base + "/portal/../mabeltv-library.py", timeout=5)
        try:
            self.assertEqual(raised.exception.code, 404)
        finally:
            raised.exception.close()


if __name__ == "__main__":
    unittest.main()
