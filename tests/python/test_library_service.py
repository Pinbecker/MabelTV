from __future__ import annotations

import argparse
import http.cookiejar
import importlib.util
import json
import os
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_library", MODULE_PATH)
assert SPEC and SPEC.loader
mabeltv_library = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mabeltv_library)

PORTAL_ROOT = PROJECT_ROOT / "scripts" / "pi" / "portal"
PORTAL_SCRIPT = "\n".join(
    (PORTAL_ROOT / "js" / name).read_text(encoding="utf-8")
    for name in ("core.js", "channel-page.js", "library.js", "playback.js", "actions.js")
)
PORTAL_STYLES = "\n".join(
    path.read_text(encoding="utf-8")
    for path in sorted((PORTAL_ROOT / "css").glob("*.css"))
)
PORTAL_SOURCE = "\n".join((mabeltv_library.INDEX, PORTAL_SCRIPT, PORTAL_STYLES))


class LibraryFixture:
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.media = self.root / "media"
        self.channels = self.root / "channels.json"
        self.settings = self.root / "settings.json"
        self.owner = self.root / "owner.json"
        self.config = self.root / "library.conf"
        self.config.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")
        self.settings.write_text('{"schema_version": 1}\n', encoding="utf-8")
        args = argparse.Namespace(
            media_root=str(self.media),
            channels=str(self.channels),
            settings=str(self.settings),
            owner=str(self.owner),
            config=str(self.config),
        )
        self.library = mabeltv_library.Library(args)
        self.library.admin_action = lambda action: "ok"

    def close(self) -> None:
        self.library.close()
        self.temporary.cleanup()


class LibraryUnitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_privileged_preview_shutdown_uses_fixed_root_stop_helper(self) -> None:
        process = mock.Mock()
        process.pid = 1234
        process.poll.return_value = None
        with mock.patch.object(mabeltv_library.subprocess, "run") as run, \
                mock.patch.object(mabeltv_library.os, "killpg", create=True) as killpg:
            mabeltv_library.LiveStream._terminate_process(process, privileged=True)

        run.assert_called_once_with(
            ["sudo", "-n", "/usr/local/libexec/mabeltv-screen-capture-stop"],
            check=False,
            stdout=mabeltv_library.subprocess.DEVNULL,
            stderr=mabeltv_library.subprocess.DEVNULL,
            timeout=5,
        )
        killpg.assert_not_called()
        process.wait.assert_called_once_with(timeout=3)

    def test_browser_upload_form_supports_resumable_multi_file_batches(self) -> None:
        index = PORTAL_SOURCE
        self.assertRegex(index, r'id="file"[^>]+\bmultiple\b')
        self.assertIn("let selectedUploadFiles = []", index)
        self.assertIn("$('#file').onchange", index)
        self.assertIn("selectedUploadFiles.push(file)", index)
        self.assertIn("const files = selectedUploadFiles.slice()", index)
        self.assertIn("for (let index = 0; index < files.length; index += 1)", index)
        self.assertIn("await sendSelectedFile(files[index]", index)
        self.assertIn("failures.push({ file: files[index], message: error.message })", index)
        self.assertIn('id="childName"', index)
        self.assertIn("/api/identity", index)
        self.assertNotIn("KidsTV", index)
        self.assertIn("state.tv_name", index)

    def test_portal_is_composed_from_ordered_component_assets(self) -> None:
        html = mabeltv_library.INDEX
        source = MODULE_PATH.with_name("mabeltv-library.html").read_text(encoding="utf-8")
        css_names = (
            "tokens", "base", "components", "shell", "home", "live",
            "watch", "management", "usb", "settings", "responsive", "channel-page",
            "experience-foundation", "experience-shell", "experience-home",
            "experience-remote", "experience-watch", "experience-library",
            "experience-settings", "experience-responsive", "experience-overlays",
            "portal-design-switch", "experience-light",
        )
        js_names = ("core", "channel-page", "library", "playback", "actions")

        css_positions = [html.index(f'/portal/css/{name}.css') for name in css_names]
        js_positions = [html.index(f'/portal/js/{name}.js') for name in js_names]
        self.assertEqual(css_positions, sorted(css_positions))
        self.assertEqual(js_positions, sorted(js_positions))
        self.assertLess(html.index('/portal/js/experience-theme.js'),
                        html.index('/portal/css/experience-foundation.css'))
        self.assertNotIn("<style", html)
        self.assertNotRegex(html, r"\sstyle=")
        self.assertNotIn("!important", PORTAL_STYLES)
        self.assertIn("@layer reset, tokens, base, components", PORTAL_STYLES)
        self.assertIn("--control-min: 44px", PORTAL_STYLES)
        self.assertIn('/portal/icons.svg#signal-house', html)
        self.assertIn('class="logo-mark" src="/mabeltv-icon.png"', html)
        self.assertTrue((PORTAL_ROOT / "icons.svg").is_file())
        self.assertIn('portal-include:html/app-shell.html', source)
        self.assertLess(len(source), 5_000)
        self.assertNotIn('portal-include:', html)
        for name in ("overview", "live", "channels", "adult", "watch", "usb", "system"):
            self.assertTrue((PORTAL_ROOT / "html" / "views" / f"{name}.html").is_file())
        self.assertEqual(html.count('id="iosWatchPlayer"'), 1)
        self.assertEqual(html.count('id="mabelWatchPlayer"'), 1)
        self.assertEqual(mabeltv_library.CLASSIC_INDEX.count('id="iosWatchPlayer"'), 1)
        self.assertEqual(mabeltv_library.CLASSIC_INDEX.count('id="mabelWatchPlayer"'), 1)

    def test_portal_uses_experience_by_default_and_one_isolated_classic_system(self) -> None:
        html = mabeltv_library.INDEX
        classic = mabeltv_library.CLASSIC_INDEX
        styles = "\n".join(
            (PORTAL_ROOT / "css" / f"experience-{name}.css").read_text(encoding="utf-8")
            for name in ("foundation", "shell", "home", "remote", "watch",
                         "library", "settings", "responsive", "overlays")
        )
        light_styles = (PORTAL_ROOT / "css" / "experience-light.css").read_text(
            encoding="utf-8")
        theme_script = (PORTAL_ROOT / "js" / "experience-theme.js").read_text(
            encoding="utf-8")
        core = (PORTAL_ROOT / "js" / "core.js").read_text(encoding="utf-8")

        self.assertIn('/portal/css/experience-foundation.css', html)
        self.assertIn('/portal/css/experience-shell.css', html)
        self.assertIn('/portal/css/experience-home.css', html)
        self.assertIn('/portal/css/experience-remote.css', html)
        self.assertIn('/portal/css/experience-watch.css', html)
        self.assertIn('/portal/css/experience-library.css', html)
        self.assertIn('/portal/css/experience-settings.css', html)
        self.assertIn('/portal/css/experience-responsive.css', html)
        self.assertIn('/portal/css/experience-overlays.css', html)
        self.assertIn('/portal/css/portal-design-switch.css', html)
        self.assertIn('/portal/css/experience-light.css', html)
        self.assertIn('/portal/js/experience-theme.js', html)
        self.assertNotIn('/portal/css/product-', html)
        self.assertIn('class="portal-v2 portal-experience"', html)
        self.assertIn('/portal/css/classic-foundation.css', classic)
        self.assertIn('/portal/css/classic-shell.css', classic)
        self.assertIn('/portal/css/classic-library.css', classic)
        self.assertIn('/portal/css/classic-responsive.css', classic)
        self.assertIn('/portal/css/portal-design-switch.css', classic)
        self.assertNotIn('/portal/css/experience-', classic)
        self.assertNotIn('/portal/js/experience-theme.js', classic)
        self.assertNotIn('/portal/css/product-', classic)
        self.assertIn('class="portal-v2 portal-classic"', classic)
        for document in (html, classic):
            self.assertNotIn('/portal/js/appearance.js', document)
            self.assertNotIn('/portal/js/component-gallery.js', document)
            self.assertNotIn('id="view-components"', document)
            self.assertNotIn('id="portalAppearanceControl"', document)
            self.assertIn('data-portal-design="experience"', document)
            self.assertIn('data-portal-design="classic"', document)
        for retired in ("appearance.js", "component-gallery.js"):
            self.assertFalse((PORTAL_ROOT / "js" / retired).exists())
        self.assertFalse(any((PORTAL_ROOT / "css").glob("component-direction-*.css")))
        self.assertNotIn("'components'", core)
        self.assertIn("mabeltv_portal_design=${design}", core)
        self.assertIn("--experience-orange: #ff7a1a", styles)
        self.assertIn("color-scheme: dark", styles)
        self.assertIn("--experience-orange: #b54800", light_styles)
        self.assertIn("--experience-orange-hot: #ff7a1a", light_styles)
        self.assertIn("color-scheme: light", light_styles)
        self.assertIn('html[data-experience-theme="light"]', light_styles)
        self.assertIn('<meta name="theme-color" content="#0b0a0d">', html)
        self.assertIn('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">', html)
        self.assertIn('<meta name="theme-color" content="#0b0a0d">', classic)
        self.assertIn('id="experienceThemeToggle"', html)
        self.assertIn('role="switch"', html)
        self.assertIn("mabeltv-experience-theme", theme_script)
        self.assertIn("localStorage.setItem(STORAGE_KEY, theme)", theme_script)
        self.assertIn("--experience-sheet-gutter", styles)
        self.assertIn("dialog:is(.library-sheet, .watch-sheet, .watch-film-sheet", styles)
        self.assertIn(".watch-collection-option.active", styles)
        self.assertIn(".portal-nav button.active::before", styles)
        self.assertIn('class="settings-stack"', html)
        self.assertIn(".home-spotlight", styles)
        self.assertIn(".remote-core", styles)
        self.assertIn(".watch-poster-grid", styles)
        self.assertIn(".library-main-card", styles)
        self.assertIn(".settings-disclosure", styles)
        self.assertNotIn('data-view-button="channels"', html)
        self.assertIn('data-view-button="usb"', html)
        self.assertIn('data-view-button="usb"', classic)
        self.assertIn('<h1>USB</h1>', html)
        self.assertNotIn('<strong>Browse USB</strong>', classic)
        self.assertIn('class="library-switch"', html)
        self.assertIn('class="home-spotlight"', html)
        self.assertIn('class="remote-app"', html)
        self.assertNotIn('class="home-intro"', html)
        self.assertNotIn('class="settings-grid"', html)
        self.assertNotIn('class="usb-layout"', html)
        self.assertNotIn('class="library-hero', html)
        self.assertNotIn(".ios-watch-player", styles)
        self.assertNotIn(".mabel-watch-player", styles)
        self.assertNotIn("!important", styles)
        icons = (PORTAL_ROOT / "icons.svg").read_text(encoding="utf-8")
        self.assertIn('id="signal-house"', icons)
        self.assertIn('id="signal-play"', icons)
        self.assertTrue((PORTAL_ROOT / "LICENSE-LUCIDE.txt").is_file())

    def test_classic_portal_is_preserved_from_the_previous_core_design(self) -> None:
        classic_root = MODULE_PATH.with_name("mabeltv-library-classic.html")
        classic = mabeltv_library.CLASSIC_INDEX
        self.assertTrue(classic_root.is_file())
        self.assertLess(len(classic_root.read_text(encoding="utf-8")), 5_000)
        self.assertNotIn("portal-include:", classic)
        self.assertIn('class="home-intro"', classic)
        self.assertIn('class="settings-grid"', classic)
        self.assertIn('class="usb-layout"', classic)
        self.assertIn('class="library-hero', classic)
        for name in ("overview", "live", "channels", "adult", "watch", "usb", "system"):
            self.assertTrue(
                (PORTAL_ROOT / "html" / "classic" / "views" / f"{name}.html").is_file()
            )

    def test_channel_detail_is_modular_watch_oriented_and_deep_linkable(self) -> None:
        html = mabeltv_library.INDEX
        channel_script = (PORTAL_ROOT / "js" / "channel-page.js").read_text(
            encoding="utf-8")
        channel_styles = (PORTAL_ROOT / "css" / "channel-page.css").read_text(
            encoding="utf-8")

        self.assertIn('id="channelWorkspace" class="hidden" data-channel-page-root', html)
        self.assertNotIn('id="workspaceChannelName"', html)
        self.assertNotIn('id="programmeActionPlay"', html)
        self.assertIn("const ChannelPageComponents", channel_script)
        self.assertIn("function createShowCard", channel_script)
        self.assertIn("function createFilmCard", channel_script)
        self.assertIn("function createOverflowButton", channel_script)
        self.assertIn("openWatchProgrammeSheet(selectedChannel, programme)", PORTAL_SCRIPT)
        self.assertIn("history.pushState({ channelPage: true }", PORTAL_SCRIPT)
        self.assertIn("/^channel\\/(\\d+)\\/(watch|library)$/", PORTAL_SCRIPT)
        self.assertIn(".channel-page-programmes.is-film-grid", channel_styles)
        self.assertNotIn("!important", channel_styles)
        self.assertNotIn("previousProgrammePage", PORTAL_SCRIPT)
        self.assertNotIn("nextProgrammePage", PORTAL_SCRIPT)
        self.assertNotIn("Available in channel", PORTAL_SCRIPT)

    def test_remote_browser_player_has_native_controls_and_safe_default(self) -> None:
        index = PORTAL_SOURCE
        player = mabeltv_library.WATCH_PAGE
        self.assertIn('id="view-watch"', index)
        self.assertIn('watch-poster-grid', index)
        self.assertNotIn('id="remoteVideo"', index)
        self.assertIn('id="video" controls', player)
        self.assertIn("track.kind = 'subtitles'", player)
        self.assertIn("video.oncanplay = attachNativeCaptions", index)
        self.assertIn("track.default = false", index)
        self.assertNotIn("track.track.mode = 'showing'", index)
        self.assertIn("const playAttempt = video.play()", index)
        self.assertIn("requestNativeFullscreen()", index)
        self.assertIn("webkitEnterFullscreen", player)
        self.assertIn("navigator.maxTouchPoints > 1", index)
        self.assertIn("body:has(.ios-watch-player:not(.hidden))", index)
        self.assertIn("classList.toggle('adult', result.kind === 'adult')", player)
        self.assertIn("set-remote-simultaneous", index)
        self.assertIn("/api/remote/start", player)
        self.assertIn("/api/remote/clear-position", index)
        self.assertIn('id="watchFilmRemoveProgress"', index)
        self.assertIn("actionLabel.textContent = playAfter ? 'Starting from beginning…' : 'Removing…'", index)
        self.assertIn("film.remote_position = 0", index)
        self.assertIn("renderAdultWatch()", index)
        self.assertNotIn("setNotice(", index)
        self.assertNotIn("watch-continue-more", index)
        self.assertIn('class="dialog-close-bar"', index)
        self.assertIn('class="watch-film-summary"', index)
        self.assertIn(".dialog-close-bar", index)
        self.assertIn(".dialog-close-bar .dialog-close", index)
        self.assertIn(".dialog-close, .library-sheet-close", index)
        self.assertIn(".remote-sheet-close)::after", index)
        self.assertIn("position: sticky", index)
        self.assertIn('id="watchFilmTv"', index)
        self.assertIn('id="watchFilmHere"', index)
        self.assertNotIn("className = 'watch-play'", index)
        self.assertNotIn('.watch-play {', index)
        self.assertIn("position: Number(film.remote_position || 0)", index)
        self.assertIn('id="watchProgrammeSheet"', index)
        self.assertIn('id="watchManageAdult"', index)
        self.assertIn('id="watchFilmManage" type="button" class="watch-film-secondary hidden"', index)
        self.assertIn("openAdultFilmSheet(film)", index)
        self.assertIn("openLibrarySheet($('#adultCollectionSheet'))", index)
        self.assertNotIn('id="watchManageMabel"', index)
        self.assertNotIn('id="overviewChannels"', index)
        self.assertIn("identity.className = 'mabel-show-identity'", index)
        self.assertIn("identity.onclick = () => openChannel(channel.number, true)", index)
        self.assertNotIn("const manageCue", index)
        self.assertIn("channelWorkspaceReturnToWatch", index)
        self.assertIn('id="watchMabelLayout"', index)
        self.assertIn('id="watchMabelPrimaryTools"', index)
        self.assertIn('id="watchMabelUtilities"', index)
        self.assertNotIn('id="remotePolicy"', index)
        self.assertNotIn("Choose something once, then play it on the television", index)
        self.assertIn("grid-auto-columns: calc((100% - var(--space-3)) / 2)", index)
        self.assertIn(".watch-channel-rail:has(> :only-child)", index)
        self.assertIn("#remoteMabel", index)

        self.assertIn("max-width: 100%", index)
        self.assertIn(".programme-action-summary > span:last-child", index)
        self.assertIn("dialog:is(.library-sheet, .watch-sheet", index)
        self.assertIn("grid-template-columns: 50px minmax(142px, 176px) 50px", index)
        self.assertIn(".remote-mode small", index)
        self.assertNotIn('data-view-button="channels"', index)
        self.assertIn('data-view-button="usb"', index)
        self.assertIn("const consolidatedWatchView", index)

    def test_global_notices_expire_and_do_not_follow_navigation(self) -> None:
        core = (PORTAL_ROOT / "js" / "core.js").read_text(encoding="utf-8")

        self.assertIn("}, bad ? 7000 : 3500)", core)
        self.assertNotIn("message.endsWith('…')", core)
        open_view = core[core.index("function openView(name)"):]
        self.assertIn("notice('')", open_view[:500])

    def test_iphone_watch_saves_backward_seeks_and_uses_native_player(self) -> None:
        portal = PORTAL_SOURCE

        self.assertIn("Math.abs(video.currentTime - iosRemoteLastSaved) < 10", portal)
        self.assertIn("video.onseeked = () => saveIosRemotePosition(false, true)", portal)
        self.assertNotIn("const useNativeFullscreen", portal)
        self.assertIn("if (nativeFullscreen || video.webkitDisplayingFullscreen", portal)
        self.assertIn("nativeFullscreen = false", portal)
        self.assertIn("restoreIosInlineVideoControls(video)", portal)
        self.assertIn("lockPortalPlayerScroll(false)", portal)
        self.assertIn("body.portal-player-open.portal-player-fixed", portal)
        self.assertIn("video.style.pointerEvents = 'none'", portal)
        self.assertIn("font-size: 1rem", portal)
        self.assertNotIn('id="watchReadyToggle"', portal)
        self.assertNotIn("watchReadyOnly", portal)
        self.assertNotIn("watch-ready-toggle", portal)

    def test_adult_organiser_uses_compact_accessible_components(self) -> None:
        portal = PORTAL_SOURCE

        self.assertIn('class="adult-film-move-panel"', portal)
        self.assertIn('aria-labelledby="adultFilmSheetTitle"', portal)
        self.assertIn("sheet.querySelector('.library-sheet-panel').focus", portal)
        self.assertIn("row.setAttribute('aria-label', `Open details for", portal)
        self.assertNotIn("more.textContent = 'Open'", portal)
        self.assertNotIn("!important", portal)

    def test_mabel_remote_player_restores_original_tv_and_locks_page_scroll(self) -> None:
        index = PORTAL_SOURCE
        self.assertIn('class="mabel-watch-icon-button" aria-label="Back to Mabel TV programmes"', index)
        self.assertNotIn('class="mabel-watch-icon-button mabel-watch-back"', index)
        self.assertIn("lockPortalPlayerScroll()", index)
        self.assertIn("unlockPortalPlayerScroll()", index)
        self.assertIn("body.portal-player-open", index)
        self.assertIn(".mabel-watch-player.controls-visible .mabel-watch-hud", index)
        self.assertIn(".mabel-watch-cabinet.charcoal-90s .mabel-watch-screen", index)
        self.assertIn(".mabel-watch-cabinet.charcoal-90s .mabel-watch-charcoal-fascia", index)
        self.assertIn("aspect-ratio: 4 / 3", index)
        self.assertIn("$('#mabelWatchScreen').onpointerdown", index)
        self.assertNotIn("$('#mabelWatchPlayer').onpointerdown", index)
        self.assertIn("shell.classList.remove('controls-visible'), 2800", index)
        self.assertNotIn(".mabel-watch-hud.visible", index)
        self.assertNotIn('data-view-button="adult"', index)
        self.assertNotIn("api('/api/remote/stop-tv'", index)
        self.assertNotIn("document.getElementById('logout').click()", index)

    def test_remote_stream_requires_browser_format_and_resumes_adult_film(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        film = adult / "Remote Film.mp4"
        film.write_bytes(b"remote-film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text('{"standby": true}', encoding="utf-8")
        item = self.fixture.library.adult_library()[0]
        started = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Remote Film.mp4"})
        self.assertIn("/api/remote/media?stream=", started["stream_url"])
        self.assertIsNone(started["subtitle_url"])
        token = started["stream_url"].split("stream=", 1)[1]
        self.fixture.library.remote_save_position({"stream": token, "position": 42, "duration": 100})
        self.assertEqual(self.fixture.library.adult_library()[0]["remote_position"], 42)
        (adult / "Remote Film.en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
        with_captions = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Remote Film.mp4"})
        self.assertIn("/api/remote/subtitles?stream=", with_captions["subtitle_url"])
        caption_token = with_captions["stream_url"].split("stream=", 1)[1]
        captions = self.fixture.library.remote_subtitles(caption_token).decode("utf-8")
        self.assertTrue(captions.startswith("WEBVTT"))
        self.assertEqual(item["library_id"], self.fixture.library.adult_library()[0]["library_id"])

    def test_remote_stream_blocks_live_tv_unless_concurrent_mode_is_enabled(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text('{"standby": false}', encoding="utf-8")
        with self.assertRaises(mabeltv_library.RemoteTvActiveError):
            self.fixture.library.start_remote_stream({"kind": "adult", "file": "Film.mp4"})
        self.fixture.library.manage({"action": "set-remote-simultaneous", "enabled": True})
        started = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Film.mp4"})
        self.assertTrue(started["ok"])

    def test_remote_session_accepts_a_large_backward_seek(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(
            '{"standby": true}', encoding="utf-8")
        started = self.fixture.library.start_remote_stream({
            "kind": "adult", "file": "Film.mp4",
        })
        token = started["stream_url"].split("stream=", 1)[1]

        self.fixture.library.remote_save_position({
            "stream": token, "position": 4800, "duration": 7200,
        })
        self.fixture.library.remote_save_position({
            "stream": token, "position": 1200, "duration": 7200,
        })

        self.assertEqual(
            self.fixture.library.adult_library()[0]["remote_position"], 1200)

    def test_remote_concurrent_setting_does_not_refresh_the_tv_player(self) -> None:
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        result = self.fixture.library.manage({
            "action": "set-remote-simultaneous", "enabled": True,
        })

        self.assertTrue(result)
        self.fixture.library.refresh_tv.assert_not_called()
        self.assertTrue(self.fixture.library.remote_settings()["allow_simultaneous"])

    def test_most_recent_adult_session_sets_next_shared_resume_position(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        item = self.fixture.library.adult_library()[0]
        states = self.fixture.library.adult_media_states()
        states["Film.mp4"].update({
            "remote_position": 900,
            "remote_duration": 7200,
            "remote_last_watched": 200,
        })
        self.fixture.library.write_adult_media_states(states)
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": False,
            "adult_positions": {item["library_id"]: 300},
            "adult_durations": {item["library_id"]: 7200},
            "adult_position_updated_utc_ms": {item["library_id"]: 300000},
        }), encoding="utf-8")

        latest_tv = self.fixture.library.adult_library()[0]
        self.assertEqual(latest_tv["remote_position"], 300)
        self.assertEqual(latest_tv["remote_last_watched"], 300)

        states = self.fixture.library.adult_media_states()
        states["Film.mp4"].update({
            "remote_position": 1200,
            "remote_last_watched": 400,
        })
        self.fixture.library.write_adult_media_states(states)
        latest_browser = self.fixture.library.adult_library()[0]
        self.assertEqual(latest_browser["remote_position"], 1200)
        self.assertEqual(latest_browser["remote_last_watched"], 400)

    def test_remote_resume_ignores_first_seconds_and_end_credits(self) -> None:
        self.assertEqual(self.fixture.library.normalise_resume_position(29, 7200), 0)
        self.assertEqual(self.fixture.library.normalise_resume_position(30, 7200), 30)
        self.assertEqual(self.fixture.library.normalise_resume_position(6900, 7200), 0)
        self.assertEqual(self.fixture.library.normalise_resume_position(6800, 7200), 6800)

    def test_starting_over_suppresses_the_stale_tv_bookmark(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        item = self.fixture.library.adult_library()[0]
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True, "adult_positions": {item["library_id"]: 420},
        }), encoding="utf-8")
        started = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Film.mp4"})
        token = started["stream_url"].split("stream=", 1)[1]
        self.fixture.library.remote_save_position({
            "stream": token, "position": 12, "duration": 7200,
        })
        self.assertEqual(self.fixture.library.adult_library()[0]["remote_position"], 0)
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True, "adult_positions": {item["library_id"]: 480},
        }), encoding="utf-8")
        self.assertEqual(self.fixture.library.adult_library()[0]["remote_position"], 480)
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True,
            "adult_positions": {item["library_id"]: 7050},
            "adult_durations": {item["library_id"]: 7200},
        }), encoding="utf-8")
        finished = self.fixture.library.adult_library()[0]
        self.assertEqual(finished["remote_position"], 0)
        self.assertEqual(finished["remote_duration"], 7200)

    def test_explicit_continue_watching_removal_clears_browser_and_tv_bookmarks(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        item = self.fixture.library.adult_library()[0]
        states = self.fixture.library.adult_media_states()
        states["Film.mp4"]["remote_position"] = 900
        states["Film.mp4"]["remote_last_watched"] = 12345
        self.fixture.library.write_adult_media_states(states)
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True,
            "adult_positions": {item["library_id"]: 600},
            "adult_durations": {item["library_id"]: 7200},
        }), encoding="utf-8")

        self.fixture.library.remote_clear_position({
            "kind": "adult", "file": "Film.mp4",
        })

        cleared = self.fixture.library.adult_library()[0]
        self.assertEqual(cleared["remote_position"], 0)
        self.assertEqual(cleared["remote_last_watched"], 0)
        saved = self.fixture.library.adult_media_states()["Film.mp4"]
        self.assertEqual(saved["ignored_player_position"], 600)

    def test_new_remote_stream_replaces_old_without_stale_token_clearing_it(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "First.mp4").write_bytes(b"first")
        (adult / "Second.mp4").write_bytes(b"second")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text('{"standby": true}', encoding="utf-8")
        first = self.fixture.library.start_remote_stream({"kind": "adult", "file": "First.mp4"})
        second = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Second.mp4"})
        first_token = first["stream_url"].split("stream=", 1)[1]
        second_token = second["stream_url"].split("stream=", 1)[1]
        with self.assertRaisesRegex(ValueError, "expired"):
            self.fixture.library.remote_session(first_token)
        self.assertEqual(self.fixture.library.remote_session(second_token)["title"], "Second")

    def test_first_run_hashes_pin_and_creates_generic_channels(self) -> None:
        result = self.fixture.library.complete_setup({
            "setup_code": "135790",
            "owner_name": "Sam",
            "child_name": "Mabel",
            "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertTrue(result["ok"])
        owner = json.loads(self.fixture.owner.read_text(encoding="utf-8"))
        self.assertNotIn("pin", owner)
        self.assertNotEqual(owner["pin_hash"], "2468")
        self.assertTrue(self.fixture.library.verify_pin("2468"))
        self.assertFalse(self.fixture.library.verify_pin("0000"))
        self.assertEqual(owner["child_name"], "Mabel")
        self.assertEqual(owner["tv_name"], "MabelTV")
        self.assertEqual(self.fixture.library.public_setup()["tv_name"], "MabelTV")
        channels = json.loads(self.fixture.channels.read_text(encoding="utf-8"))["channels"]
        self.assertEqual([channel["name"] for channel in channels],
                         ["Kids TV", "Cartoons", "Films", "Family Videos"])
        self.assertEqual([channel["content_type"] for channel in channels],
                         ["shows", "shows", "films", "films"])
        for channel in channels:
            self.assertTrue((self.fixture.media / channel["folder"]).is_dir())

    def test_seeded_channels_do_not_misidentify_a_fresh_install_as_recovery(self) -> None:
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        }), encoding="utf-8")
        self.assertFalse(self.fixture.library.public_setup()["recovering_owner"])

    def test_setup_code_is_one_time_and_channel_paths_are_sanitised(self) -> None:
        with self.assertRaisesRegex(ValueError, "setup code"):
            self.fixture.library.complete_setup({
                "setup_code": "000000", "pin": "2468",
                "channels": mabeltv_library.DEFAULT_CHANNELS,
            })
        channels = self.fixture.library.normalise_channels([
            {"number": 7, "name": "Nature", "folder": "../../Nature", "aspect": "fit"}
        ])
        self.assertEqual(channels[0]["folder"], "Nature")
        self.assertEqual(channels[0]["content_type"], "shows")
        inferred_film = self.fixture.library.normalise_channels([
            {"number": 8, "name": "Movies", "folder": "movies", "aspect": "fit"}
        ])
        self.assertEqual(inferred_film[0]["content_type"], "films")

    def test_tv_name_adds_tv_suffix_and_can_be_changed_later(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468", "child_name": "Mabel TV",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertEqual(self.fixture.library.library()["owner"]["tv_name"], "MabelTV")
        with mock.patch.object(self.fixture.library, "admin_action", return_value=""):
            result = self.fixture.library.change_tv_name({"child_name": "John"})
        self.assertEqual(result["tv_name"], "JohnTV")
        self.assertEqual(self.fixture.library.library()["owner"]["child_name"], "John")

    def test_login_attempts_are_rate_limited(self) -> None:
        address = "192.0.2.1"
        for _ in range(5):
            self.assertTrue(self.fixture.library.login_allowed(address))
            self.fixture.library.record_login_failure(address)
        self.assertFalse(self.fixture.library.login_allowed(address))
        self.fixture.library.clear_login_failures(address)
        self.assertTrue(self.fixture.library.login_allowed(address))

    def test_atomic_settings_updates_do_not_drop_parallel_changes(self) -> None:
        def change_channel(number: int) -> None:
            def mutate(settings: dict) -> None:
                values = set(settings["disabled_channels"])
                values.add(number)
                settings["disabled_channels"] = sorted(values)
            self.fixture.library.update_settings(mutate)

        workers = [threading.Thread(target=change_channel, args=(number,))
                   for number in range(1, 9)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        values = self.fixture.library.settings()["library"]["disabled_channels"]
        self.assertEqual(values, list(range(1, 9)))

    def test_parent_overlay_style_is_validated_persisted_and_exposed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)
        self.assertEqual(
            self.fixture.library.library()["appearance"]["parent_overlay_style"],
            "classic")
        self.fixture.library.manage({
            "action": "set-parent-overlay-style", "style": "modern",
        })
        self.assertEqual(
            self.fixture.library.settings()["parent_overlay_style"], "modern")
        self.assertEqual(
            self.fixture.library.library()["appearance"]["parent_overlay_style"],
            "modern")
        self.assertFalse(
            self.fixture.library.library()["appearance"]["tv_guide_enabled"])
        self.fixture.library.manage({
            "action": "set-tv-guide-enabled", "enabled": True,
        })
        self.assertTrue(self.fixture.library.settings()["tv_guide_enabled"])
        self.assertTrue(
            self.fixture.library.library()["appearance"]["tv_guide_enabled"])
        self.assertEqual(self.fixture.library.refresh_tv.call_count, 2)
        with self.assertRaisesRegex(ValueError, "classic or modern"):
            self.fixture.library.manage({
                "action": "set-parent-overlay-style", "style": "neon",
            })
        with self.assertRaisesRegex(ValueError, "on or off"):
            self.fixture.library.manage({
                "action": "set-tv-guide-enabled", "enabled": "yes",
            })

    def test_tv_scrubbing_setting_is_validated_persisted_and_exposed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)
        settings = self.fixture.library.library()["tv_settings"]
        self.assertFalse(settings["scrubbing_enabled"])

        updated = {
            **settings,
            "scrubbing_enabled": True,
        }
        self.fixture.library.manage({
            "action": "set-tv-settings", "settings": updated,
        })

        self.assertTrue(self.fixture.library.settings()["scrubbing_enabled"])
        self.assertTrue(self.fixture.library.library()["tv_settings"]["scrubbing_enabled"])
        self.fixture.library.refresh_tv.assert_called_once()

        legacy_portal_settings = {key: value for key, value in updated.items()
                                  if key != "scrubbing_enabled"}
        self.fixture.library.manage({
            "action": "set-tv-settings", "settings": legacy_portal_settings,
        })
        self.assertTrue(self.fixture.library.settings()["scrubbing_enabled"])

        updated["scrubbing_enabled"] = "yes"
        with self.assertRaisesRegex(ValueError, "scrubbing"):
            self.fixture.library.manage({
                "action": "set-tv-settings", "settings": updated,
            })

    def test_high_frame_rate_uploads_use_one_background_conversion_worker(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        active = 0
        maximum_active = 0
        counter_lock = threading.Lock()

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }

        def optimise(source: Path, destination: Path) -> None:
            nonlocal active, maximum_active
            with counter_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.1)
            destination.write_bytes(source.read_bytes())
            with counter_lock:
                active -= 1

        self.fixture.library.optimise_for_playback = optimise
        self.fixture.library.refresh_tv = lambda: True
        uploads = []
        for name in ("first.mov", "second.mov"):
            created = self.fixture.library.upload_create({
                "channel": 1, "file_name": name, "size": 16,
            })
            result = self.fixture.library.append_upload(created["id"], 0, b"x" * 16)
            self.assertTrue(result["processing"])
            uploads.append(created["id"])

        deadline = time.monotonic() + 4
        states = []
        while time.monotonic() < deadline:
            states = [self.fixture.library.upload_status(upload_id)
                      for upload_id in uploads]
            if all(state.get("complete") for state in states):
                break
            time.sleep(0.03)
        self.assertTrue(all(state.get("complete") for state in states))
        self.assertEqual(maximum_active, 1)

    def test_adult_upload_stays_original_until_owner_requests_optimisation(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 3840, "height": 2160,
            "avg_frame_rate": "60/1",
        }
        def optimise(source: Path, destination: Path) -> None:
            destination.write_bytes(source.read_bytes())

        self.fixture.library.optimise_adult_for_playback = mock.Mock(side_effect=optimise)
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        created = self.fixture.library.adult_upload_create({
            "file_name": "My Film.mkv", "size": 16,
        })
        result = self.fixture.library.append_upload(created["id"], 0, b"raw-film-content")
        self.assertTrue(result["processing"])

        deadline = time.monotonic() + 3
        state = {}
        while time.monotonic() < deadline:
            state = self.fixture.library.upload_status(created["id"])
            if state.get("complete"):
                break
            time.sleep(0.02)

        self.assertTrue(state.get("complete"))
        self.assertFalse(state.get("optimised"))
        self.assertEqual((self.fixture.library.adult_root / "My Film.mkv").read_bytes(),
                         b"raw-film-content")
        self.assertEqual(self.fixture.library.adult_library()[0]["display_name"],
                         "My Film")
        self.assertFalse(any((self.fixture.media / channel["folder"] / "My Film.mkv").exists()
                             for channel in mabeltv_library.DEFAULT_CHANNELS))
        self.fixture.library.optimise_adult_for_playback.assert_not_called()
        self.fixture.library.refresh_tv.assert_called_once()

        self.fixture.library.manage({"action": "optimise-adult", "file": "My Film.mkv"})
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            films = self.fixture.library.adult_library()
            if films and films[0]["playback_state"] == "optimised":
                break
            time.sleep(0.02)
        self.assertEqual((self.fixture.library.adult_root / "My Film.mp4").read_bytes(),
                         b"raw-film-content")
        self.assertFalse((self.fixture.library.adult_root / "My Film.mkv").exists())
        self.assertEqual(self.fixture.library.adult_library()[0]["playback_state"], "optimised")
        self.fixture.library.optimise_adult_for_playback.assert_called_once()

    def test_pi_ready_adult_upload_is_kept_without_conversion(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p",
            "width": 1280, "height": 720, "avg_frame_rate": "24000/1001",
        }
        self.fixture.library.optimise_adult_for_playback = mock.Mock()
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        created = self.fixture.library.adult_upload_create({
            "file_name": "Ready Film.mp4", "size": 5,
        })
        self.fixture.library.append_upload(created["id"], 0, b"ready")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])

        self.assertTrue(state["complete"])
        self.assertFalse(state["optimised"])
        self.assertEqual((self.fixture.library.adult_root / "Ready Film.mp4").read_bytes(),
                         b"ready")
        self.fixture.library.optimise_adult_for_playback.assert_not_called()

    def test_adult_folders_are_real_shared_collections_and_preserve_identity(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)
        source = self.fixture.library.adult_root / "Fellowship.mkv"
        source.write_bytes(b"film")

        first = self.fixture.library.adult_library()[0]
        identity = first["library_id"]
        self.fixture.library.manage({
            "action": "create-adult-folder", "name": "The Lord of the Rings",
        })
        self.fixture.library.manage({
            "action": "move-adult", "file": first["path"],
            "folder": "The Lord of the Rings",
        })

        moved = self.fixture.library.adult_library()[0]
        self.assertEqual(moved["path"], "The Lord of the Rings/Fellowship.mkv")
        self.assertEqual(moved["folder"], "The Lord of the Rings")
        self.assertEqual(moved["library_id"], identity)
        self.fixture.library.manage({
            "action": "rename-adult-folder", "folder": "The Lord of the Rings",
            "name": "Middle-earth",
        })
        renamed = self.fixture.library.adult_library()[0]
        self.assertEqual(renamed["path"], "Middle-earth/Fellowship.mkv")
        self.assertEqual(renamed["library_id"], identity)
        self.assertEqual(self.fixture.library.library()["adult_folders"], ["Middle-earth"])

        with self.assertRaisesRegex(ValueError, "Move every film"):
            self.fixture.library.manage({
                "action": "delete-adult-folder", "folder": "Middle-earth",
            })
        self.fixture.library.manage({
            "action": "move-adult", "file": renamed["path"], "folder": "",
        })
        self.fixture.library.manage({
            "action": "delete-adult-folder", "folder": "Middle-earth",
        })
        self.assertEqual(self.fixture.library.adult_folders(), [])

    def test_pin_recovery_keeps_custom_channels(self) -> None:
        custom = [{"number": 7, "name": "Nature", "folder": "nature", "aspect": "fit"}]
        self.fixture.channels.write_text(json.dumps({"schema_version": 1, "channels": custom}),
                                         encoding="utf-8")
        self.fixture.library.owner_recovery_path.touch()
        setup = self.fixture.library.public_setup()
        self.assertTrue(setup["recovering_owner"])
        expected = [{**custom[0], "content_type": "shows"}]
        self.assertEqual(setup["default_channels"], expected)
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": [{"number": 9, "name": "Wrong", "folder": "wrong",
                          "aspect": "crop"}],
        })
        self.assertEqual(self.fixture.library.channels(), expected)
        self.assertFalse(self.fixture.library.owner_recovery_path.exists())

    def test_channel_renumber_keeps_visibility_and_recycle_blocks_delete(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: True
        programme = self.fixture.media / "kids-tv" / "episode.mp4"
        programme.write_bytes(b"video")
        self.fixture.library.manage({"action": "toggle-channel", "channel": 1})
        self.fixture.library.manage({"action": "toggle-programme", "channel": 1,
                                     "file": "episode.mp4"})
        self.fixture.library.manage({"action": "update-channel", "original_number": 1,
                                     "number": 9, "name": "Kids TV", "aspect": "crop",
                                     "content_type": "films"})
        settings = self.fixture.library.settings()["library"]
        self.assertIn(9, settings["disabled_channels"])
        self.assertNotIn(1, settings["disabled_channels"])
        self.assertEqual(settings["disabled_programmes"]["9"], ["episode.mp4"])
        self.assertNotIn("1", settings["disabled_programmes"])
        self.assertEqual(self.fixture.library.channel(9)["content_type"], "films")

        self.fixture.library.manage({"action": "trash", "channel": 9,
                                     "file": "episode.mp4"})
        with self.assertRaisesRegex(ValueError, "recycled programmes"):
            self.fixture.library.manage({"action": "delete-channel", "channel": 9})
        recycled_id = self.fixture.library.recycle_items()[0]["id"]
        self.fixture.library.manage({"action": "restore", "id": recycled_id})
        visible = self.fixture.library.library()["channels"]
        channel = next(value for value in visible if value["number"] == 9)
        self.assertEqual([item["name"] for item in channel["programmes"]],
                         ["episode.mp4"])

    def test_recycle_move_has_durable_intent_and_rolls_back_move_failure(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: True
        programme = self.fixture.media / "kids-tv" / "only-copy.mp4"
        programme.write_bytes(b"video")

        def interrupted_move(source: str, destination: str) -> None:
            recycle_directory = Path(destination).parent
            self.assertTrue((recycle_directory / "manifest.json").is_file())
            raise OSError("simulated move failure")

        with mock.patch.object(mabeltv_library.shutil, "move",
                               side_effect=interrupted_move):
            with self.assertRaisesRegex(OSError, "simulated move failure"):
                self.fixture.library.manage({
                    "action": "trash", "channel": 1, "file": programme.name,
                })
        self.assertTrue(programme.is_file())
        self.assertEqual(self.fixture.library.recycle_items(), [])

        self.fixture.library.manage({
            "action": "trash", "channel": 1, "file": programme.name,
        })
        self.assertFalse(programme.exists())
        self.assertEqual(len(self.fixture.library.recycle_items()), 1)

    def test_unreadable_upload_reports_error_and_can_restart_cleanly(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = mock.Mock(
            side_effect=ValueError("Mabel TV could not find a video stream in that file"))
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "broken.mov", "size": 5,
        })
        received = self.fixture.library.append_upload(created["id"], 0, b"nope!")
        self.assertEqual(received["status"], "validating")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])
        self.assertEqual(state["status"], "error")
        self.assertFalse(state["complete"])
        self.assertFalse((self.fixture.media / ".incoming" /
                          f"{created['id']}.part").exists())
        restarted = self.fixture.library.upload_create({
            "channel": 1, "file_name": "broken.mov", "size": 5,
        })
        self.assertNotEqual(restarted["id"], created["id"])
        self.assertEqual(restarted["offset"], 0)
        self.assertFalse(any(job["id"] == created["id"]
                             for job in self.fixture.library.upload_jobs()))

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 640, "height": 480,
            "avg_frame_rate": "25/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.append_upload(restarted["id"], 0, b"valid")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(restarted["id"])["complete"])
        self.assertEqual(self.fixture.library.upload_jobs(), [])

    def test_resume_reserves_only_remaining_source_space(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        gib = 1024 ** 3
        with mock.patch.object(mabeltv_library.shutil, "disk_usage",
                               return_value=types.SimpleNamespace(free=3 * gib)):
            created = self.fixture.library.upload_create({
                "channel": 1, "file_name": "large.mov", "size": gib,
            })
        part = self.fixture.media / ".incoming" / f"{created['id']}.part"
        part.touch()
        with part.open("r+b") as stream:
            stream.truncate(gib // 4)
        with mock.patch.object(mabeltv_library.shutil, "disk_usage",
                               return_value=types.SimpleNamespace(free=int(2.3 * gib))):
            resumed = self.fixture.library.upload_create({
                "channel": 1, "file_name": "large.mov", "size": gib,
            })
        self.assertEqual(resumed["id"], created["id"])
        self.assertEqual(resumed["offset"], gib // 4)

    def test_upload_reservation_actions_and_channel_guards(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "waiting.mov", "size": 10,
        })
        waiting = next(job for job in self.fixture.library.upload_jobs()
                       if job["id"] == created["id"])
        self.assertEqual(waiting["offset"], 0)
        self.fixture.library.append_upload(created["id"], 0, b"12345")
        with self.assertRaisesRegex(ValueError, "already uploading"):
            self.fixture.library.upload_create({
                "channel": 1, "file_name": "waiting.mov", "size": 11,
            })
        with self.assertRaisesRegex(ValueError, "Finish or cancel"):
            self.fixture.library.manage({
                "action": "update-channel", "original_number": 1,
                "number": 9, "name": "Kids TV", "aspect": "crop",
            })
        with self.assertRaisesRegex(ValueError, "Finish or cancel"):
            self.fixture.library.manage({"action": "delete-channel", "channel": 1})
        cancelled = self.fixture.library.upload_action(created["id"], "cancel")
        self.assertIn("space was freed", cancelled["message"])
        self.assertEqual(self.fixture.library.upload_jobs(), [])

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.optimise_for_playback = mock.Mock(
            side_effect=ValueError("temporary encoder error"))
        retry_job = self.fixture.library.upload_create({
            "channel": 1, "file_name": "retry.mov", "size": 5,
        })
        self.fixture.library.append_upload(retry_job["id"], 0, b"video")
        self.fixture.library.conversion_queue.join()
        queued = next(job for job in self.fixture.library.upload_jobs()
                      if job["id"] == retry_job["id"])
        self.assertTrue(queued["retryable"])
        self.fixture.library.optimise_for_playback = (
            lambda source, destination: destination.write_bytes(source.read_bytes()))
        self.fixture.library.upload_action(retry_job["id"], "retry")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(retry_job["id"])["complete"])

        deferred = self.fixture.library.upload_create({
            "channel": 1, "file_name": "deferred.mp4", "size": 5,
        })
        incoming = self.fixture.media / ".incoming"
        (incoming / f"{deferred['id']}.part").write_bytes(b"ready")
        deferred_meta = self.fixture.library.upload_meta(deferred["id"])
        deferred_meta.update({"status": "error", "conversion_required": False})
        self.fixture.library.write_json(
            incoming / f"{deferred['id']}.json", deferred_meta)
        # Model the narrow interval after an old worker persisted its error but
        # before it removed the job from the dedupe set.
        self.fixture.library.queued_conversions.add(deferred["id"])
        self.fixture.library.upload_action(deferred["id"], "retry")
        self.assertIn(deferred["id"], self.fixture.library.deferred_retries)
        self.fixture.library.finish_conversion_job(deferred["id"])
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(deferred["id"])["complete"])

    def test_published_conversion_recovers_after_result_write_crash(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        first = True

        def interrupted_optimise(source: Path, destination: Path) -> None:
            nonlocal first
            destination.write_bytes(source.read_bytes())
            if first:
                first = False
                raise RuntimeError("simulated power loss after publish")

        self.fixture.library.optimise_for_playback = interrupted_optimise
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "crash.mov", "size": 8,
        })
        self.fixture.library.append_upload(created["id"], 0, b"12345678")
        self.fixture.library.conversion_queue.join()
        self.assertEqual(self.fixture.library.upload_status(created["id"])["status"],
                         "error")
        resumed = self.fixture.library.upload_create({
            "channel": 1, "file_name": "crash.mov", "size": 8,
        })
        self.assertTrue(resumed["processing"])
        self.fixture.library.conversion_queue.join()
        result = self.fixture.library.upload_status(created["id"])
        self.assertTrue(result["complete"])
        self.assertTrue((self.fixture.media / "kids-tv" / "crash.mp4").is_file())

    def test_refresh_failure_is_visible_and_directly_retryable(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 640, "height": 480,
            "avg_frame_rate": "25/1",
        }
        self.fixture.library.refresh_tv = lambda: False
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "refresh.mp4", "size": 5,
        })
        self.fixture.library.append_upload(created["id"], 0, b"video")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])
        self.assertTrue(state["complete"])
        self.assertEqual(state["status"], "refresh-error")
        job = next(job for job in self.fixture.library.upload_jobs()
                   if job["id"] == created["id"])
        self.assertTrue(job["refreshable"])

        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.upload_action(created["id"], "refresh")
        self.assertEqual(self.fixture.library.upload_status(created["id"])["status"],
                         "complete")
        self.assertEqual(self.fixture.library.upload_jobs(), [])

    def test_lost_final_response_reports_publish_states_as_processing(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "publishing.mp4", "size": 5,
        })
        manifest = self.fixture.media / ".incoming" / f"{created['id']}.json"
        metadata = self.fixture.library.read_json(manifest, {})
        metadata["status"] = "publishing"
        self.fixture.library.write_json(manifest, metadata)
        state = self.fixture.library.upload_status(created["id"])
        self.assertTrue(state["processing"])
        self.assertEqual(state["offset"], 5)

    def test_manage_reports_when_change_saved_but_refresh_failed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: False
        refreshed = self.fixture.library.manage({"action": "toggle-channel", "channel": 1})
        self.assertFalse(refreshed)
        self.assertIn(1, self.fixture.library.settings()["library"]["disabled_channels"])

    def test_adult_mode_is_an_allowed_parent_portal_command(self) -> None:
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_type:
                client = socket_type.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                self.assertEqual(
                    self.fixture.library.live_tv_control({"command": "enter-adult-mode"}),
                    {"ok": True, "message": "Command sent"})
                client.sendall.assert_called_once_with(b"enter-adult-mode\n")

        with self.assertRaisesRegex(ValueError, "Unknown live TV control"):
            self.fixture.library.live_tv_control({"command": "leave-adult-mode"})

    def test_live_tv_navigation_shortcuts_are_forwarded_to_the_player(self) -> None:
        commands = ("open-parent-menu", "open-tv-guide", "close-overlay",
                    "restart-programme", "navigate-up", "navigate-down",
                    "navigate-left", "navigate-right", "select",
                    "toggle-subtitles", "return-to-mabeltv", "toggle-remote-lock",
                    "turn-on", "turn-off")
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_factory:
                client = socket_factory.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                for command in commands:
                    self.assertEqual(
                        self.fixture.library.live_tv_control({"command": command}),
                        {"ok": True, "message": "Command sent"})
                self.assertEqual(client.sendall.call_count, len(commands))
                self.assertEqual(
                    [call.args[0] for call in client.sendall.call_args_list],
                    [f"{command}\n".encode() for command in commands])

    def test_live_tv_channel_picker_sends_a_validated_direct_tune(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_factory:
                client = socket_factory.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                self.assertEqual(
                    self.fixture.library.live_tv_control({
                        "command": "tune-channel", "channel": 1,
                    }),
                    {"ok": True, "message": "Command sent"})
                client.sendall.assert_called_once_with(
                    b'{"command":"tune-channel","channel":1}\n')

        with self.assertRaisesRegex(ValueError, "Choose a channel"):
            self.fixture.library.live_tv_control({
                "command": "tune-channel", "channel": "not-a-channel",
            })

    def test_live_tv_status_reports_adult_mode_instead_of_hidden_kids_playback(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": False, "reason": "Waiting for the TV programme",
            "channel_number": 5, "channel_name": "Films",
        })
        self.fixture.library.player_mode_status = mock.Mock(return_value={
            "mode": "adult", "playing": True,
            "programme": "The Fellowship of the Ring", "paused": True,
            "volume": 48, "muted": False, "remote_locked": True,
            "subtitles_available": True, "subtitles_visible": True,
        })

        status = self.fixture.library.live_tv_status()

        self.fixture.library.live_stream.status.assert_called_once_with(
            allow_screen_without_programme=True)
        self.assertTrue(status["available"])
        self.assertNotIn("reason", status)
        self.assertTrue(status["adult_mode"])
        self.assertTrue(status["adult_playing"])
        self.assertEqual(status["programme"], "The Fellowship of the Ring")
        self.assertTrue(status["paused"])
        self.assertEqual(status["channel_name"], "Films")
        self.assertEqual(status["volume"], 48)
        self.assertFalse(status["muted"])
        self.assertTrue(status["remote_locked"])
        self.assertTrue(status["subtitles_available"])
        self.assertTrue(status["subtitles_visible"])

    def test_player_mode_status_tolerates_an_unavailable_player_socket(self) -> None:
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket",
                                   side_effect=OSError("not ready")):
                self.assertEqual(self.fixture.library.player_mode_status(), {})

    def test_portal_error_notices_clear_automatically(self) -> None:
        portal = PORTAL_SOURCE

        self.assertIn("if (message)", portal)
        self.assertIn("bad ? 7000 : 3500", portal)
        self.assertNotIn("message.endsWith('…')", portal)
        self.assertIn("state.adult_mode ? 'ADULT TV · PRIVATE LIBRARY'", portal)

    def test_worker_survives_failure_while_persisting_an_error(self) -> None:
        self.fixture.library.unexpected_conversion_error = mock.Mock(
            side_effect=OSError("read-only filesystem"))
        self.fixture.library.queue_conversion("not-an-upload")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.conversion_worker.is_alive())

    def test_startup_removes_private_encoder_orphans_not_customer_media(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media = root / "media"
            incoming = media / ".incoming"
            channel = media / "kids-tv"
            incoming.mkdir(parents=True)
            channel.mkdir()
            (incoming / "dead.optimising.mp4").write_bytes(b"orphan")
            (incoming / "dead.ffmpeg.log").write_text("interrupted", encoding="utf-8")
            (incoming / "old.result.json").write_text(json.dumps({
                "id": "0" * 32, "status": "error", "finished": time.time(),
            }), encoding="utf-8")
            customer_video = channel / "Holiday.optimising.mp4"
            customer_video.write_bytes(b"keep")
            channels = root / "channels.json"
            channels.write_text(json.dumps({
                "schema_version": 1,
                "channels": [{"number": 1, "name": "Kids TV",
                              "folder": "kids-tv", "aspect": "crop"}],
            }), encoding="utf-8")
            settings = root / "settings.json"
            settings.write_text('{"schema_version": 1}\n', encoding="utf-8")
            config = root / "library.conf"
            config.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")
            library = mabeltv_library.Library(argparse.Namespace(
                media_root=str(media), channels=str(channels), settings=str(settings),
                owner=str(root / "owner.json"), config=str(config),
            ))
            try:
                self.assertFalse((incoming / "dead.optimising.mp4").exists())
                self.assertFalse((incoming / "dead.ffmpeg.log").exists())
                self.assertTrue((incoming / "old.result.json").exists())
                self.assertTrue(customer_video.exists())
            finally:
                library.close()

    def test_abandonment_cleanup_uses_recent_activity_and_preserves_queued_work(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        incoming = self.fixture.media / ".incoming"
        old = time.time() - 8 * 24 * 60 * 60

        recent = self.fixture.library.upload_create({
            "channel": 1, "file_name": "recent.mp4", "size": 10,
        })
        self.fixture.library.append_upload(recent["id"], 0, b"12345")
        recent_manifest = incoming / f"{recent['id']}.json"
        recent_meta = self.fixture.library.read_json(recent_manifest, {})
        recent_meta["created"] = old
        self.fixture.library.write_json(recent_manifest, recent_meta)
        os.utime(recent_manifest, (old, old))

        queued = self.fixture.library.upload_create({
            "channel": 1, "file_name": "queued.mp4", "size": 5,
        })
        queued_manifest = incoming / f"{queued['id']}.json"
        queued_part = incoming / f"{queued['id']}.part"
        queued_part.write_bytes(b"ready")
        queued_meta = self.fixture.library.read_json(queued_manifest, {})
        queued_meta.update({"created": old, "updated": old, "status": "queued"})
        self.fixture.library.write_json(queued_manifest, queued_meta)
        os.utime(queued_manifest, (old, old)); os.utime(queued_part, (old, old))

        abandoned = self.fixture.library.upload_create({
            "channel": 1, "file_name": "abandoned.mp4", "size": 5,
        })
        abandoned_manifest = incoming / f"{abandoned['id']}.json"
        abandoned_meta = self.fixture.library.read_json(abandoned_manifest, {})
        abandoned_meta.update({"created": old, "updated": old})
        self.fixture.library.write_json(abandoned_manifest, abandoned_meta)
        os.utime(abandoned_manifest, (old, old))

        self.fixture.library.cleanup_stale_temporary_files()
        self.assertTrue(recent_manifest.exists())
        self.assertTrue(queued_manifest.exists())
        self.assertTrue(queued_part.exists())
        self.assertFalse(abandoned_manifest.exists())


class UsbAndMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.usb_root = self.fixture.root / "usb"
        self.volume = self.usb_root / "TEST-USB"
        self.volume.mkdir(parents=True)
        self.fixture.library.usb_root = self.usb_root.resolve()
        self.fixture.library.usb_requires_mount = False
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

    def tearDown(self) -> None:
        self.fixture.close()

    def test_interrupted_usb_copy_is_removed_from_private_staging(self) -> None:
        partial = self.fixture.library.incoming / ("usb-" + "a" * 32 + "-0.part")
        partial.write_bytes(b"unfinished")
        self.fixture.library.cleanup_stale_temporary_files()
        self.assertFalse(partial.exists())

    def test_usb_hard_disk_is_offered_even_when_not_marked_removable(self) -> None:
        block_devices = {"blockdevices": [{
            "name": "sda", "path": "/dev/sda", "type": "disk", "tran": "usb",
            "rm": False, "mountpoints": [], "children": [{
                "name": "sda1", "path": "/dev/sda1", "type": "part",
                "pkname": "sda", "uuid": "WD-USB", "label": "My Passport",
                "fstype": "ntfs", "size": 2_000_000_000_000, "mountpoints": [],
            }],
        }]}
        completed = types.SimpleNamespace(stdout=json.dumps(block_devices))
        self.fixture.library.usb_requires_mount = True
        with mock.patch.object(mabeltv_library.subprocess, "run", return_value=completed):
            result = self.fixture.library.usb_volumes()
        self.assertEqual(result["volumes"][0]["device"], "/dev/sda1")
        self.assertEqual(result["volumes"][0]["label"], "My Passport")

    def test_usb_drive_sleeps_after_one_idle_minute_without_disappearing(self) -> None:
        library = self.fixture.library
        library.usb_idle_seconds = 60
        library.usb_last_activity["TEST-USB"] = 100
        with mock.patch.object(library, "usb_busy_reason", return_value=None), \
                mock.patch.object(library, "_run_usb_helper",
                                  return_value="The USB drive is sleeping.") as helper:
            library.usb_power_tick(now=161)
        helper.assert_called_once_with("usb-sleep", "")
        self.assertIn("TEST-USB", library.usb_sleeping)
        volume = library.usb_volumes()["volumes"][0]
        self.assertTrue(volume["sleeping"])
        self.assertTrue(volume["mounted"])

    def test_usb_activity_postpones_automatic_sleep(self) -> None:
        library = self.fixture.library
        movie = self.volume / "Still Playing.mp4"
        movie.write_bytes(b"browser-ready")
        library.player_state_path = self.fixture.root / "player-state.json"
        library.player_state_path.write_text('{"standby": true}', encoding="utf-8")
        library.start_remote_stream({
            "kind": "usb", "volume": "TEST-USB", "file": movie.name,
        })
        library.usb_idle_seconds = 60
        library.usb_last_activity["TEST-USB"] = 100
        with mock.patch.object(library, "_run_usb_helper") as helper:
            library.usb_power_tick(now=161)
        helper.assert_not_called()
        self.assertNotIn("TEST-USB", library.usb_sleeping)
        self.assertGreater(library.usb_last_activity["TEST-USB"], 161)

    def test_usb_import_postpones_automatic_sleep(self) -> None:
        library = self.fixture.library
        library.usb_imports["active"] = {
            "id": "active", "volume": "TEST-USB", "status": "copying",
        }
        library.usb_idle_seconds = 60
        library.usb_last_activity["TEST-USB"] = 100
        with mock.patch.object(library, "_run_usb_helper") as helper:
            library.usb_power_tick(now=161)
        helper.assert_not_called()
        self.assertNotIn("TEST-USB", library.usb_sleeping)

    def test_usb_use_wakes_and_mounts_a_sleeping_drive(self) -> None:
        library = self.fixture.library
        library.usb_requires_mount = True
        with mock.patch.object(library, "usb_mount_path",
                               side_effect=[ValueError("sleeping"), self.volume.resolve()]), \
                mock.patch.object(library, "_usb_volume",
                                  return_value={"id": "TEST-USB", "device": "/dev/sda1"}), \
                mock.patch.object(library, "usb_mount") as mount:
            root = library.usb_ensure_awake("TEST-USB")
        mount.assert_called_once_with("/dev/sda1")
        self.assertEqual(root, self.volume.resolve())

    def test_full_eject_works_while_drive_is_sleeping(self) -> None:
        library = self.fixture.library
        library.usb_sleeping.add("TEST-USB")
        with mock.patch.object(library, "_usb_volume", return_value={
                "id": "TEST-USB", "device": "/dev/sda1", "mounted": False,
        }), mock.patch.object(library, "usb_busy_reason", return_value=None), \
                mock.patch.object(library, "_run_usb_helper",
                                  return_value="The USB drive can now be unplugged safely.") as helper:
            result = library.usb_eject("TEST-USB")
        helper.assert_called_once_with("usb-eject", "/dev/sda1")
        self.assertTrue(result["ok"])
        self.assertNotIn("TEST-USB", library.usb_sleeping)

    def test_usb_portal_distinguishes_sleep_from_full_eject(self) -> None:
        self.assertIn("Sleeps after 1 idle minute", PORTAL_SOURCE)
        self.assertIn("volume.sleeping ? 'Wake & open'", PORTAL_SOURCE)
        self.assertIn('id="usbEjectSheet"', PORTAL_SOURCE)
        self.assertIn("You will need to unplug and reconnect it", PORTAL_SOURCE)
        self.assertNotIn("confirm('Safely eject this USB drive?", PORTAL_SOURCE)

    def test_usb_system_disk_is_never_offered(self) -> None:
        block_devices = {"blockdevices": [{
            "name": "sda", "path": "/dev/sda", "type": "disk", "tran": "usb",
            "rm": False, "mountpoints": [], "children": [{
                "name": "sda2", "path": "/dev/sda2", "type": "part",
                "pkname": "sda", "uuid": "ROOT", "fstype": "ext4",
                "size": 64_000_000_000, "mountpoints": ["/"],
            }],
        }]}
        completed = types.SimpleNamespace(stdout=json.dumps(block_devices))
        self.fixture.library.usb_requires_mount = True
        with mock.patch.object(mabeltv_library.subprocess, "run", return_value=completed):
            result = self.fixture.library.usb_volumes()
        self.assertEqual(result["volumes"], [])

    def test_usb_browser_only_exposes_video_files_and_safe_relative_paths(self) -> None:
        (self.volume / "Films").mkdir()
        (self.volume / "$RECYCLE.BIN").mkdir()
        (self.volume / "System Volume Information").mkdir()
        (self.volume / "Films" / "Movie.mkv").write_bytes(b"video")
        (self.volume / "notes.txt").write_text("private", encoding="utf-8")
        listing = self.fixture.library.usb_browse("TEST-USB")
        self.assertEqual([(item["name"], item["type"]) for item in listing["entries"]],
                         [("Films", "folder")])
        films = self.fixture.library.usb_browse("TEST-USB", "Films")
        self.assertEqual(films["entries"][0]["path"], "Films/Movie.mkv")
        self.assertFalse(films["entries"][0]["browser_ready"])
        with self.assertRaisesRegex(ValueError, "path"):
            self.fixture.library.usb_browse("TEST-USB", "../")

    def test_usb_browser_stream_uses_resolved_mounted_media(self) -> None:
        movie = self.volume / "Phone Movie.mp4"
        movie.write_bytes(b"browser-ready")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text('{"standby": true}', encoding="utf-8")
        started = self.fixture.library.start_remote_stream({
            "kind": "usb", "volume": "TEST-USB", "file": "Phone Movie.mp4",
        })
        token = started["stream_url"].split("stream=", 1)[1]
        session = self.fixture.library.remote_session(token)
        self.assertEqual(session["kind"], "usb")
        self.assertEqual(session["source"], movie.resolve())
        self.assertEqual(started["resume_position"], 0)
        with self.assertRaisesRegex(ValueError, "path"):
            self.fixture.library.start_remote_stream({
                "kind": "usb", "volume": "TEST-USB", "file": "../outside.mp4",
            })

    def test_incompatible_usb_video_gets_scoped_vlc_stream(self) -> None:
        movie = self.volume / "Legacy Episode.avi"
        movie.write_bytes(b"legacy-video")
        started = self.fixture.library.start_external_stream({
            "kind": "usb", "volume": "TEST-USB", "file": "Legacy Episode.avi",
        })
        self.assertIn("/api/external/media?", started["stream_url"])
        self.assertEqual(started["title"], "Legacy Episode")
        session = self.fixture.library.external_stream_session(started["stream"])
        self.assertEqual(session["source"], movie.resolve())
        self.fixture.library.release_external_stream(started["stream"])
        with self.assertRaisesRegex(ValueError, "expired"):
            self.fixture.library.external_stream_session(started["stream"])

    def test_browser_ready_usb_video_can_start_private_offline_download(self) -> None:
        movie = self.volume / "Phone Movie.mp4"
        movie.write_bytes(b"phone-ready")
        with mock.patch.object(self.fixture.library, "offline_media_profile",
                               return_value="direct"):
            started = self.fixture.library.start_offline_download({
                "kind": "usb", "volume": "TEST-USB", "file": "Phone Movie.mp4",
            })
        self.assertEqual(started["status"], "ready")
        self.assertIn("/api/offline/media?", started["stream_url"])
        self.assertEqual(started["size"], len(b"phone-ready"))

    def test_incompatible_usb_download_is_queued_for_browser_preparation(self) -> None:
        movie = self.volume / "Legacy Episode.avi"
        movie.write_bytes(b"legacy-video")
        with mock.patch.object(self.fixture.library, "offline_media_profile",
                               return_value="repack"), \
                mock.patch.object(mabeltv_library.threading, "Thread") as thread:
            queued = self.fixture.library.start_offline_download({
                "kind": "usb", "volume": "TEST-USB", "file": "Legacy Episode.avi",
            })
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["preparation"], "repack")
        thread.assert_called_once()

    def test_usb_eject_is_blocked_during_browser_stream(self) -> None:
        movie = self.volume / "Phone Movie.mp4"
        movie.write_bytes(b"browser-ready")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text('{"standby": true}', encoding="utf-8")
        self.fixture.library.start_remote_stream({
            "kind": "usb", "volume": "TEST-USB", "file": "Phone Movie.mp4",
        })
        with self.assertRaisesRegex(ValueError, "Stop watching"):
            self.fixture.library.usb_eject("TEST-USB")

    def test_usb_folder_import_copies_atomically_into_adult_library(self) -> None:
        folder = self.volume / "Films"
        folder.mkdir()
        (folder / "One.mp4").write_bytes(b"one" * 1000)
        (folder / "Two.mkv").write_bytes(b"two" * 1000)
        (folder / "ignore.txt").write_text("no", encoding="utf-8")
        job = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": ["Films"], "target": "adult",
        })
        deadline = time.time() + 5
        result = job
        while result["status"] not in {"complete", "error"} and time.time() < deadline:
            time.sleep(0.02)
            result = self.fixture.library.usb_import_status(job["id"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["files_done"], 2)
        self.assertEqual((self.fixture.library.adult_root / "One.mp4").read_bytes(),
                         b"one" * 1000)
        self.assertFalse(any(self.fixture.library.adult_root.glob("*.part")))
        self.fixture.library.refresh_tv.assert_called_once()

    def test_usb_direct_play_sends_only_resolved_mounted_media(self) -> None:
        movie = self.volume / "Movie.mp4"
        movie.write_bytes(b"video")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.usb_play("TEST-USB", "Movie.mp4")
        sent = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(sent["command"], "play-external")
        self.assertEqual(Path(sent["path"]), movie.resolve())
        self.assertTrue(result["ok"])

    def test_portal_play_on_tv_resolves_channel_and_adult_library_items(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        channel_movie = self.fixture.media / "kids-tv" / "Episode.mp4"
        channel_movie.parent.mkdir(parents=True, exist_ok=True)
        channel_movie.write_bytes(b"video")
        adult_movie = self.fixture.library.adult_root / "Films" / "Film.mkv"
        adult_movie.parent.mkdir(parents=True, exist_ok=True)
        adult_movie.write_bytes(b"film")
        self.fixture.library.adult_library()
        adult_states = self.fixture.library.adult_media_states()
        adult_states["Films/Film.mkv"].update({
            "remote_position": 842.5,
            "remote_duration": 7200,
            "remote_last_watched": 200,
        })
        self.fixture.library.write_adult_media_states(adult_states)
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context), \
                mock.patch.object(mabeltv_library.time, "sleep") as sleep:
            channel_result = self.fixture.library.play_on_tv({
                "kind": "channel", "channel": 1, "file": "Episode.mp4",
            })
            adult_result = self.fixture.library.play_on_tv({
                "kind": "adult", "file": "Films/Film.mkv",
            })
        channel_command = json.loads(client.sendall.call_args_list[0].args[0].decode())
        adult_command = json.loads(client.sendall.call_args_list[1].args[0].decode())
        self.assertEqual(channel_command,
                         {"command": "play-programme", "channel": 1, "file": "Episode.mp4"})
        self.assertEqual(adult_command,
                         {"command": "play-adult-film", "file": "Films/Film.mkv",
                          "position": 842.5})
        self.assertTrue(channel_result["ok"])
        self.assertTrue(adult_result["ok"])
        sleep.assert_not_called()

        channels = self.fixture.library.channels()
        channels[0]["content_type"] = "films"
        self.fixture.library.write_json(
            self.fixture.library.channels_path,
            {"schema_version": 1, "channels": channels})
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context), \
                mock.patch.object(mabeltv_library.time, "sleep") as sleep:
            film_channel_result = self.fixture.library.play_on_tv({
                "kind": "channel", "channel": 1, "file": "Episode.mp4",
            })
        film_commands = [call.args[0].decode().strip()
                         for call in client.sendall.call_args_list[-2:]]
        self.assertEqual(json.loads(film_commands[0]),
                         {"command": "play-programme", "channel": 1,
                          "file": "Episode.mp4"})
        self.assertEqual(film_commands[1], "select")
        sleep.assert_called_once_with(0.8)
        self.assertTrue(film_channel_result["ok"])

        with self.assertRaisesRegex(ValueError, "no longer"):
            self.fixture.library.play_on_tv({
                "kind": "adult", "file": "Films/Missing.mkv",
            })

    def test_portal_play_on_tv_treats_a_sent_command_as_accepted_if_ack_is_late(self) -> None:
        adult_movie = self.fixture.library.adult_root / "Passengers (2016).mp4"
        adult_movie.write_bytes(b"film")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.side_effect = mabeltv_library.socket.timeout("late acknowledgement")

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.play_on_tv({
                "kind": "adult", "file": adult_movie.name,
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["message"], "Starting Passengers (2016) on Mabel TV")
        client.sendall.assert_called_once()

    def test_portal_play_on_tv_still_reports_a_real_connection_failure(self) -> None:
        adult_movie = self.fixture.library.adult_root / "Film.mp4"
        adult_movie.write_bytes(b"film")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.connect.side_effect = OSError("player unavailable")

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context), \
                self.assertRaisesRegex(ValueError, "not ready to start"):
            self.fixture.library.play_on_tv({
                "kind": "adult", "file": adult_movie.name,
            })

    def test_tmdb_search_and_apply_cache_metadata_without_exposing_key(self) -> None:
        movie = self.fixture.library.adult_root / "Fellowship of the Ring 2001.mkv"
        movie.write_bytes(b"video")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [{"id": 120, "title": "The Lord of the Rings: The Fellowship of the Ring",
                           "original_title": "The Lord of the Rings: The Fellowship of the Ring",
                           "release_date": "2001-12-19", "overview": "A journey begins.",
                           "poster_path": None}]},
            {"id": 120, "title": "The Lord of the Rings: The Fellowship of the Ring",
             "original_title": "The Lord of the Rings: The Fellowship of the Ring",
             "release_date": "2001-12-19", "overview": "A journey begins.",
             "runtime": 179, "poster_path": None},
        ])
        found = self.fixture.library.tmdb_search({"file": movie.name})
        self.assertEqual(found["results"][0]["id"], 120)
        applied = self.fixture.library.tmdb_apply({"file": movie.name, "tmdb_id": 120})
        self.assertTrue(applied["refreshed"])
        film = self.fixture.library.adult_library()[0]
        self.assertEqual(film["metadata"]["runtime"], 179)
        self.assertEqual(film["metadata"]["provider"], "TMDB")
        persisted = self.fixture.library.adult_media_states()[movie.name]
        self.assertNotIn("api_key", json.dumps(persisted))

    def test_tmdb_apply_automatically_fetches_one_matching_english_subtitle(self) -> None:
        movie = self.fixture.library.adult_root / "Fellowship of the Ring 2001.mkv"
        movie.write_bytes(b"video")
        self.fixture.library.tmdb_request = mock.Mock(return_value={
            "id": 120, "title": "The Lord of the Rings: The Fellowship of the Ring",
            "original_title": "The Lord of the Rings: The Fellowship of the Ring",
            "release_date": "2001-12-19", "overview": "A journey begins.",
            "runtime": 179, "poster_path": None,
        })
        self.fixture.library.subtitle_availability = mock.Mock(return_value={"status": "missing"})
        self.fixture.library.opensubtitles_key = mock.Mock(return_value="private-consumer-key")
        self.fixture.library.opensubtitles_request = mock.Mock(side_effect=[
            {"data": [{"attributes": {"language": "en", "hearing_impaired": False,
                                          "ratings": 8.0, "download_count": 20,
                                          # OpenSubtitles commonly returns a
                                          # release name with no .srt suffix.
                                          "files": [{"file_id": 555,
                                                     "file_name": "film.en"}]}}]},
            {"link": "https://example.invalid/subtitle"},
        ])
        self.fixture.library.opensubtitles_download_bytes = mock.Mock(
            return_value=b"1\n00:00:01,000 --> 00:00:02,000\nHello.\n")

        applied = self.fixture.library.tmdb_apply({"file": movie.name, "tmdb_id": 120})

        subtitle = movie.with_name("Fellowship of the Ring 2001.en.srt")
        self.assertTrue(subtitle.is_file())
        self.assertEqual(applied["metadata"]["subtitles"]["status"], "downloaded")
        self.assertEqual(applied["metadata"]["subtitles"]["file"], subtitle.name)
        self.assertEqual(self.fixture.library.opensubtitles_request.call_args_list[0].args[0],
                         "subtitles")
        self.assertNotIn("private-consumer-key",
                         json.dumps(self.fixture.library.adult_media_states()))

    def test_tmdb_apply_keeps_existing_subtitles_and_does_not_contact_provider(self) -> None:
        movie = self.fixture.library.adult_root / "Film.mkv"
        movie.write_bytes(b"video")
        sidecar = movie.with_name("Film.en.srt")
        sidecar.write_text("1\n00:00:01,000 --> 00:00:02,000\nHello.\n", encoding="utf-8")
        self.fixture.library.tmdb_request = mock.Mock(return_value={
            "id": 120, "title": "Film", "original_title": "Film",
            "release_date": "2001-12-19", "overview": "", "runtime": 90,
            "poster_path": None,
        })
        self.fixture.library.opensubtitles_request = mock.Mock()

        applied = self.fixture.library.tmdb_apply({"file": movie.name, "tmdb_id": 120})

        self.assertEqual(applied["metadata"]["subtitles"],
                         {"status": "external", "file": sidecar.name})
        self.fixture.library.opensubtitles_request.assert_not_called()

    def test_tmdb_read_access_token_uses_bearer_header(self) -> None:
        token = "eyJ" + "a" * 8 + ".payload.signature"
        self.fixture.library.tmdb_key = mock.Mock(return_value=token)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.return_value = b'{"results": []}'
        with mock.patch.object(mabeltv_library, "urlopen", return_value=response) as request:
            self.fixture.library.tmdb_request("search/movie", {"query": "Fellowship"})
        sent = request.call_args.args[0]
        self.assertEqual(sent.headers["Authorization"], f"Bearer {token}")
        self.assertNotIn("api_key", sent.full_url)

    def test_channel_metadata_caches_one_show_identity_and_each_film(self) -> None:
        channels = [
            {"number": 1, "name": "Puffin Rock", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        (self.fixture.media / "shows").mkdir(parents=True)
        (self.fixture.media / "shows" / "Episode 1.mp4").write_bytes(b"show")
        (self.fixture.media / "films").mkdir(parents=True)
        (self.fixture.media / "films" / "Cinderella 1950.mp4").write_bytes(b"film")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [{"id": 100}]},
            {"id": 100, "name": "Puffin Rock", "overview": "Island adventures.",
             "first_air_date": "2015-01-01", "backdrop_path": "/show.jpg"},
            {"results": [{"id": 200}]},
            {"id": 200, "title": "Cinderella", "overview": "A timeless tale.",
             "release_date": "1950-02-15", "poster_path": "/film.jpg"},
        ])
        self.fixture.library.cache_channel_artwork = mock.Mock(
            side_effect=["mabel-show-1-100.jpg", "mabel-film-5-200.jpg"])

        result = self.fixture.library.refresh_channel_metadata()

        self.assertEqual(result, {"ok": True, "updated": 2, "skipped": 0})
        rendered = self.fixture.library.library()["channels"]
        show = next(channel for channel in rendered if channel["number"] == 1)
        films = next(channel for channel in rendered if channel["number"] == 5)
        self.assertEqual(show["metadata"]["artwork"], "mabel-show-1-100.jpg")
        self.assertEqual(show["programmes"][0]["metadata"], {})
        self.assertEqual(films["programmes"][0]["metadata"]["poster"],
                         "mabel-film-5-200.jpg")
        self.assertEqual(
            self.fixture.library.tmdb_request.call_args_list[2].args[1]["year"],
            1950)

    def test_portal_theme_is_validated_and_exposed(self) -> None:
        self.fixture.library.manage({"action": "set-portal-theme", "theme": "light"})
        self.assertEqual(self.fixture.library.library()["appearance"]["portal_theme"],
                         "light")
        with self.assertRaisesRegex(ValueError, "light or dark"):
            self.fixture.library.manage({"action": "set-portal-theme", "theme": "blue"})

    def test_portal_design_and_palette_are_validated_and_exposed(self) -> None:
        self.fixture.library.manage({"action": "set-portal-design", "design": "aperture"})
        self.fixture.library.manage({"action": "set-portal-palette", "palette": "tide"})
        appearance = self.fixture.library.library()["appearance"]
        self.assertEqual(appearance["portal_design"], "aperture")
        self.assertEqual(appearance["portal_palette"], "tide")
        with self.assertRaisesRegex(ValueError, "current, Signal, or Aperture"):
            self.fixture.library.manage({"action": "set-portal-design", "design": "retro"})
        with self.assertRaisesRegex(ValueError, "available portal palettes"):
            self.fixture.library.manage({"action": "set-portal-palette", "palette": "neon"})

    def test_adult_playback_state_updates_preserve_cached_metadata(self) -> None:
        self.fixture.library.write_adult_media_states({
            "Film.mkv": {"metadata": {"tmdb_id": 1, "title": "Film"}},
        })
        self.fixture.library.set_adult_media_state("Film.mkv", "processing")
        state = self.fixture.library.adult_media_states()["Film.mkv"]
        self.assertEqual(state["metadata"]["tmdb_id"], 1)
        self.assertEqual(state["state"], "processing")


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
                             ("/mabeltv-offline.js", b"startDownload"),
                             ("/portal/css/tokens.css", b"--control-min: 44px"),
                             ("/portal/css/components.css", b"@layer components"),
                             ("/portal/icons.svg", b'id="settings"'),
                             ("/portal/js/core.js", b"function initialise"),
                             ("/portal/css/experience-foundation.css", b"--experience-orange"),
                             ("/portal/css/experience-shell.css", b".portal-nav"),
                             ("/portal/css/experience-overlays.css", b"--experience-sheet-gutter"),
                             ("/portal/css/experience-light.css", b'data-experience-theme="light"'),
                             ("/portal/js/experience-theme.js", b"mabeltv-experience-theme"),
                             ("/portal/css/classic-foundation.css", b"--accent: #ff7a1a"),
                             ("/portal/css/portal-design-switch.css", b".portal-design-option"),
                             ("/portal/js/actions.js", b"managementBusy")):
            with urllib.request.urlopen(self.base + path, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get("Connection"), "close")
                self.assertIn(marker, response.read())

    def test_portal_design_cookie_selects_classic_while_experience_is_default(self) -> None:
        with urllib.request.urlopen(self.base + "/", timeout=5) as response:
            default_html = response.read().decode()
        self.assertIn('class="portal-v2 portal-experience"', default_html)
        self.assertNotIn('/portal/css/classic-foundation.css', default_html)

        request = urllib.request.Request(self.base + "/")
        request.add_header("Cookie", "mabeltv_portal_design=classic")
        with urllib.request.urlopen(request, timeout=5) as response:
            classic_html = response.read().decode()
        self.assertIn('class="portal-v2 portal-classic"', classic_html)
        self.assertIn('/portal/css/classic-foundation.css', classic_html)
        self.assertNotIn('/portal/css/experience-foundation.css', classic_html)

    def test_portal_asset_handler_rejects_path_traversal(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(
                self.base + "/portal/../mabeltv-library.py", timeout=5)
        self.assertEqual(raised.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
