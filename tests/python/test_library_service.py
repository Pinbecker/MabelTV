from __future__ import annotations

import argparse
import http.cookiejar
import importlib.util
import inspect
import json
import os
import re
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
    for name in ("core.js", "channel-page.js", "library.js", "playback.js",
                 "adult-viewing.js", "actions.js")
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
        self.assertIn("const uploadSourceId", index)
        self.assertIn("waitForUploadTurn", index)
        self.assertIn("source_id: uploadSourceId", index)
        self.assertIn("Promise.all(queued.map", index)
        self.assertIn("All partially uploaded data for it will be deleted", index)
        self.assertIn("Your original film will be kept", index)
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
            "experience-viewing",
            "experience-settings", "experience-responsive", "experience-overlays",
            "portal-design-switch", "experience-light",
        )
        js_names = ("core", "channel-page", "library", "playback",
                    "adult-viewing", "actions")

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
        self.assertIn('class="mobile-activity-status is-idle hidden"', html)
        self.assertIn("header.classList.toggle('is-idle', !headerLabel)", PORTAL_SCRIPT)
        logo = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-icon.png").read_bytes()
        self.assertTrue(logo.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertTrue(logo.endswith(b"IEND\xaeB`\x82"))
        self.assertIn("*.png binary", (PROJECT_ROOT / ".gitattributes").read_text(
            encoding="utf-8"))
        self.assertTrue((PORTAL_ROOT / "icons.svg").is_file())
        self.assertIn('portal-include:html/app-shell.html', source)
        self.assertLess(len(source), 5_000)
        self.assertNotIn('portal-include:', html)
        for name in ("overview", "live", "channels", "adult", "watch", "usb", "system"):
            self.assertTrue((PORTAL_ROOT / "html" / "views" / f"{name}.html").is_file())
        self.assertTrue((PORTAL_ROOT / "html" / "views" / "adult-viewing.html").is_file())
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
        playback = (PORTAL_ROOT / "js" / "playback.js").read_text(
            encoding="utf-8")
        markup = (PORTAL_ROOT / "html" / "overlays.html").read_text(
            encoding="utf-8")
        channel_page = (PORTAL_ROOT / "js" / "channel-page.js").read_text(
            encoding="utf-8")

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
        self.assertIn('<meta name="apple-mobile-web-app-status-bar-style" content="default">', html)
        self.assertIn('<meta name="apple-mobile-web-app-status-bar-style" content="default">', classic)
        self.assertIn('<meta name="theme-color" content="#0b0a0d">', classic)
        self.assertIn('id="experienceThemeToggle"', html)
        self.assertIn('role="switch"', html)
        self.assertIn("mabeltv-experience-theme", theme_script)
        self.assertIn("localStorage.setItem(STORAGE_KEY, theme)", theme_script)
        self.assertIn("dark: 'default'", theme_script)
        self.assertIn("light: 'default'", theme_script)
        self.assertNotIn("black-translucent", theme_script)
        mobile_head = styles[styles.rindex("body.portal-v2 .mobile-head {"):]
        mobile_head = mobile_head[:mobile_head.index("}")]
        self.assertIn("backdrop-filter: none", mobile_head)
        self.assertIn("--experience-sheet-gutter", styles)
        self.assertIn("dialog:is(.library-sheet, .watch-sheet, .watch-film-sheet", styles)
        self.assertIn(".watch-native-select", styles)
        self.assertNotIn('id="watchCollectionSelect"', html)
        self.assertNotIn("renderWatchCollections", playback)
        self.assertIn('class="adult-series-title-row"', html)
        self.assertIn('aria-label="New series"', html)
        self.assertIn('channel-upload-sheet', markup)
        self.assertIn('channel-upload-form', markup)
        self.assertIn('channel-page-title-row', channel_page)
        self.assertNotIn('id="watchCollectionSheet"', html)
        self.assertIn('id="watchMabelSearch"', html)
        self.assertIn('id="watchMabelContinueSection"', html)
        self.assertIn('id="homeFilmSearch"', html)
        self.assertIn('id="homeFavouritesSection"', html)
        self.assertIn('id="homeContinueSection"', html)
        self.assertNotIn('id="homeResumeSheet"', html)
        self.assertIn('id="watchChannelSheet"', html)
        self.assertNotIn('id="watchFilmStartOverTv"', html)
        self.assertNotIn('id="watchFilmStartOverHere"', html)
        self.assertIn('id="filmResumeChoiceSheet"', html)
        self.assertIn('id="filmResumeContinue"', html)
        self.assertIn('id="filmResumeRestart"', html)
        self.assertIn("api('/api/favourite'", PORTAL_SCRIPT)
        self.assertIn("setChannelFavourite", PORTAL_SCRIPT)
        self.assertIn("openFilmEntry(entry, 'continue')", PORTAL_SCRIPT)
        self.assertIn("homePosterTile(value.entry, 'favourite')", PORTAL_SCRIPT)
        self.assertIn("context === 'favourite' && resumable", PORTAL_SCRIPT)
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
        self.assertIn('id="homeSpotlightArt"', html)
        self.assertNotIn('class="home-destinations"', html)
        self.assertIn('id="systemStatusDisclosure" class="settings-disclosure" open', html)
        self.assertNotIn('class="home-orbit', html)
        self.assertNotIn('class="home-monogram"', html)
        self.assertIn("grid-template-columns: clamp(130px, 14vw, 178px) minmax(0, 1fr)", styles)
        self.assertIn("grid-template-columns: 104px minmax(0, 1fr)", styles)
        self.assertIn("aspect-ratio: 2 / 3", styles)
        self.assertIn("function homeArtworkForState(state)", core)
        self.assertIn("if (!currentTitle) return null", core)
        self.assertIn("setHomeSpotlightArtwork(state)", core)
        self.assertIn("/api/channel/artwork/", core)
        self.assertIn("/api/adult/artwork/", core)
        self.assertIn("status.scrollIntoView", core)
        self.assertIn('class="remote-app"', html)
        self.assertIn('href="/portal/icons.svg#signal-tv"', html)
        self.assertIn('href="/portal/icons.svg#signal-volume"', html)
        self.assertIn('id="remoteWidescreen"', html)
        self.assertIn('href="/portal/icons.svg#signal-maximize"', html)
        self.assertIn('class="remote-dock-action-label"', html)
        self.assertIn("querySelector('.remote-dock-action-label')", core)
        self.assertIn(".remote-mode-icon", styles)
        self.assertIn(".remote-pad .select", styles)
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
        self.assertIn('id="signal-volume"', icons)
        self.assertIn('id="signal-power"', icons)
        self.assertIn('id="signal-maximize"', icons)
        self.assertTrue((PORTAL_ROOT / "LICENSE-LUCIDE.txt").is_file())

    def test_experience_overlay_system_covers_every_portal_dialog_family(self) -> None:
        markup = (PORTAL_ROOT / "html" / "overlays.html").read_text(
            encoding="utf-8")
        styles = (PORTAL_ROOT / "css" / "experience-overlays.css").read_text(
            encoding="utf-8")
        light_styles = (PORTAL_ROOT / "css" / "experience-light.css").read_text(
            encoding="utf-8")
        dialog_selector = styles.split("dialog:is(", 1)[1].split(")", 1)[0]
        light_dialog_selector = light_styles.split("dialog:is(", 1)[1].split(")", 1)[0]

        families = (
            "library-sheet", "watch-film-sheet",
            "watch-programme-sheet", "remote-sheet", "tmdb-dialog",
        )
        for family in families:
            with self.subTest(family=family):
                self.assertIn(f"class=\"{family}", markup)
                self.assertIn(f".{family}", dialog_selector)
                self.assertIn(f".{family}", light_dialog_selector)

        self.assertIn(".remote-sheet-panel", styles)
        self.assertIn(".remote-sheet-panel > header", styles)
        self.assertIn(".portal-sheet-close", styles)
        self.assertIn(".remote-sheet-handle", styles)
        self.assertIn(".remote-channel-options, .remote-power-actions", styles)
        self.assertIn("grid-template-columns: 44px minmax(0, 1fr)", styles)
        self.assertIn(".remote-channel-option > span:last-child", styles)
        self.assertIn(".remote-sheet-panel", light_styles)
        self.assertIn(".remote-sheet-panel > header", light_styles)
        self.assertIn(".remote-sheet-close", light_styles)

    def test_media_sheets_share_header_geometry_and_parent_navigation(self) -> None:
        markup = (PORTAL_ROOT / "html" / "overlays.html").read_text(
            encoding="utf-8")
        core = (PORTAL_ROOT / "js" / "core.js").read_text(encoding="utf-8")
        playback = (PORTAL_ROOT / "js" / "playback.js").read_text(
            encoding="utf-8")
        styles = (PORTAL_ROOT / "css" / "experience-overlays.css").read_text(
            encoding="utf-8")

        for dialog in re.findall(r"<dialog\b.*?</dialog>", markup, re.DOTALL):
            with self.subTest(dialog=re.search(r'id="([^"]+)"', dialog).group(1)):
                self.assertIn("portal-sheet-close", dialog)

        self.assertIn("const portalSheets = (() =>", core)
        self.assertIn("const parents = new WeakMap()", core)
        self.assertIn("return { open, close, dismiss }", core)
        self.assertIn("body.portal-experience .portal-sheet-close {", styles)
        self.assertIn("body.portal-experience .portal-sheet-title-row {", styles)
        self.assertIn("border: 1px solid rgba(255, 122, 26, 0.72);", styles)
        self.assertIn("-webkit-line-clamp: 2;", styles)
        self.assertIn("word-break: normal;", styles)
        self.assertIn(".watch-film-heading .portal-sheet-title-row", styles)
        self.assertIn("height: 104px;", styles)
        self.assertNotIn("series-header-favourite", markup)
        self.assertNotIn("dialog-close-bar .sheet-favourite", styles)

        for favourite_id, title_id in (
                ("watchFilmFavourite", "watchFilmTitle"),
                ("watchProgrammeFavourite", "watchProgrammeTitle"),
                ("adultSeriesFavourite", "adultSeriesSheetTitle"),
                ("watchChannelFavourite", "watchChannelTitle")):
            title_row = re.search(
                rf'<div class="portal-sheet-title-row">.*?id="{title_id}".*?'
                rf'id="{favourite_id}".*?</div>', markup, re.DOTALL)
            self.assertIsNotNone(title_row)

        episode_sheet = markup[
            markup.index('id="adultEpisodeSheet"'):
            markup.index('id="adultEpisodeMoreSheet"')]
        self.assertNotIn("sheet-favourite", episode_sheet)
        self.assertNotIn("watchProgrammeMoreReturn", playback)
        self.assertNotIn("adultEpisodeMoreReturn", playback)
        self.assertIn("openWatchProgrammeMoreSheet(channel, programme, context, parentReturn)", playback)
        self.assertIn("returnTo: () => openAdultEpisodeSheet(current, episode, returnTo)", playback)
        self.assertIn("card.onclick = () => openAdultEpisodeSheet(series, episode)", playback)

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
        experience_library = (PORTAL_ROOT / "css" / "experience-library.css").read_text(
            encoding="utf-8")
        experience_watch = (PORTAL_ROOT / "css" / "experience-watch.css").read_text(
            encoding="utf-8")
        experience_responsive = (PORTAL_ROOT / "css" / "experience-responsive.css").read_text(
            encoding="utf-8")
        experience_overlays = (PORTAL_ROOT / "css" / "experience-overlays.css").read_text(
            encoding="utf-8")

        self.assertIn('id="channelWorkspace" class="hidden" data-channel-page-root', html)
        self.assertNotIn('id="workspaceChannelName"', html)
        self.assertNotIn('id="programmeActionPlay"', html)
        self.assertIn("const ChannelPageComponents", channel_script)
        self.assertIn("function createShowCard", channel_script)
        self.assertIn("function createFilmCard", channel_script)
        self.assertNotIn("function createOverflowButton", channel_script)
        self.assertNotIn("channel-page-overflow", channel_script)
        self.assertIn("openWatchProgrammeSheet(selectedChannel, programme)", PORTAL_SCRIPT)
        self.assertIn('id="watchProgrammeMore"', html)
        self.assertIn('id="watchProgrammeMoreSheet"', html)
        self.assertIn('id="watchProgrammeMoreClose"', html)
        self.assertIn('id="watchProgrammeMetadata"', html)
        self.assertIn('id="watchProgrammeMove"', html)
        self.assertIn('id="watchProgrammeMoveSheet"', html)
        self.assertIn('id="watchProgrammeChannelOptions"', html)
        self.assertNotIn('id="watchProgrammeChannel"', html)
        self.assertIn('id="watchProgrammeToggle"', html)
        self.assertIn('id="watchProgrammeRename"', html)
        self.assertIn('id="watchProgrammeBin"', html)
        self.assertIn('id="watchProgrammeEpisodeTools"', html)
        self.assertIn('id="watchProgrammeEpisodeToggle"', html)
        self.assertIn('id="watchProgrammeEpisodeRename"', html)
        self.assertIn('id="watchProgrammeEpisodeBin"', html)
        self.assertNotIn('id="programmeActionSheet"', html)
        for action_id in (
                "watchProgrammeMore", "watchProgrammeMetadata", "watchProgrammeToggle",
                "watchProgrammeRename", "watchProgrammeMove",
                "watchProgrammeBin"):
            self.assertRegex(
                html, rf'id="{action_id}"\s+type="button"\s+class="watch-film-play')
        primary_start = html.index('id="watchProgrammeSheet"')
        more_start = html.index('id="watchProgrammeMoreSheet"')
        move_start = html.index('id="watchProgrammeMoveSheet"')
        primary_sheet = html[primary_start:more_start]
        more_sheet = html[more_start:move_start]
        for action_id in (
                "watchProgrammeTv", "watchProgrammeHere", "watchProgrammeFavourite",
                "watchProgrammeMore"):
            self.assertIn(f'id="{action_id}"', primary_sheet)
        primary_positions = [primary_sheet.index(f'id="{action_id}"') for action_id in (
            "watchProgrammeFavourite", "watchProgrammeTv", "watchProgrammeHere",
            "watchProgrammeMore")]
        self.assertEqual(primary_positions, sorted(primary_positions))
        for action_id in (
                "watchProgrammeDownload", "watchProgrammeMetadata", "watchProgrammeToggle",
                "watchProgrammeRename", "watchProgrammeMove", "watchProgrammeBin"):
            self.assertNotIn(f'id="{action_id}"', primary_sheet)
            self.assertIn(f'id="{action_id}"', more_sheet)
        self.assertIn("closeWatchProgrammeMoreSheet()", PORTAL_SCRIPT)
        self.assertNotIn('id="programmeActionMetadata"', html)
        self.assertIn("/api/tmdb/programme", PORTAL_SCRIPT)
        self.assertIn("scanProgrammeTmdb(channel, programme, () =>", PORTAL_SCRIPT)
        self.assertIn("manage('move-programme'", PORTAL_SCRIPT)
        self.assertIn("card.append(visual, copy)", channel_script)
        self.assertIn("card.append(main)", channel_script)
        self.assertNotIn("onManage", channel_script)
        self.assertIn("manage('toggle-programme'", PORTAL_SCRIPT)
        self.assertIn("renameProgramme(channel, programme)", PORTAL_SCRIPT)
        self.assertIn("const deepLink = `vlc://${mediaUrl}`", PORTAL_SCRIPT)
        self.assertNotIn("vlc-x-callback://", PORTAL_SCRIPT)
        self.assertIn("history.pushState({ channelPage: true, mabelWatchReturn:",
                      PORTAL_SCRIPT)
        self.assertIn("/^channel\\/(\\d+)\\/(watch|library)$/", PORTAL_SCRIPT)
        self.assertIn(".channel-page-programmes.is-film-grid", channel_styles)
        self.assertIn("body.portal-v2 .channel-page-programmes.is-film-grid", experience_library)
        self.assertIn("gap: 24px 12px", experience_library)
        self.assertIn("visual.className = 'watch-card-art'", channel_script)
        self.assertIn("copy.className = 'watch-card-copy'", channel_script)
        self.assertIn("progress.className = 'watch-progress'", channel_script)
        self.assertIn("is-film-grid watch-poster-grid", channel_script)
        self.assertIn("[metadata.year, channel.name]", channel_script)
        self.assertNotIn("[metadata.year, 'Choose where to watch']", channel_script)
        self.assertIn("gap: 22px 11px", experience_responsive)
        self.assertIn("body.portal-experience .watch-programme-film-tools", experience_overlays)
        self.assertIn("gap: 8px", experience_overlays)
        self.assertNotIn("!important", channel_styles)
        self.assertNotIn("previousProgrammePage", PORTAL_SCRIPT)
        self.assertNotIn("nextProgrammePage", PORTAL_SCRIPT)
        self.assertNotIn("Available in channel", PORTAL_SCRIPT)
        self.assertIn("function startMabelFilmArtCycle", PORTAL_SCRIPT)
        self.assertIn("Math.floor(Math.random() * artworks.length)", PORTAL_SCRIPT)
        self.assertIn(".mabel-film-head-art-layer", PORTAL_STYLES)
        self.assertIn("Resume at ${watchTimeLabel(programme.remote_position)}", PORTAL_SCRIPT)
        self.assertIn("Resume · ${filmTimeLabel(resume.position)}", channel_script)
        self.assertIn("card.className = 'watch-card watch-mabel-film-card'", PORTAL_SCRIPT)
        self.assertIn("detail.textContent = resumable", PORTAL_SCRIPT)
        self.assertIn("watch-film-channel-rail", PORTAL_SCRIPT)
        self.assertIn("· Film channel", PORTAL_SCRIPT)
        self.assertIn("rail.setAttribute('aria-label'", PORTAL_SCRIPT)
        self.assertIn(".mabel-film-channel", experience_watch)
        self.assertIn(".mabel-show-channel", experience_watch)
        self.assertIn(".mabel-channel-section .watch-channel-rail", experience_watch)
        self.assertIn("body.portal-v2 #remoteMabel {", experience_watch)
        self.assertIn("grid-template-columns: minmax(0, 1fr)", experience_watch)
        self.assertIn("max-width: 100%", experience_watch)
        self.assertIn("min-width: 0", experience_watch)
        self.assertIn("grid-template-columns: 104px minmax(0, 1fr)", experience_responsive)
        self.assertIn("aspect-ratio: 2 / 3", experience_library)
        self.assertIn("background: var(--channel-page-art) center 32% / cover no-repeat", experience_library)
        self.assertIn("`CH ${channel.number} · ${isFilms ? 'Film channel' : 'Series channel'}`", channel_script)
        self.assertIn("grid-template-columns: minmax(0, 1fr) 42px 42px", experience_responsive)
        self.assertIn("margin-top: -16px", experience_responsive)
        self.assertIn("markerParts = details.marker.match", channel_script)
        self.assertIn("channel-page-season", channel_script)
        self.assertIn("channel-page-episode-number", channel_script)
        self.assertIn("watchButton.querySelector('strong').textContent = channel.enabled ? 'Open on TV'", PORTAL_SCRIPT)
        self.assertIn("body.portal-v2 .watch-continue-card", experience_watch)
        self.assertIn("aspect-ratio: 16 / 9", experience_watch)
        self.assertIn("height: auto", experience_watch)
        self.assertIn("grid-area: 1 / 1", experience_watch)
        self.assertIn("border: 0", experience_watch)
        self.assertIn(".watch-continue-art::before", experience_watch)
        self.assertIn("inset: auto 0 0", experience_watch)
        self.assertIn("grid-auto-columns: calc((100% - 22px) / 3)", experience_responsive)
        self.assertIn("grid-auto-columns: calc((100% - 60px) / 6)", PORTAL_STYLES)
        self.assertIn("grid-auto-columns: calc((100% + 18px - 11px) / 2)", experience_responsive)
        self.assertIn(".watch-search:focus-within", experience_watch)
        self.assertIn(".channel-page-search:focus-within", experience_library)
        self.assertIn("body.portal-v2 .channel-page-search input:focus-visible", experience_library)
        self.assertIn("body.portal-v2 .watch-page {", experience_responsive)
        self.assertIn("padding-top: 16px", experience_responsive)
        self.assertIn("margin-bottom: 14px", experience_responsive)
        self.assertIn("body.portal-v2 .channel-page-search input {", experience_responsive)
        self.assertIn("font-size: 16px", experience_responsive)
        self.assertIn("gap: 11px", experience_responsive)
        self.assertIn("saveMabelRemotePosition", PORTAL_SCRIPT)
        self.assertIn("result.resume_enabled === true", PORTAL_SCRIPT)
        self.assertIn("classList.toggle('is-wake', waking)", PORTAL_SCRIPT)
        self.assertIn('id="mabelOnlyRemotePower"', PORTAL_SOURCE)
        self.assertIn("async function openPortalPowerSheet(event)", PORTAL_SCRIPT)
        self.assertIn("includeConnectedTv ? 'turn-on' : 'turn-on-mabel-only'", PORTAL_SCRIPT)
        self.assertIn("includeConnectedTv ? 'turn-off' : 'turn-off-mabel-only'", PORTAL_SCRIPT)
        self.assertIn('id="homeConnectedTvState"', PORTAL_SOURCE)
        self.assertIn(".remote-power-confirm.is-wake", experience_overlays)
        self.assertIn("border-color: rgba(255, 122, 26, .52)", experience_overlays)
        self.assertIn("body.portal-experience .remote-power-actions {\n  display: grid;\n  gap: 8px;", experience_overlays)
        self.assertIn("const visibleCount = isFilms", channel_script)
        self.assertIn("? filtered.length", channel_script)
        self.assertIn("const hasMore = !isFilms", channel_script)

    def test_remote_browser_player_has_native_controls_and_safe_default(self) -> None:
        index = PORTAL_SOURCE
        player = mabeltv_library.WATCH_PAGE
        self.assertIn('id="view-watch"', index)
        self.assertIn('watch-poster-grid', index)
        self.assertNotIn('id="remoteVideo"', index)
        self.assertRegex(player, r'id="video"\s+controls')
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
        self.assertNotIn('id="watchFilmRemoveProgress"', index)
        self.assertIn('id="adultFilmRemoveProgress"', index)
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
        self.assertIn(".portal-sheet-close::after", index)
        self.assertIn("position: sticky", index)
        self.assertIn('id="watchFilmTv"', index)
        self.assertIn('id="watchFilmHere"', index)
        self.assertNotIn("className = 'watch-play'", index)
        self.assertNotIn('.watch-play {', index)
        self.assertIn("function playWatchFilmOnTv(film, position = null)", index)
        self.assertIn("? Number(film.remote_position || 0)", index)
        self.assertIn("playWatchFilmOnTv(film, 0)", index)
        self.assertIn('id="watchProgrammeSheet"', index)
        self.assertIn('id="watchManageAdult"', index)
        self.assertRegex(index, r'id="watchFilmManage"\s+type="button"\s+class="watch-film-secondary primary-sheet-more hidden"')
        self.assertIn("openAdultFilmSheet(film)", index)
        self.assertIn("openLibrarySheet($('#adultCollectionSheet'))", index)
        self.assertNotIn('id="watchManageMabel"', index)
        self.assertNotIn('id="overviewChannels"', index)
        self.assertIn("identity.className = 'mabel-show-identity'", index)
        self.assertIn("identity.onclick = () => openChannel(channel, true)", index)
        self.assertNotIn("const manageCue", index)
        self.assertIn("channelWorkspaceReturnToWatch", index)
        self.assertIn('id="watchMabelLayout"', index)
        self.assertIn("let remoteKind = 'channel'", index)
        self.assertIn('id="watchMabelTab" type="button" class="active" role="tab" aria-selected="true"', index)
        self.assertIn('id="watchMabelLayout" class="watch-mabel-layout"', index)
        self.assertNotIn('id="watchMabelPrimaryTools"', index)
        self.assertIn('id="watchMabelAdmin"', index)
        self.assertIn('id="watchNewChannel" type="button" aria-label="Create a new channel"', index)
        self.assertNotIn('id="watchRefreshArtwork"', index)
        self.assertNotIn('id="refreshChannelArtwork"', index)
        self.assertIn('id="channelMetadataAction"', index)
        self.assertIn("scanChannelTmdb(channel, () =>", index)
        self.assertIn("/api/tmdb/channel", index)
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
        open_view = core[core.index("function openView(name, options = {})"):]
        self.assertIn("notice('')", open_view[:500])

    def test_channel_entry_is_instant_and_favourite_is_primary(self) -> None:
        core = (PORTAL_ROOT / "js" / "core.js").read_text(encoding="utf-8")
        library = (PORTAL_ROOT / "js" / "library.js").read_text(encoding="utf-8")
        actions = (PORTAL_ROOT / "js" / "actions.js").read_text(encoding="utf-8")
        overlays = (PORTAL_ROOT / "html" / "overlays.html").read_text(encoding="utf-8")

        self.assertIn("history.scrollRestoration = 'manual'", core)
        self.assertIn("function resetViewScroll()", core)
        self.assertIn("openView('channels', { instantScroll: true })", library)
        self.assertIn("requestAnimationFrame(() =>", library)
        self.assertIn("let selectedManageChannelFolder = ''", core)
        self.assertIn("let channelNavigationRevision = 0", core)
        self.assertIn("function channelReturnSnapshot(channel)", core)
        self.assertIn("function restoreViewScroll(snapshot)", core)
        self.assertIn("history.state?.mabelWatchReturn", core)
        self.assertIn("section.dataset.watchChannelFolder", PORTAL_SCRIPT)
        self.assertIn("data-open-channel-folder=", library)
        self.assertIn("function selectedChannelFromLibrary", library)
        self.assertIn("channel = selected", library)
        render_channels = library.index("function renderChannels")
        self.assertLess(library.index("renderProgrammeList(channel)", render_channels),
                        library.index("$('#channelVisibilityTitle')", render_channels))
        self.assertIn("channelNavigationRevision === navigationRevision", actions)
        self.assertNotIn("selectedManageChannel = channel\n", actions)
        self.assertNotIn("data-programme-visibility", PORTAL_SOURCE)
        self.assertNotIn("programmeVisibility", PORTAL_SOURCE)
        primary_sheet = overlays[overlays.index('id="watchProgrammeSheet"'):
                                 overlays.index('id="watchProgrammeMoreSheet"')]
        more_sheet = overlays[overlays.index('id="watchProgrammeMoreSheet"'):
                              overlays.index('id="watchProgrammeMoveSheet"')]
        self.assertIn('id="watchProgrammeFavourite"', primary_sheet)
        self.assertNotIn('id="watchProgrammeFavourite"', more_sheet)

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

        head_styles = portal[portal.index(".ios-watch-head {"):portal.index(".ios-watch-head > div")]
        self.assertNotIn("position:", head_styles)
        self.assertNotIn("z-index:", head_styles)
        stage_styles = portal[portal.index(".ios-watch-stage {"):portal.index(".ios-watch-stage video")]
        self.assertNotIn("z-index:", stage_styles)
        self.assertNotIn("margin-top: 72px", portal)
        self.assertIn("calc(var(--space-3) + var(--safe-top))", head_styles)

    def test_adult_organiser_uses_compact_accessible_components(self) -> None:
        portal = PORTAL_SOURCE

        self.assertIn('class="watch-film-sheet adult-film-sheet"', portal)
        self.assertIn('class="watch-film-play adult-film-collection-action"', portal)
        self.assertIn('aria-labelledby="adultFilmSheetTitle"', portal)
        self.assertIn("focus: sheet.querySelector('.watch-film-panel')", portal)
        self.assertIn('Refresh metadata &amp; subtitles', portal)
        self.assertIn('id="adultFilmOptimise"', portal)
        self.assertIn('id="adultFilmRemoveProgress"', portal)
        self.assertIn('id="adultFilmRemove"', portal)
        self.assertNotIn('id="adultFilmFavourite"', portal)
        self.assertNotIn('id="adultFilmPlay"', portal)
        self.assertIn("row.setAttribute('aria-label', `Open details for", portal)
        self.assertNotIn("more.textContent = 'Open'", portal)
        self.assertNotIn("!important", portal)

    def test_mabel_remote_player_restores_original_tv_and_locks_page_scroll(self) -> None:
        index = PORTAL_SOURCE
        self.assertRegex(index, r'class="mabel-watch-icon-button"\s+aria-label="Back to Mabel TV programmes"')
        self.assertNotIn('class="mabel-watch-icon-button mabel-watch-back"', index)
        self.assertRegex(index, r'</video>\s*<button\s+id="mabelWatchBack"')
        self.assertRegex(index, r'</button>\s*<div\s+id="mabelWatchControls"')
        self.assertIn('.mabel-watch-screen > .mabel-watch-icon-button', index)
        self.assertIn('touch-action: manipulation', index)
        self.assertIn("$('#mabelWatchBack').onclick = closeMabelWatchPlayer", index)
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

    def test_tmdb_matcher_uses_a_real_mobile_sheet_and_readable_results(self) -> None:
        portal = PORTAL_SOURCE

        self.assertIn('class="tmdb-dialog-panel"', portal)
        self.assertIn('aria-labelledby="tmdbDialogTitle"', portal)
        self.assertIn("result.query || film.display_name", portal)
        self.assertIn("poster.className = 'tmdb-result-poster'", portal)
        self.assertIn("poster.append(librarySignalIcon('signal-clapperboard'))", portal)
        self.assertIn("choose.className = 'primary tmdb-result-choose'", portal)
        self.assertIn("grid-template-columns: 60px minmax(0, 1fr)", portal)
        self.assertIn(".tmdb-result-choose", portal)
        self.assertIn("overflow-wrap: anywhere", portal)
        self.assertIn(".tmdb-dialog-panel", portal)
        self.assertIn("body.portal-experience .tmdb-result", portal)

    def test_adult_discovery_merges_local_titles_and_keeps_viewing_facts_separate(self) -> None:
        film = self.fixture.library.adult_root / "The Matrix.mp4"
        film.write_bytes(b"film")
        states = self.fixture.library.adult_media_states()
        states["The Matrix.mp4"] = {"library_id": "a" * 32, "metadata": {
            "tmdb_id": 603, "title": "The Matrix", "year": "1999",
        }}
        self.fixture.library.write_adult_media_states(states)
        self.fixture.library.tmdb_request = mock.Mock(return_value={"results": [{
            "id": 603, "media_type": "movie", "title": "The Matrix",
            "release_date": "1999-03-31", "overview": "Reality is a system.",
            "poster_path": "/matrix.jpg",
        }]})

        found = self.fixture.library.adult_discovery("Matrix")
        self.assertTrue(found["results"][0]["on_mabeltv"])
        title = found["results"][0]
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "watchlist", "enabled": True})
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "up_next", "enabled": True})
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "part_watched"})
        self.assertTrue(saved["viewing"]["watchlisted"])
        self.assertTrue(saved["viewing"]["up_next"])
        self.assertEqual(saved["viewing"]["manual_state"], "part_watched")

    def test_watchmode_links_are_validated_cached_and_expire_before_thirty_days(self) -> None:
        self.fixture.library.watchmode_request = mock.Mock(return_value=[
            {"source_id": 203, "name": "Netflix", "type": "sub", "region": "GB",
             "web_url": "https://netflix.com/watch/1",
             "ios_url": "nflx://www.netflix.com/watch/1",
             "android_url": "https://netflix.com/watch/1"},
            {"source_id": 409, "name": "BBC iPlayer", "type": "free", "region": "GB",
             "web_url": "http://www.bbc.co.uk/iplayer/episode/m0022wzs",
             "ios_url": "Deeplinks available for paid plans only."},
            {"name": "Bad", "type": "free", "web_url": "javascript:alert(1)"},
        ])
        first = self.fixture.library.adult_streaming_links("movie", 603)
        second = self.fixture.library.adult_streaming_links("movie", 603)
        self.assertEqual([item["name"] for item in first["sources"]], ["Netflix", "BBC iPlayer"])
        self.assertEqual(first["sources"][0]["source_id"], 203)
        self.assertEqual(first["sources"][0]["ios_url"], "nflx://www.netflix.com/watch/1")
        self.assertEqual(first["sources"][1]["web_url"],
                         "https://www.bbc.co.uk/iplayer/episode/m0022wzs")
        self.assertEqual(first["sources"][1]["ios_url"], "")
        self.assertEqual(first["link_schema"], 2)
        self.assertEqual(first, second)
        self.fixture.library.watchmode_request.assert_called_once()
        store = self.fixture.library.adult_viewing_store()
        store["availability"]["movie:999"] = {
            "checked": time.time() - 30 * 24 * 60 * 60, "sources": [],
        }
        self.fixture.library.write_adult_viewing_store(store)
        self.assertNotIn("movie:999", self.fixture.library.adult_viewing_store()["availability"])

    def test_tv_episode_watches_are_saved_per_season_and_episode(self) -> None:
        self.fixture.library.tmdb_request = mock.Mock(return_value={
            "name": "Season 1", "episodes": [
                {"episode_number": 1, "name": "Pilot", "air_date": "2000-01-01", "runtime": 44},
                {"episode_number": 2, "name": "Second", "air_date": "2000-01-08", "runtime": 44},
            ],
        })
        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "episode_watched", "season": 1, "episode": 2, "watched": True,
        })
        self.assertTrue(saved["viewing"]["episodes"]["1:2"]["watched"])
        season = self.fixture.library.adult_title_season(4586, 1)
        self.assertFalse(season["episodes"][0]["watched"])
        self.assertTrue(season["episodes"][1]["watched"])

    def test_adult_viewing_portal_is_modular_private_and_mobile_safe(self) -> None:
        self.assertIn('id="adultMyViewing"', PORTAL_SOURCE)
        self.assertIn('id="view-adult-viewing"', PORTAL_SOURCE)
        self.assertIn('id="adultTitleSheet"', PORTAL_SOURCE)
        self.assertIn("Search your library and beyond", PORTAL_SOURCE)
        self.assertIn("Streaming availability data from TMDB and JustWatch", PORTAL_SOURCE)
        self.assertIn("window.location.assign(destination)", PORTAL_SOURCE)
        self.assertIn("episode_watched", PORTAL_SOURCE)
        self.assertIn("provider-mabeltv", PORTAL_SOURCE)
        self.assertIn("includedByBrand", PORTAL_SOURCE)
        self.assertIn("['flatrate', 'free', 'ads']", PORTAL_SOURCE)
        self.assertIn("['sub', 'free', 'tve', 'ads']", PORTAL_SOURCE)
        self.assertIn("adultProviderPlatform", PORTAL_SOURCE)
        self.assertIn("watchmodeIds", PORTAL_SOURCE)
        self.assertIn("adultProviderDestination", PORTAL_SOURCE)
        self.assertIn("adultNetflixLaunchSheet", PORTAL_SOURCE)
        self.assertIn("/api/adult/netflix/play-tv", PORTAL_SOURCE)
        self.assertIn("Play on this device", PORTAL_SOURCE)
        self.assertIn("Play on TV", PORTAL_SOURCE)
        self.assertIn("https://www.bbc.co.uk/iplayer/search?q=", PORTAL_SOURCE)
        self.assertIn("adultProviderBrands.forEach", PORTAL_SOURCE)
        self.assertNotIn("source?.url || detail.provider_link", PORTAL_SOURCE)
        provider_assets = PORTAL_ROOT / "assets" / "providers"
        for asset in (
            "netflix-app.jpg", "prime-video-app.jpg", "disney-plus-app.jpg",
            "sky-go-app.jpg", "bbc-iplayer-app.jpg", "channel-4-app.jpg",
            "itvx-app.jpg", "paramount-plus-app.jpg", "apple-tv-app.jpg",
        ):
            self.assertGreater((provider_assets / asset).stat().st_size, 10_000)
        viewing_css = (PORTAL_ROOT / "css" / "experience-viewing.css").read_text(
            encoding="utf-8")
        self.assertIn("grid-template-columns: minmax(0, 1fr)", viewing_css)
        self.assertIn("@media (max-width: 640px)", viewing_css)
        self.assertIn("min-height: 0", viewing_css)
        self.assertNotIn("!important", viewing_css)

    def test_netflix_tv_content_id_accepts_only_direct_netflix_titles(self) -> None:
        self.assertEqual(
            mabeltv_library.Library.netflix_content_id(
                "https://www.netflix.com/watch/81458416"),
            "m=https://www.netflix.com/watch/81458416&source_type=4")
        self.assertEqual(
            mabeltv_library.Library.netflix_content_id(
                "https://www.netflix.com/title/81458416?trackId=1"),
            "m=https://www.netflix.com/watch/81458416&source_type=4")
        with self.assertRaises(ValueError):
            mabeltv_library.Library.netflix_content_id(
                "https://www.netflix.com/search?q=Glass+Onion")

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

        from_beginning = self.fixture.library.start_remote_stream({
            "kind": "adult", "file": "Remote Film.mp4", "position": 0,
        })
        self.assertEqual(from_beginning["resume_position"], 0)

    def test_film_favourites_are_shared_with_the_portal_without_refreshing_tv(self) -> None:
        channels = [{
            "number": 5, "name": "Films", "folder": "films",
            "aspect": "fit", "content_type": "films",
        }]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        (films / "The Apple.mp4").write_bytes(b"film")
        (films / "Banana.mp4").write_bytes(b"film")
        (films / "A Film.mp4").write_bytes(b"film")
        adult = self.fixture.library.adult_root / "Adult Film.mp4"
        adult.write_bytes(b"adult")
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        self.fixture.library.set_favourite({
            "kind": "adult", "file": adult.name, "enabled": True,
        })
        self.fixture.library.set_favourite({
            "kind": "channel", "channel": 5,
            "file": "The Apple.mp4", "enabled": True,
        })

        rendered = self.fixture.library.library()
        self.assertTrue(rendered["adult_library"][0]["favourite"])
        programmes = rendered["channels"][0]["programmes"]
        self.assertEqual([item["display_name"] for item in programmes],
                         ["A Film", "The Apple", "Banana"])
        self.assertTrue(programmes[1]["favourite"])
        self.fixture.library.refresh_tv.assert_not_called()

        self.fixture.library.set_favourite({
            "kind": "channel", "channel": 5,
            "file": "The Apple.mp4", "enabled": False,
        })
        self.assertFalse(self.fixture.library.library()["channels"][0]
                         ["programmes"][1]["favourite"])

    def test_series_channel_favourite_uses_saved_channel_episode_and_position(self) -> None:
        channels = [{
            "number": 2, "name": "Puffin Rock", "folder": "puffin-rock",
            "aspect": "crop", "content_type": "shows",
        }]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        folder = self.fixture.media / "puffin-rock"
        folder.mkdir(parents=True)
        (folder / "S01 E01 - First.mp4").write_bytes(b"first")
        (folder / "S01 E02 - Second.mp4").write_bytes(b"second")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True,
            "channel_timelines": {"2": {
                "episode_name": "S01 E02 - Second.mp4",
                "position_seconds": 193,
                "programme_positions": {"S01 E02 - Second.mp4": 193},
            }},
        }), encoding="utf-8")

        self.fixture.library.set_favourite({
            "kind": "series-channel", "channel": 2, "enabled": True,
        })
        channel = self.fixture.library.library()["channels"][0]

        self.assertTrue(channel["favourite"])
        self.assertEqual(channel["resume_file"], "S01 E02 - Second.mp4")
        self.assertEqual(channel["resume_position"], 193)
        self.assertEqual(channel["resume_title"], "S01 E02 - Second")
        stream = self.fixture.library.start_remote_stream({
            "kind": "channel", "channel": 2,
            "file": channel["resume_file"], "position": channel["resume_position"],
        })
        self.assertTrue(stream["resume_enabled"])
        self.assertEqual(stream["resume_position"], 193)

        self.fixture.library.set_favourite({
            "kind": "series-channel", "channel": 2, "enabled": False,
        })
        self.assertFalse(self.fixture.library.library()["channels"][0]["favourite"])

    def test_film_channel_resume_is_shared_from_tv_to_portal_and_back(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        channels = self.fixture.library.channels()
        channels[0]["content_type"] = "films"
        self.fixture.library.write_json(
            self.fixture.library.channels_path,
            {"schema_version": 1, "channels": channels})
        film = self.fixture.media / "kids-tv" / "Family Film.mp4"
        film.parent.mkdir(parents=True, exist_ok=True)
        film.write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True,
            "channel_film_positions": {"1/Family Film.mp4": 1800},
            "channel_film_durations": {"1/Family Film.mp4": 7200},
            "channel_film_position_updated_utc_ms": {
                "1/Family Film.mp4": 1234000,
            },
        }), encoding="utf-8")

        programme = self.fixture.library.library()["channels"][0]["programmes"][0]
        self.assertEqual(programme["remote_position"], 1800)
        self.assertEqual(programme["remote_duration"], 7200)
        self.assertEqual(programme["remote_last_watched"], 1234)
        started = self.fixture.library.start_remote_stream({
            "kind": "channel", "channel": 1, "file": "Family Film.mp4",
        })
        self.assertTrue(started["resume_enabled"])
        self.assertEqual(started["resume_position"], 1800)

        token = started["stream_url"].split("stream=", 1)[1]
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            self.fixture.library.remote_save_position({
                "stream": token, "position": 2400, "duration": 7200,
            })
        command = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(command, {
            "command": "save-channel-film-position", "channel": 1,
            "file": "Family Film.mp4", "position": 2400.0,
            "duration": 7200.0,
        })

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

    def test_channel_uploads_publish_originals_without_automatic_optimisation(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 3840, "height": 2160,
            "avg_frame_rate": "60/1",
        }
        self.fixture.library.needs_playback_optimisation = mock.Mock(return_value=True)
        self.fixture.library.optimise_for_playback = mock.Mock()
        self.fixture.library.refresh_tv = lambda: True
        uploads = []
        for channel, name in ((1, "show.mov"), (3, "film.mkv")):
            created = self.fixture.library.upload_create({
                "channel": channel, "file_name": name, "size": 16,
            })
            result = self.fixture.library.append_upload(created["id"], 0, b"x" * 16)
            self.assertTrue(result["processing"])
            uploads.append((created["id"], channel, name))

        deadline = time.monotonic() + 4
        states = []
        while time.monotonic() < deadline:
            states = [self.fixture.library.upload_status(upload_id)
                      for upload_id, _, _ in uploads]
            if all(state.get("complete") for state in states):
                break
            time.sleep(0.03)
        self.assertTrue(all(state.get("complete") for state in states))
        self.assertTrue(all(not state.get("optimised") for state in states))
        self.assertTrue((self.fixture.media / "kids-tv" / "show.mov").is_file())
        self.assertTrue((self.fixture.media / "films" / "film.mkv").is_file())
        self.fixture.library.needs_playback_optimisation.assert_not_called()
        self.fixture.library.optimise_for_playback.assert_not_called()

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

    def test_adult_optimisation_progress_is_exposed_without_reloading_library(self) -> None:
        film = self.fixture.library.adult_root / "Long Film.mkv"
        film.write_bytes(b"video")
        self.fixture.library.set_adult_media_state(
            "Long Film.mkv", "processing", "", progress=37)

        progress = self.fixture.library.adult_optimisations()
        self.assertTrue(progress["active"])
        self.assertEqual(progress["items"], [{
            "path": "Long Film.mkv",
            "title": "Long Film",
            "state": "processing",
            "progress": 37,
            "message": "",
            "updated": mock.ANY,
            "started": 0.0,
            "eta_seconds": 0,
        }])
        self.assertEqual(self.fixture.library.adult_library()[0]["playback_progress"], 37)
        self.assertIn("/api/adult/optimisations", PORTAL_SOURCE)
        self.assertIn("Optimising ${Math.round(progress)}%", PORTAL_SOURCE)
        self.assertNotIn("setInterval(() => load()", PORTAL_SOURCE)

    def test_adult_series_groups_episodes_and_tracks_manual_watched_state(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        season = self.fixture.library.adult_series_root / series_id / "Season 1"
        season.mkdir()
        episode = season / "Silicon.Valley.S01E06.720p.HDTV.x264.mkv"
        episode.write_bytes(b"episode")

        series = self.fixture.library.adult_series_library()[0]
        self.assertEqual(series["title"], "Silicon Valley")
        self.assertEqual(series["season_count"], 1)
        self.assertEqual(series["episode_count"], 1)
        self.assertEqual(series["episodes"][0]["season"], 1)
        self.assertEqual(series["episodes"][0]["episode"], 6)
        self.assertEqual(series["episodes"][0]["display_name"], "Silicon Valley")

        self.fixture.library.set_favourite({
            "kind": "adult-series", "series": series_id, "enabled": True,
        })
        self.assertTrue(self.fixture.library.adult_series_library()[0]["favourite"])

        result = self.fixture.library.set_adult_episode_watched(
            series_id, "Season 1/Silicon.Valley.S01E06.720p.HDTV.x264.mkv", True)
        self.assertTrue(result["watched"])
        refreshed = self.fixture.library.adult_series_library()[0]
        self.assertEqual(refreshed["watched_count"], 1)
        self.assertTrue(refreshed["episodes"][0]["watched"])

    def test_adult_series_restart_clears_one_season_or_complete_show(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        root = self.fixture.library.adult_series_root / series_id
        for season, episode in ((1, 1), (1, 2), (2, 1)):
            folder = root / f"Season {season}"
            folder.mkdir(exist_ok=True)
            (folder / f"Silicon.Valley.S{season:02d}E{episode:02d}.mp4").write_bytes(
                b"episode")
        self.fixture.library.adult_series_library()
        states = self.fixture.library.adult_series_states()
        for value in states["episodes"].values():
            value.update({
                "watched": True,
                "remote_position": 420.0,
                "remote_duration": 1800.0,
                "remote_last_watched": 1234.0,
            })
        self.fixture.library.write_adult_series_states(states)

        result = self.fixture.library.restart_adult_series_progress(
            series_id, "season", 1)
        self.assertEqual(result["episodes_reset"], 2)
        refreshed = self.fixture.library.adult_series_library()[0]
        first = [item for item in refreshed["episodes"] if item["season"] == 1]
        second = [item for item in refreshed["episodes"] if item["season"] == 2]
        self.assertTrue(all(not item["watched"] for item in first))
        self.assertTrue(all(item["remote_position"] == 0 for item in first))
        self.assertTrue(all(item["watched"] for item in second))
        self.assertEqual(first[0]["remote_duration"], 1800.0)

        result = self.fixture.library.restart_adult_series_progress(
            series_id, "series")
        self.assertEqual(result["episodes_reset"], 3)
        refreshed = self.fixture.library.adult_series_library()[0]
        self.assertTrue(all(not item["watched"] for item in refreshed["episodes"]))
        self.assertTrue(all(item["remote_position"] == 0
                            for item in refreshed["episodes"]))

    def test_adult_series_direct_upload_publishes_into_selected_series_number(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p",
            "width": 1280, "height": 720, "avg_frame_rate": "24000/1001",
        }
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        created = self.fixture.library.adult_series_upload_create({
            "series": series_id, "season": 2,
            "file_name": "Silicon.Valley.S02E01.mp4", "size": 7,
        })
        self.fixture.library.append_upload(created["id"], 0, b"episode")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])

        self.assertTrue(state["complete"])
        self.assertEqual(state["kind"], "adult-series")
        self.assertEqual(state["series_id"], series_id)
        self.assertEqual(state["season"], 2)
        self.assertEqual(
            (self.fixture.library.adult_series_root / series_id / "Season 2" /
             "Silicon.Valley.S02E01.mp4").read_bytes(), b"episode")
        episode = self.fixture.library.adult_series_library()[0]["episodes"][0]
        self.assertEqual((episode["season"], episode["episode"]), (2, 1))
        self.fixture.library.refresh_tv.assert_not_called()

    def test_adult_series_portal_uses_scoped_series_and_episode_workflow(self) -> None:
        self.assertIn('id="adultSeasonSheet"', PORTAL_SOURCE)
        self.assertIn('class="adult-series-seasons"', PORTAL_SOURCE)
        self.assertIn("function openAdultSeasonSheet(series, season, returnTo = null)", PORTAL_SOURCE)
        self.assertIn("openAdultSeriesUpload(current, number)", PORTAL_SOURCE)
        self.assertIn("const season = Number(target?.season)", PORTAL_SOURCE)
        self.assertIn("Start Series ${nextSeries}", PORTAL_SOURCE)
        self.assertIn("scope: 'season', season: number", PORTAL_SOURCE)
        self.assertIn('id="adultSeriesSourceSheet"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesSourceFiles"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesSourceUsb"', PORTAL_SOURCE)
        self.assertIn("function openAdultSeriesSourceSheet()", PORTAL_SOURCE)
        self.assertIn("function returnToAdultSeriesUploadSheet()", PORTAL_SOURCE)
        self.assertNotIn('id="adultSeriesUpload"', PORTAL_SOURCE)
        self.assertNotIn('id="adultSeriesAddUsb"', PORTAL_SOURCE)
        self.assertNotIn('id="adultSeriesUploadSeason"', PORTAL_SOURCE)
        self.assertNotIn('Use an existing number', PORTAL_SOURCE)
        self.assertNotIn('id="adultSeasonBack"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesRestartSheet"', PORTAL_SOURCE)
        self.assertIn('id="adultSeasonRestart"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesRestart"', PORTAL_SOURCE)
        self.assertIn("function adultSeriesContinueEntries()", PORTAL_SOURCE)
        self.assertIn("[...resumableFilms, ...adultSeriesContinueEntries()]",
                      PORTAL_SOURCE)
        home_renderer = re.search(
            r"function renderHomeLibrary\(\) \{(.*?)\n    \}\n\n    async function setFilmFavourite",
            PORTAL_SOURCE, re.DOTALL)
        self.assertIsNotNone(home_renderer)
        self.assertNotIn("adultSeriesContinueEntries", home_renderer.group(1))

    def test_adult_series_episode_season_and_show_cleanup_use_recycle_bin(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        root = self.fixture.library.adult_series_root / series_id
        for season, episode in ((1, 1), (1, 2), (2, 1)):
            folder = root / f"Season {season}"
            folder.mkdir(exist_ok=True)
            (folder / f"Silicon.Valley.S{season:02d}E{episode:02d}.mp4").write_bytes(b"episode")

        removed = self.fixture.library.trash_adult_series_items({
            "series": series_id, "scope": "season", "season": 1,
        })
        self.assertEqual(removed, 2)
        remaining = self.fixture.library.adult_series_library()[0]
        self.assertEqual([(item["season"], item["episode"])
                          for item in remaining["episodes"]], [(2, 1)])
        recycle = self.fixture.library.recycle_items()
        self.assertEqual(len(recycle), 2)

        self.fixture.library.manage({"action": "restore", "id": recycle[0]["id"]})
        restored = self.fixture.library.adult_series_library()[0]
        self.assertEqual(restored["episode_count"], 2)

        removed = self.fixture.library.trash_adult_series_items({
            "series": series_id, "scope": "series",
        })
        self.assertEqual(removed, 2)
        self.assertEqual(self.fixture.library.adult_series_library(), [])

    def test_viewing_insights_use_current_film_metadata_title(self) -> None:
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        }), encoding="utf-8")
        film = self.fixture.media / "films" / "Room on the Broom - original.mp4"
        film.parent.mkdir(parents=True, exist_ok=True)
        film.write_bytes(b"film")
        self.fixture.library.write_channel_media_states({
            "programmes": {
                self.fixture.library.channel_programme_key(3, film.name): {
                    "title": "Room on the Broom",
                },
            },
        })
        now = time.time()
        self.fixture.library.viewing_store["sessions"] = [{
            "id": "film-session",
            "item_key": f"channel:3:{film.name.casefold()}",
            "title": "Room on the Broom - original",
            "channel_number": 3,
            "channel_name": "Old name",
            "kind": "film",
            "surface": "tv",
            "started": now - 180,
            "ended": now,
            "seconds": 180,
        }]

        summary = self.fixture.library.viewing_insights(1, 0)
        self.assertEqual(summary["top_films"][0]["title"], "Room on the Broom")
        self.assertEqual(summary["sessions"][0]["source"], "Films")

    def test_viewing_insights_include_item_drilldowns_and_completion_patterns(self) -> None:
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        }), encoding="utf-8")
        now = time.time()
        item_key = "channel:3:the film.mp4"
        self.fixture.library.viewing_store["sessions"] = [
            {
                "id": "film-one", "item_key": item_key, "title": "The Film",
                "channel_number": 3, "channel_name": "Films", "kind": "film",
                "surface": "tv", "started": now - 7200, "ended": now - 6900,
                "seconds": 300, "position": 1800, "media_duration": 3600,
            },
            {
                "id": "film-two", "item_key": item_key, "title": "The Film",
                "channel_number": 3, "channel_name": "Films", "kind": "film",
                "surface": "device", "started": now - 3600, "ended": now - 3420,
                "seconds": 180, "position": 3420, "media_duration": 3600,
            },
        ]

        insights = self.fixture.library.viewing_insights(365, 0)
        item = insights["items"][0]
        self.assertEqual(item["item_key"], item_key)
        self.assertEqual(item["sessions"], 2)
        self.assertEqual(item["active_days"], 1)
        self.assertEqual(item["average_session_seconds"], 240)
        self.assertAlmostEqual(item["average_progress"], .725, places=3)
        self.assertAlmostEqual(item["furthest_progress"], .95, places=3)
        self.assertEqual(item["completion_sessions"], 1)
        self.assertEqual({value["name"] for value in item["by_surface"]},
                         {"tv", "device"})
        self.assertEqual(len(item["hourly"]), 24)
        self.assertEqual(len(item["weekdays"]), 7)
        self.assertEqual(len(item["timeline"]), 12)
        self.assertEqual(insights["top_films"][0]["item_key"], item_key)
        self.assertEqual(len(insights["hourly"]), 24)
        self.assertEqual(len(insights["weekdays"]), 7)

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

    def test_upload_queue_has_one_transfer_slot_and_can_promote_a_waiting_file(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        source = "a" * 32
        first = self.fixture.library.upload_create({
            "channel": 1, "file_name": "first.mp4", "size": 4, "source_id": source,
        })
        second = self.fixture.library.upload_create({
            "channel": 1, "file_name": "second.mp4", "size": 4, "source_id": source,
        })
        jobs = self.fixture.library.upload_jobs()
        self.assertEqual([job["id"] for job in jobs], [first["id"], second["id"]])
        self.assertEqual([job["transfer_state"] for job in jobs], ["active", "waiting"])
        with self.assertRaisesRegex(ValueError, "waiting in the queue"):
            self.fixture.library.append_upload(second["id"], 0, b"next")
        self.fixture.library.upload_action(second["id"], "start")
        self.assertEqual(self.fixture.library.upload_status(first["id"])["status"], "paused")
        self.assertEqual(self.fixture.library.upload_status(first["id"])["transfer_state"], "paused")
        self.assertEqual(self.fixture.library.upload_status(second["id"])["transfer_state"], "active")
        self.fixture.library.append_upload(second["id"], 0, b"next")

    def test_reselecting_source_files_reconnects_and_resumes_the_queue(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        old_source = "a" * 32
        new_source = "b" * 32
        first = self.fixture.library.upload_create({
            "channel": 1, "file_name": "first.mp4", "size": 8,
            "source_id": old_source,
        })
        second = self.fixture.library.upload_create({
            "channel": 1, "file_name": "second.mp4", "size": 8,
            "source_id": old_source,
        })
        self.fixture.library.append_upload(first["id"], 0, b"1234")
        self.fixture.library.upload_action(second["id"], "start")

        reconnected_first = self.fixture.library.upload_create({
            "channel": 1, "file_name": "first.mp4", "size": 8,
            "source_id": new_source,
        })
        reconnected_second = self.fixture.library.upload_create({
            "channel": 1, "file_name": "second.mp4", "size": 8,
            "source_id": new_source,
        })

        self.assertEqual(reconnected_first["id"], first["id"])
        self.assertEqual(reconnected_first["offset"], 4)
        self.assertEqual(reconnected_first["transfer_state"], "waiting")
        self.assertEqual(reconnected_second["id"], second["id"])
        self.assertEqual(reconnected_second["transfer_state"], "active")
        jobs = {job["id"]: job for job in self.fixture.library.upload_jobs()}
        self.assertEqual(jobs[first["id"]]["status"], "uploading")
        self.assertEqual(jobs[first["id"]]["source_available"], True)
        self.assertEqual(jobs[second["id"]]["source_available"], True)
        self.assertEqual(
            self.fixture.library.upload_meta(first["id"])["source_id"], new_source)

    def test_legacy_queued_conversion_publishes_original_without_optimising(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.optimise_for_playback = mock.Mock()
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "crash.mov", "size": 8,
        })
        incoming = self.fixture.media / ".incoming"
        (incoming / f"{created['id']}.part").write_bytes(b"12345678")
        metadata = self.fixture.library.upload_meta(created["id"])
        metadata.update({
            "status": "error", "conversion_required": True,
            "error": "old automatic optimisation failed",
        })
        self.fixture.library.write_json(
            incoming / f"{created['id']}.json", metadata)
        self.fixture.library.upload_action(created["id"], "retry")
        self.fixture.library.conversion_queue.join()
        result = self.fixture.library.upload_status(created["id"])
        self.assertTrue(result["complete"])
        self.assertFalse(result["optimised"])
        self.assertTrue((self.fixture.media / "kids-tv" / "crash.mov").is_file())
        self.assertFalse((self.fixture.media / "kids-tv" / "crash.mp4").exists())
        self.fixture.library.optimise_for_playback.assert_not_called()

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
        commands = ("open-parent-menu", "open-tv-guide", "open-channel-menu", "close-overlay",
                    "restart-programme", "navigate-up", "navigate-down",
                    "navigate-left", "navigate-right", "select",
                    "toggle-subtitles", "toggle-widescreen-mode",
                    "return-to-mabeltv", "toggle-remote-lock",
                    "turn-on", "turn-off", "turn-on-mabel-only",
                    "turn-off-mabel-only")
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
            "playback_position": 1234.4, "playback_duration": 13680.7,
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
        self.assertEqual(status["playback_position"], 1234)
        self.assertEqual(status["playback_duration"], 13681)

    def test_live_tv_status_exposes_connected_tv_power(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "Postman Pat",
        })
        self.fixture.library.player_mode_status = mock.Mock(return_value={
            "mode": "kids", "standby": False,
            "connected_tv_available": True, "connected_tv_power": "on",
        })

        status = self.fixture.library.live_tv_status()

        self.assertTrue(status["connected_tv_available"])
        self.assertEqual(status["connected_tv_power"], "on")

    def test_live_tv_status_exposes_current_film_progress_for_home_card(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "Stick Man",
        })
        mode = {
            "mode": "kids", "standby": False,
            "connected_tv_available": True, "connected_tv_power": "on",
        }
        self.fixture.library.player_mode_status = mock.Mock(return_value=mode)
        self.fixture.library.current_tv_viewing = mock.Mock(return_value={
            "kind": "film", "position": 540.2, "media_duration": 1620.7,
        })

        status = self.fixture.library.live_tv_status()

        self.assertEqual(status["playback_position"], 540)
        self.assertEqual(status["playback_duration"], 1621)
        self.fixture.library.current_tv_viewing.assert_called_once_with(mode)

    def test_live_tv_status_exposes_current_series_progress_for_home_card(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "S01E14 · Bouncy Ball",
        })
        mode = {"mode": "kids", "standby": False}
        self.fixture.library.player_mode_status = mock.Mock(return_value=mode)
        self.fixture.library.current_tv_viewing = mock.Mock(return_value={
            "kind": "channel", "position": 180.2, "media_duration": 840.6,
        })

        status = self.fixture.library.live_tv_status()

        self.assertEqual(status["playback_position"], 180)
        self.assertEqual(status["playback_duration"], 841)
        self.fixture.library.current_tv_viewing.assert_called_once_with(mode)

    def test_portal_power_prompt_is_skipped_when_connected_tv_already_matches(self) -> None:
        self.assertIn("function connectedTvAlreadyAtTarget(state, turningOn)",
                      PORTAL_SOURCE)
        self.assertIn("await applyPortalPower(false, trigger)", PORTAL_SOURCE)
        self.assertIn('id="homeMabelTvDot"', PORTAL_SOURCE)
        self.assertIn('id="homeSpotlightProgress"', PORTAL_SOURCE)
        self.assertIn("setHomeSpotlightProgress(state)", PORTAL_SOURCE)
        self.assertIn("media?.remote_duration", PORTAL_SOURCE)
        self.assertIn("nowPlayingMeta.classList.toggle('hidden'", PORTAL_SOURCE)
        self.assertIn("background: #ff5a6e", PORTAL_STYLES)

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

    def test_webm_is_converted_for_dependable_iphone_offline_playback(self) -> None:
        inspected = types.SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"streams": [
                {"codec_type": "video", "codec_name": "vp9"},
                {"codec_type": "audio", "codec_name": "opus"},
            ]}),
        )
        with mock.patch.object(mabeltv_library.subprocess, "run", return_value=inspected):
            profile = self.fixture.library.offline_media_profile(self.volume / "Episode.webm")
        self.assertEqual(profile, "convert")

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

    def test_incompatible_usb_conversion_uses_dedicated_fast_offline_path(self) -> None:
        movie = self.volume / "Legacy Episode.avi"
        movie.write_bytes(b"legacy-video")
        with mock.patch.object(self.fixture.library, "offline_media_profile",
                               return_value="convert"), \
                mock.patch.object(mabeltv_library.threading, "Thread"):
            queued = self.fixture.library.start_offline_download({
                "kind": "usb", "volume": "TEST-USB", "file": "Legacy Episode.avi",
            })
        with mock.patch.object(self.fixture.library, "_convert_for_offline_playback") as convert:
            convert.side_effect = lambda _source, destination, _job: destination.write_bytes(b"ready")
            self.fixture.library._run_offline_preparation(queued["id"])
        convert.assert_called_once()
        ready = self.fixture.library.offline_preparation_status(queued["id"])
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["size"], len(b"ready"))

    def test_offline_conversion_is_fast_reports_progress_and_never_upscales(self) -> None:
        source = inspect.getsource(self.fixture.library._convert_for_offline_playback)
        self.assertIn("min(1280,iw)", source)
        self.assertIn("min(720,ih)", source)
        self.assertIn('"ultrafast"', source)
        self.assertIn('"-progress", "pipe:1"', source)
        self.assertIn("Converting for offline playback · {percent}%", source)

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

    def test_usb_series_import_preserves_season_folders_without_refreshing_tv(self) -> None:
        season = self.volume / "Silicon Valley" / "Season 1"
        season.mkdir(parents=True)
        episode = season / "Silicon.Valley.S01E06.720p.HDTV.x264.mkv"
        episode.write_bytes(b"episode" * 1000)

        job = self.fixture.library.start_usb_import({
            "volume": "TEST-USB",
            "paths": ["Silicon Valley/Season 1"],
            "target": "series",
            "series_name": "Silicon Valley",
        })
        deadline = time.time() + 5
        result = job
        while result["status"] not in {"complete", "error"} and time.time() < deadline:
            time.sleep(0.02)
            result = self.fixture.library.usb_import_status(job["id"])

        self.assertEqual(result["status"], "complete")
        imported = (self.fixture.library.adult_series_root / result["series"] /
                    "Season 1" / episode.name)
        self.assertEqual(imported.read_bytes(), b"episode" * 1000)
        self.fixture.library.refresh_tv.assert_not_called()
        series = self.fixture.library.adult_series_library()[0]
        self.assertEqual(series["episodes"][0]["season"], 1)
        self.assertEqual(series["episodes"][0]["episode"], 6)

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
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": False,
            "channel_film_positions": {"1/Episode.mp4": 1800},
            "channel_film_durations": {"1/Episode.mp4": 7200},
            "channel_film_position_updated_utc_ms": {"1/Episode.mp4": 1000},
        }), encoding="utf-8")
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
                          "file": "Episode.mp4", "position": 1800.0})
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

    def test_portal_play_on_tv_wakes_standby_and_honours_start_position(self) -> None:
        adult_movie = self.fixture.library.adult_root / "Film.mp4"
        adult_movie.write_bytes(b"film")
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": True,
        }), encoding="utf-8")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        self.fixture.library.live_tv_control = mock.Mock(
            return_value={"ok": True, "message": "Command sent"})

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.play_on_tv({
                "kind": "adult", "file": adult_movie.name, "position": 0,
            })

        self.fixture.library.live_tv_control.assert_called_once_with({
            "command": "turn-on",
        })
        command = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(command, {
            "command": "play-adult-film", "file": adult_movie.name,
            "position": 0.0,
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["message"],
                         "Turned on Mabel TV and playing Film")

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

    def test_one_show_channel_requires_a_selected_metadata_match(self) -> None:
        channels = [
            {"number": 1, "name": "Postman Pat", "folder": "postman-pat",
             "aspect": "crop", "content_type": "shows"},
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [
                {"id": 101, "name": "Postman", "overview": "Wrong show.",
                 "first_air_date": "2010-01-01"},
                {"id": 102, "name": "Postman Pat", "overview": "Greendale stories.",
                 "first_air_date": "1981-09-16"},
            ]},
            {"id": 102, "name": "Postman Pat", "overview": "Greendale stories.",
             "first_air_date": "1981-09-16", "backdrop_path": "/pat.jpg"},
        ])
        self.fixture.library.cache_channel_artwork = mock.Mock(
            return_value="mabel-show-1-102.jpg")

        search = self.fixture.library.refresh_channel_show_metadata({"channel": 1})

        self.assertEqual([value["id"] for value in search["results"]], [101, 102])
        self.assertEqual(search["query"], "Postman Pat")
        self.assertEqual(
            self.fixture.library.tmdb_request.call_args_list[0].args[0], "search/tv")
        self.assertEqual(self.fixture.library.channel_media_states(), {})

        result = self.fixture.library.refresh_channel_show_metadata({
            "channel": 1, "tmdb_id": 102,
        })

        self.assertEqual(result["metadata"]["title"], "Postman Pat")
        self.assertEqual(result["metadata"]["artwork"], "mabel-show-1-102.jpg")
        metadata = self.fixture.library.channel_media_states()["channels"]["1"]
        self.assertEqual(metadata["tmdb_id"], 102)
        self.fixture.library.cache_channel_artwork.assert_called_once_with(
            "/pat.jpg", "mabel-show-1-102.jpg", backdrop=True)
        with self.assertRaisesRegex(ValueError, "only available for show channels"):
            self.fixture.library.refresh_channel_show_metadata({"channel": 5})

    def test_one_film_channel_programme_requires_a_selected_metadata_match(self) -> None:
        channels = [
            {"number": 1, "name": "Shows", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        (self.fixture.media / "shows").mkdir(parents=True)
        (self.fixture.media / "shows" / "Episode.mp4").write_bytes(b"show")
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        file_name = "Room_on_the_Broom_-__p0102qfj_original.mp4"
        (films / file_name).write_bytes(b"film")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [
                {"id": 201, "title": "Wrong Room", "overview": "Not this one.",
                 "release_date": "2001-01-01"},
                {"id": 202, "title": "Room on the Broom",
                 "overview": "A magical journey.", "release_date": "2012-12-25"},
            ]},
            {"id": 202, "title": "Room on the Broom", "overview": "A magical journey.",
             "release_date": "2012-12-25", "poster_path": "/room.jpg"},
        ])
        self.fixture.library.cache_channel_artwork = mock.Mock(
            return_value="mabel-film-5-202.jpg")

        search = self.fixture.library.refresh_channel_programme_metadata({
            "channel": 5, "file": file_name,
        })

        self.assertEqual([value["id"] for value in search["results"]], [201, 202])
        self.assertEqual(
            self.fixture.library.tmdb_request.call_args_list[0].args[1]["query"],
            "Room on the Broom")
        rendered = self.fixture.library.library()["channels"]
        film_channel = next(channel for channel in rendered if channel["number"] == 5)
        self.assertEqual(film_channel["programmes"][0]["metadata"], {})

        result = self.fixture.library.refresh_channel_programme_metadata({
            "channel": 5, "file": file_name, "tmdb_id": 202,
        })

        self.assertEqual(result["metadata"]["title"], "Room on the Broom")
        rendered = self.fixture.library.library()["channels"]
        film_channel = next(channel for channel in rendered if channel["number"] == 5)
        self.assertEqual(film_channel["programmes"][0]["metadata"]["tmdb_id"], 202)
        self.assertEqual(
            self.fixture.library.channel_programme_title(5, file_name),
            "Room on the Broom")
        self.fixture.library.player_state_path = self.fixture.root / "state.json"
        self.fixture.library.write_json(self.fixture.library.player_state_path, {
            "standby": False,
            "current_channel": 5,
            "playback_paused": True,
            "channel_timelines": {"5": {
                "episode_name": file_name,
                "position_seconds": 90,
            }},
        })
        live = self.fixture.library.live_stream.source()
        self.assertEqual(live["programme"], "Room on the Broom")
        with self.assertRaisesRegex(ValueError, "only available for film channels"):
            self.fixture.library.refresh_channel_programme_metadata({
                "channel": 1, "file": "Episode.mp4",
            })

    def test_film_can_move_to_another_film_channel_with_state(self) -> None:
        channels = [
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
            {"number": 6, "name": "Christmas Films", "folder": "christmas-films",
             "aspect": "fit", "content_type": "films"},
            {"number": 7, "name": "Shows", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
        ]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        for channel in channels:
            (self.fixture.media / channel["folder"]).mkdir(parents=True)
        source = self.fixture.media / "films" / "The Snowman.mp4"
        source.write_bytes(b"film")
        settings = self.fixture.library.settings()
        settings.setdefault("library", {}).setdefault("disabled_programmes", {})["5"] = [source.name]
        self.fixture.settings.write_text(json.dumps(settings), encoding="utf-8")
        self.fixture.library.write_channel_media_states({
            "programmes": {"5/The Snowman.mp4": {
                "tmdb_id": 13396, "title": "The Snowman", "poster": "mabel-film-5-13396.jpg",
            }}
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        self.fixture.library.manage({
            "action": "move-programme", "channel": 5,
            "target_channel": 6, "file": source.name,
        })

        self.assertFalse(source.exists())
        self.assertTrue((self.fixture.media / "christmas-films" / source.name).is_file())
        disabled = self.fixture.library.settings()["library"]["disabled_programmes"]
        self.assertNotIn(source.name, disabled["5"])
        self.assertIn(source.name, disabled["6"])
        metadata = self.fixture.library.channel_media_states()["programmes"]
        self.assertNotIn("5/The Snowman.mp4", metadata)
        self.assertEqual(metadata["6/The Snowman.mp4"]["tmdb_id"], 13396)
        with self.assertRaisesRegex(ValueError, "another film channel"):
            self.fixture.library.manage({
                "action": "move-programme", "channel": 6,
                "target_channel": 7, "file": source.name,
            })

    def test_film_rename_preserves_its_selected_metadata(self) -> None:
        channels = [{
            "number": 5, "name": "Films", "folder": "films",
            "aspect": "fit", "content_type": "films",
        }]
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": channels,
        }), encoding="utf-8")
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        source = films / "Room_on_the_Broom_-__p0102qfj_original.mp4"
        source.write_bytes(b"film")
        self.fixture.library.write_channel_media_states({
            "programmes": {f"5/{source.name}": {
                "tmdb_id": 201, "title": "Room on the Broom",
                "poster": "mabel-film-5-201.jpg",
            }}
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        self.fixture.library.manage({
            "action": "rename", "channel": 5, "file": source.name,
            "name": "Room on the Broom",
        })

        renamed = films / "Room on the Broom.mp4"
        self.assertTrue(renamed.is_file())
        self.assertFalse(source.exists())
        metadata = self.fixture.library.channel_media_states()["programmes"]
        self.assertNotIn(f"5/{source.name}", metadata)
        self.assertEqual(metadata[f"5/{renamed.name}"]["tmdb_id"], 201)

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

    def test_viewing_history_joins_adjacent_samples_and_builds_summaries(self) -> None:
        now = time.time()
        activity = {
            "item_key": "channel:5:film.mp4",
            "title": "Film",
            "kind": "film",
            "surface": "tv",
            "channel_number": 5,
            "channel_name": "Films",
        }
        self.fixture.library.record_viewing(activity, 45, now - 60)
        self.fixture.library.record_viewing(activity, 30, now - 20)

        self.assertEqual(self.fixture.library.viewing_store["sessions"], [])
        self.fixture.library.record_viewing(activity, 45, now)
        self.assertEqual(len(self.fixture.library.viewing_store["sessions"]), 1)
        self.assertEqual(self.fixture.library.viewing_store["sessions"][0]["seconds"], 120)
        summary = self.fixture.library.viewing_insights(30, 0)
        self.assertEqual(summary["summary"]["sessions"], 1)
        self.assertEqual(summary["summary"]["range_seconds"], 120)
        self.assertEqual(summary["summary"]["active_days"], 1)
        self.assertEqual(summary["summary"]["unique_items"], 1)
        self.assertEqual(summary["summary"]["average_active_day_seconds"], 120)
        self.assertEqual(summary["summary"]["longest_session_seconds"], 120)
        self.assertEqual(summary["top_titles"][0]["title"], "Film")
        self.assertEqual(summary["top_films"][0]["title"], "Film")
        self.assertEqual(len(summary["time_of_day"]), 4)
        self.assertTrue(summary["timeline"])
        self.assertEqual(summary["by_surface"][0]["name"], "tv")

    def test_viewing_history_counts_remote_playback_but_rejects_seeks(self) -> None:
        session = {
            "kind": "channel", "content_kind": "episode", "title": "Episode",
            "channel": 1, "file": "Episode.mp4", "library_id": None,
        }
        self.fixture.library.write_json(self.fixture.channels, {
            "channels": [{"number": 1, "name": "Series", "folder": "series",
                          "content_type": "shows"}],
        })
        samples = list(range(0, 121, 10)) + [500]
        with mock.patch.object(mabeltv_library.time, "monotonic",
                               side_effect=[100.0 + value for value in samples]):
            for position in samples:
                self.fixture.library.record_remote_viewing(
                    session, "token", position, 1800)

        sessions = self.fixture.library.viewing_store["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["seconds"], 120)
        self.assertEqual(sessions[0]["kind"], "channel")
        self.assertEqual(sessions[0]["title"], "Series")

    def test_viewing_history_joins_each_concurrent_surface_session(self) -> None:
        now = time.time()
        tv = {"item_key": "channel:5:film.mp4", "title": "Film", "kind": "film",
              "surface": "tv", "channel_number": 5, "channel_name": "Films"}
        device = {**tv, "item_key": "browser:channel:5/film.mp4",
                  "surface": "device"}
        self.fixture.library.record_viewing(tv, 60, now - 45)
        self.fixture.library.record_viewing(device, 60, now - 30)
        self.fixture.library.record_viewing(tv, 60, now - 15)
        self.fixture.library.record_viewing(device, 60, now)

        sessions = self.fixture.library.viewing_store["sessions"]
        self.assertEqual(len(sessions), 2)
        self.assertEqual(sorted(item["seconds"] for item in sessions), [120, 120])

    def test_tv_viewing_identity_handles_channels_and_adult_mode(self) -> None:
        self.fixture.library.write_json(self.fixture.channels, {
            "channels": [{"number": 5, "name": "Films", "folder": "films",
                          "content_type": "films"}],
        })
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(json.dumps({
            "standby": False, "playback_paused": False, "current_channel": 5,
            "channel_timelines": {"5": {"episode_name": "The Film.mp4"}},
        }), encoding="utf-8")
        self.fixture.library.player_mode_status = mock.Mock(return_value={"mode": "kids"})
        channel = self.fixture.library.current_tv_viewing()
        self.assertEqual(channel["title"], "The Film")
        self.assertEqual(channel["kind"], "film")
        self.assertEqual(channel["channel_name"], "Films")

        self.fixture.library.player_mode_status.return_value = {
            "mode": "adult", "standby": False, "playing": True,
            "paused": False, "programme": "Adult Film",
        }
        self.assertIsNone(self.fixture.library.current_tv_viewing())

    def test_viewing_history_rolls_episodes_up_to_channel_and_deletes_selected(self) -> None:
        now = time.time()
        activity = {"item_key": "channel:2", "title": "Puffin Rock",
                    "kind": "channel", "surface": "tv", "channel_number": 2,
                    "channel_name": "Puffin Rock"}
        self.fixture.library.record_viewing(activity, 60, now - 60)
        self.fixture.library.record_viewing(activity, 60, now)
        summary = self.fixture.library.viewing_insights(1, 0)
        self.assertEqual(summary["sessions"][0]["title"], "Puffin Rock")
        self.assertEqual(summary["sessions"][0]["kind"], "channel")
        session_id = summary["sessions"][0]["id"]
        result = self.fixture.library.delete_viewing_sessions({"ids": [session_id]})
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(self.fixture.library.viewing_store["sessions"], [])

    def test_viewing_history_migration_removes_non_mabel_and_short_sessions(self) -> None:
        now = time.time()
        self.fixture.library.write_json(self.fixture.library.viewing_history_path, {
            "schema_version": 1,
            "tracking_started": now - 1000,
            "sessions": [
                {"kind": "adult", "seconds": 300, "ended": now,
                 "channel_number": None},
                {"kind": "usb", "seconds": 300, "ended": now,
                 "channel_number": None},
                {"kind": "episode", "seconds": 90, "ended": now,
                 "channel_number": 2, "channel_name": "Puffin Rock"},
                {"kind": "episode", "seconds": 180, "ended": now,
                 "channel_number": 2, "channel_name": "Puffin Rock",
                 "item_key": "channel:2:episode.mp4", "surface": "tv"},
            ],
        })
        store = self.fixture.library.load_viewing_store()
        self.assertEqual(len(store["sessions"]), 1)
        self.assertEqual(store["sessions"][0]["kind"], "channel")
        self.assertEqual(store["sessions"][0]["item_key"], "channel:2")
        self.assertTrue(store["sessions"][0]["id"])
        persisted = self.fixture.library.read_json(
            self.fixture.library.viewing_history_path, {})
        self.assertEqual(persisted["schema_version"], 2)
        self.assertEqual(len(persisted["sessions"]), 1)

    def test_experience_uses_shared_icons_and_clear_channel_pager(self) -> None:
        channel_script = (PORTAL_ROOT / "js" / "channel-page.js").read_text(
            encoding="utf-8")
        library_script = (PORTAL_ROOT / "js" / "library.js").read_text(
            encoding="utf-8")
        system_view = (PORTAL_ROOT / "html" / "views" / "system.html").read_text(
            encoding="utf-8")
        insights_view = (PORTAL_ROOT / "html" / "views" / "insights.html").read_text(
            encoding="utf-8")
        experience_css = (PORTAL_ROOT / "css" / "experience-library.css").read_text(
            encoding="utf-8")
        settings_css = (PORTAL_ROOT / "css" / "experience-settings.css").read_text(
            encoding="utf-8")
        playback_script = (PORTAL_ROOT / "js" / "playback.js").read_text(
            encoding="utf-8")
        design_switch = (PORTAL_ROOT / "html" / "portal-design-switch.html").read_text(
            encoding="utf-8")
        self.assertIn("signalIcon('signal-chevron-down')", channel_script)
        self.assertIn("programmePager", channel_script)
        self.assertNotIn('<svg viewBox="0 0 24 24"', channel_script)
        self.assertIn("body.portal-v2 .channel-page-load-more", experience_css)
        self.assertIn("border: 1px solid rgba(255, 122, 26, .48)", experience_css)
        self.assertIn("mabelRemotePositionTimer = setInterval(saveMabelRemotePosition, 15000)",
                      playback_script)
        self.assertNotIn("viewBox=", design_switch)
        self.assertEqual(design_switch.count("/portal/icons.svg#signal-check"), 2)
        self.assertNotIn('id="viewingInsights"', system_view)
        self.assertIn('data-go="insights"', system_view)
        self.assertIn('id="viewingInsights"', insights_view)
        self.assertIn('/portal/icons.svg#signal-chart-column', insights_view)
        self.assertNotIn('<svg viewBox="0 0 24 24"', system_view)
        self.assertNotIn('<svg viewBox="0 0 24 24"', insights_view)
        self.assertNotIn('id="viewingDeleteSelected"', insights_view)
        self.assertNotIn("selectedViewingSessions", library_script)
        self.assertIn("bindViewingSessionSwipe", library_script)
        self.assertIn("viewing-session-delete", settings_css)
        self.assertIn("renderViewingItem", library_script)
        self.assertIn("new Chart(canvas, config)", library_script)
        self.assertNotIn("createElementNS(namespace, 'polyline')", library_script)
        self.assertIn("viewing-destinations", settings_css)
        self.assertIn("viewing-catalog-grid", settings_css)
        self.assertIn(".activity-job-top > div { min-width: 0", settings_css)
        self.assertIn(".activity-job h2 { max-width: 100%; overflow-wrap: anywhere", settings_css)
        self.assertIn('id="viewingItemDetail"', insights_view)
        self.assertIn('id="viewingItemWeekdays"', insights_view)
        self.assertIn('id="viewingDiary"', insights_view)
        self.assertIn('data-insights-tab="history"', insights_view)
        self.assertIn('id="viewingRangeControls"', insights_view)
        self.assertIn('id="viewingItemRangeSelect"', insights_view)
        self.assertIn('viewing-insights-loading hidden', insights_view)
        self.assertIn('replaceInsightsRoute(`insights/item/', library_script)
        self.assertIn("$('#viewingRangeControls')?.classList.toggle('hidden'", library_script)
        self.assertIn('viewingInsightsLoadedRange === viewingInsightsRange', library_script)
        self.assertIn('background-size: contain', settings_css)
        self.assertIn('.viewing-range.hidden { display: none; }', settings_css)


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
                             ("/portal/assets/providers/bbc-iplayer-app.jpg", b"\xff\xd8\xff"),
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
