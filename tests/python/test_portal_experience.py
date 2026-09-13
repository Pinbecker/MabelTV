from __future__ import annotations

from tests.python.library_test_support import *


class PortalExperienceTests(unittest.TestCase):
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
            "watch", "watch-overlays", "watch-library", "management",
            "player-shell", "usb", "settings", "responsive", "channel-page",
            "experience-foundation", "experience-components",
            "experience-shell", "experience-home",
            "experience-remote", "experience-watch", "experience-library",
            "experience-viewing", "experience-title-metadata",
            "experience-settings", "experience-insights", "experience-adult-insights",
            "experience-responsive",
            "experience-overlays", "experience-playback-overlays",
            "lg-tv-remote", "experience-light",
        )
        css_positions = [html.index(f'/portal/css/{name}.css') for name in css_names]
        self.assertEqual(css_positions, sorted(css_positions))
        self.assertIn('<script src="/portal-app.js"></script>', html)
        markers = [mabeltv_library.PORTAL_APP_SCRIPT.index(f"/* {path} */")
                   for path in mabeltv_library.PORTAL_APP_SOURCES]
        self.assertEqual(markers, sorted(markers))
        self.assertTrue(mabeltv_library.PORTAL_APP_SCRIPT.startswith("(() => {"))
        fixture_script = mabeltv_library.load_portal_app_script(private_scope=False)
        self.assertTrue(fixture_script.startswith("'use strict'"))
        self.assertFalse(fixture_script.startswith("(() => {"))
        self.assertIn("function openAdultTitle", fixture_script)
        fixture_server = (
            PROJECT_ROOT / "tests" / "browser" / "fixture_server.py"
        ).read_text(encoding="utf-8")
        self.assertIn("load_portal_app_script(private_scope=False)", fixture_server)
        service_worker = (PROJECT_ROOT / "scripts" / "pi" / "service-worker.js").read_text(
            encoding="utf-8")
        linked_shell_assets = set(re.findall(
            r'(?:href|src)="(/portal/(?:css|js)/[^"?]+)"',
            html,
        ))
        for asset in linked_shell_assets:
            self.assertTrue((PROJECT_ROOT / "scripts" / "pi" / asset.lstrip("/")).is_file())
            self.assertIn(repr(asset), service_worker)
        self.assertIn("'/portal-app.js'", service_worker)
        self.assertLess(html.index('/portal/js/experience-theme.js'),
                        html.index('/portal/css/experience-foundation.css'))
        self.assertNotIn("<style", html)
        self.assertNotRegex(html, r"\sstyle=")
        self.assertNotIn("!important", PORTAL_STYLES)
        self.assertIn("@layer reset, tokens, base, components", PORTAL_STYLES)
        self.assertIn("--control-min: 44px", PORTAL_STYLES)
        self.assertIn('/portal/icons.svg#signal-house', html)
        self.assertIn('class="logo-mark" src="/mabeltv-icon.png"', html)
        self.assertNotIn('id="mobileActivityStatus"', html)
        self.assertIn('class="mobile-remote-switcher tv-remote-switcher"', html)
        logo = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-icon.png").read_bytes()
        self.assertTrue(logo.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertTrue(logo.endswith(b"IEND\xaeB`\x82"))
        self.assertIn("*.png binary", (PROJECT_ROOT / ".gitattributes").read_text(
            encoding="utf-8"))
        self.assertTrue((PORTAL_ROOT / "icons.svg").is_file())
        self.assertIn('portal-include:html/app-shell.html', source)
        self.assertLess(len(source), 5_000)
        self.assertNotIn('portal-include:', html)
        for name in ("overview", "live", "lg-tv", "channels", "adult", "watch", "usb", "system"):
            self.assertTrue((PORTAL_ROOT / "html" / "views" / f"{name}.html").is_file())
        self.assertTrue((PORTAL_ROOT / "html" / "views" / "adult-viewing.html").is_file())
        for retired in ("core.js", "library.js", "playback.js", "adult-viewing.js"):
            self.assertFalse((PORTAL_ROOT / "js" / retired).exists())
        component_script = (PORTAL_ROOT / "js" / "ui-components.js").read_text(
            encoding="utf-8")
        feature_scripts = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (PORTAL_ROOT / "js").rglob("*.js")
            if path.name != "ui-components.js"
        )
        self.assertIn("window.MabelPortalUI", component_script)
        self.assertNotIn(".showModal()", feature_scripts)
        self.assertNotIn("document.documentElement.style.overflow = 'hidden'",
                         feature_scripts)
        self.assertNotIn("createElementNS('http://www.w3.org/2000/svg'",
                         feature_scripts)
        self.assertEqual(html.count('id="iosWatchPlayer"'), 1)
        self.assertEqual(html.count('id="mabelWatchPlayer"'), 1)

    def test_portal_uses_one_experience_system_with_device_theme_and_accent(self) -> None:
        html = mabeltv_library.INDEX
        styles = PORTAL_EXPERIENCE_STYLES
        light_styles = (PORTAL_ROOT / "css" / "experience-light.css").read_text(
            encoding="utf-8")
        theme_script = (PORTAL_ROOT / "js" / "experience-theme.js").read_text(
            encoding="utf-8")
        core = PORTAL_CORE
        playback = PORTAL_PLAYBACK
        markup = PORTAL_OVERLAY_MARKUP
        channel_page = (PORTAL_ROOT / "js" / "channel-page.js").read_text(
            encoding="utf-8")

        self.assertIn('/portal/css/experience-foundation.css', html)
        self.assertIn('/portal/css/experience-shell.css', html)
        self.assertIn('/portal/css/experience-home.css', html)
        self.assertIn('/portal/css/experience-remote.css', html)
        self.assertIn('/portal/css/experience-watch.css', html)
        self.assertIn('/portal/css/experience-library.css', html)
        self.assertIn('/portal/css/experience-appearance.css', html)
        self.assertIn('/portal/css/experience-settings.css', html)
        self.assertIn('/portal/css/experience-responsive.css', html)
        self.assertIn('/portal/css/experience-overlays.css', html)
        self.assertIn('/portal/css/experience-light.css', html)
        self.assertIn('/portal/js/experience-theme.js', html)
        self.assertNotIn('/portal/css/product-', html)
        self.assertIn('class="portal-v2 portal-experience"', html)
        self.assertNotIn('/portal/js/appearance.js', html)
        self.assertNotIn('/portal/js/component-gallery.js', html)
        self.assertNotIn('id="view-components"', html)
        self.assertNotIn('id="portalAppearanceControl"', html)
        self.assertNotIn('data-portal-design', html)
        self.assertFalse(MODULE_PATH.with_name("mabeltv-library-classic.html").exists())
        for retired in ("appearance.js", "component-gallery.js"):
            self.assertFalse((PORTAL_ROOT / "js" / retired).exists())
        self.assertFalse(any((PORTAL_ROOT / "css").glob("component-direction-*.css")))
        self.assertNotIn("'components'", core)
        self.assertNotIn("mabeltv_portal_design", core)
        self.assertIn("--experience-accent-hue: 48", styles)
        self.assertIn("--experience-orange: var(--experience-accent)", styles)
        self.assertIn("color-scheme: dark", styles)
        self.assertIn("--experience-orange: var(--experience-accent-ink)", light_styles)
        self.assertIn("color-scheme: light", light_styles)
        self.assertIn('html[data-experience-theme="light"]', light_styles)
        self.assertIn('<meta name="theme-color" content="#0b0a0d">', html)
        self.assertIn('<meta name="apple-mobile-web-app-status-bar-style" content="default">', html)
        self.assertIn('id="experienceThemeLevel"', html)
        self.assertIn('id="experienceAccentHue"', html)
        self.assertIn('data-accent-strength="balanced"', html)
        self.assertIn("mabeltv-experience-theme", theme_script)
        self.assertIn("localStorage.setItem(STORAGE_KEY, theme)", theme_script)
        self.assertIn("mabeltv-experience-accent-hue", theme_script)
        self.assertIn("localStorage.setItem(ACCENT_STORAGE_KEY", theme_script)
        self.assertIn("mabeltv-experience-accent-strength", theme_script)
        self.assertIn('html[data-experience-theme="dim"]', styles)
        self.assertIn("--experience-favourite-base: #c82f71", styles)
        self.assertIn("--accent: var(--experience-orange)", styles)
        self.assertNotRegex(
            styles,
            r"(?i)#(?:ff7a1a|ff8f3a|b54800|b84600)|rgba\(\s*(?:255\s*,\s*122\s*,\s*26|255\s*,\s*116\s*,\s*23)",
        )
        self.assertNotIn("#f4f3f1", light_styles)
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
        self.assertIn('id="view-adult-home"', html)
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
        self.assertIn(".tv-remote-chassis", styles)
        self.assertIn(".watch-poster-grid", styles)
        self.assertIn(".library-main-card", styles)
        self.assertIn(".settings-disclosure", styles)
        self.assertNotIn('data-view-button="channels"', html)
        self.assertNotIn('data-view-button="usb"', html)
        self.assertIn('data-view-button="adult-home"', html)
        self.assertIn('data-go="usb"', html)
        self.assertIn('<h1>USB</h1>', html)
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
        self.assertIn('class="tv-remote-card-actions"', html)
        self.assertIn("MabelPortalUI.setPowerStatus($('#remoteMabelTvLed')", core)
        self.assertIn(".tv-remote-utility-row", styles)
        self.assertIn(".tv-remote-dpad .tv-dpad-ok", styles)
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
        markup = PORTAL_OVERLAY_MARKUP
        styles = PORTAL_EXPERIENCE_STYLES
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
        self.assertNotIn("sheet-handle", markup)
        self.assertIn(".remote-channel-options, .remote-power-actions", styles)
        self.assertIn("grid-template-columns: 44px minmax(0, 1fr)", styles)
        self.assertIn(".remote-channel-option > span:last-child", styles)
        self.assertIn(".remote-sheet-panel", light_styles)
        self.assertIn(".remote-sheet-panel > header", light_styles)
        self.assertIn(".remote-sheet-close", light_styles)

    def test_media_sheets_share_header_geometry_and_parent_navigation(self) -> None:
        markup = PORTAL_OVERLAY_MARKUP
        core = PORTAL_CORE
        playback = PORTAL_PLAYBACK
        styles = PORTAL_EXPERIENCE_STYLES
        ui_components = (PORTAL_ROOT / "js" / "ui-components.js").read_text(
            encoding="utf-8")

        for dialog in re.findall(r"<dialog\b.*?</dialog>", markup, re.DOTALL):
            with self.subTest(dialog=re.search(r'id="([^"]+)"', dialog).group(1)):
                self.assertIn("portal-sheet-close", dialog)

        self.assertIn("const portalSheets = window.MabelPortalUI?.dialogs", core)
        self.assertIn("const dialogParents = new WeakMap()", ui_components)
        self.assertIn("open: openDialog", ui_components)
        self.assertIn("wire: wireDialog", ui_components)
        self.assertIn("body.portal-experience .portal-sheet-close {", styles)
        self.assertIn("body.portal-experience .portal-sheet-title-row {", styles)
        self.assertIn("border: 1px solid color-mix(in srgb, var(--experience-accent) 72%, transparent);", styles)
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

        episode_sheet_match = re.search(
            r'<dialog\s+id="adultEpisodeSheet".*?</dialog>', markup, re.DOTALL)
        self.assertIsNotNone(episode_sheet_match)
        episode_sheet = episode_sheet_match.group(0)
        self.assertNotIn("sheet-favourite", episode_sheet)
        self.assertNotIn('id="adultEpisodeMore"', episode_sheet)
        self.assertIn('id="adultEpisodeDownload"', episode_sheet)
        self.assertIn('id="adultEpisodeDelete"', episode_sheet)
        self.assertNotIn("watchProgrammeMoreReturn", playback)
        self.assertNotIn("adultEpisodeMoreReturn", playback)
        self.assertIn("openWatchProgrammeMoreSheet(channel, programme, context, parentReturn)", playback)
        self.assertIn("card.onclick = () => openAdultEpisodeSheet(series, episode)", playback)

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
        experience_overlays = PORTAL_EXPERIENCE_STYLES

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
        self.assertIn("function closeWatchProgrammeMoreSheet(", PORTAL_SCRIPT)
        self.assertIn("closeWatchProgrammeMoreSheet],", PORTAL_SCRIPT)
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
        self.assertIn("margin-top: -22px", experience_responsive)
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
        self.assertIn(".portal-search:focus-within", PORTAL_EXPERIENCE_STYLES)
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
        self.assertIn("border-color: color-mix(in srgb, var(--experience-accent) 52%, transparent)", experience_overlays)
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
        self.assertIn("actionLabel.textContent = 'Removing…'", index)
        self.assertNotIn("Starting from beginning…", index)
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
        self.assertIn("function configureFilmPlaybackActions(film, context, controls)", index)
        self.assertIn("restartAction: () => playOnTvNow(0)", index)
        self.assertIn('id="watchProgrammeSheet"', index)
        self.assertIn('id="watchManageAdult"', index)
        self.assertRegex(index, r'id="watchFilmManage"\s+type="button"\s+class="card-settings-trigger hidden"')
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
        self.assertNotIn('data-view-button="usb"', index)
        self.assertIn('data-view-button="adult-home"', index)
        self.assertIn("const consolidatedWatchView", index)

    def test_global_notices_expire_and_do_not_follow_navigation(self) -> None:
        core = PORTAL_CORE

        self.assertIn("}, bad ? 7000 : 3500)", core)
        self.assertNotIn("message.endsWith('…')", core)
        open_view = core[core.index("function openView(name, options = {})"):]
        self.assertIn("notice('')", open_view[:500])

    def test_channel_entry_is_instant_and_favourite_is_primary(self) -> None:
        core = PORTAL_CORE
        library = PORTAL_LIBRARY
        actions = (PORTAL_ROOT / "js" / "actions.js").read_text(encoding="utf-8")
        overlays = PORTAL_OVERLAY_MARKUP

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


if __name__ == "__main__":
    unittest.main()
