from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class PlayerSafetyTests(unittest.TestCase):
    def test_playback_telemetry_never_queries_libmpv_synchronously(self) -> None:
        source = (PROJECT_ROOT / "src" / "media" / "MpvVideo.cpp").read_text(
            encoding="utf-8"
        )
        header = (PROJECT_ROOT / "src" / "media" / "MpvVideo.h").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("mpv_get_property", source)
        self.assertIn('mpv_observe_property(m_state->handle, 3, "time-pos"', source)
        self.assertIn('mpv_observe_property(m_state->handle, 4, "duration"', source)
        self.assertIn("Q_PROPERTY(double playbackPosition", header)
        self.assertIn("Q_PROPERTY(double playbackDuration", header)

    def test_adult_overlay_binds_to_cached_telemetry(self) -> None:
        qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )

        self.assertIn("adultPlayer.playbackPosition", qml)
        self.assertIn("adultPlayer.playbackDuration", qml)
        self.assertNotIn("adultPlayer.positionSeconds()", qml)
        self.assertNotIn("adultPlayer.durationSeconds()", qml)

    def test_stop_and_immediate_replay_are_serialized(self) -> None:
        source = (PROJECT_ROOT / "src" / "media" / "MpvVideo.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn("if (m_stopPending)", source)
        self.assertIn("m_hasQueuedPlay = true", source)
        self.assertIn("finishPendingStop();", source)
        self.assertIn("case MPV_EVENT_END_FILE", source)
        self.assertIn("Waiting for previous playback to stop", source)

    def test_player_loads_each_playback_generation_once_and_bounds_stop(self) -> None:
        source = (PROJECT_ROOT / "src" / "media" / "MpvVideo.cpp").read_text(
            encoding="utf-8"
        )
        header = (PROJECT_ROOT / "src" / "media" / "MpvVideo.h").read_text(
            encoding="utf-8"
        )

        self.assertIn("Q_PROPERTY(qulonglong playbackGeneration", header)
        self.assertIn("m_dispatchedPlaybackGeneration == m_playbackGeneration", source)
        self.assertIn("loadCommandReplyBase + generation", source)
        self.assertIn("m_stopTimeout.start()", source)
        self.assertIn("reportFatalFailure", source)
        self.assertIn("releaseUnusedDecoderMemory();", source)
        self.assertIn("malloc_trim(0);", source)

    def test_adult_mode_waits_for_decoder_release_before_resuming_tv(self) -> None:
        source = (PROJECT_ROOT / "src" / "media" / "MpvVideo.cpp").read_text(
            encoding="utf-8"
        )
        header = (PROJECT_ROOT / "src" / "media" / "MpvVideo.h").read_text(
            encoding="utf-8"
        )
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")
        application = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn("void playbackStopped();", header)
        self.assertIn("emit playbackStopped();", source)
        self.assertIn("onPlaybackStopped", adult_qml)
        self.assertIn("if (overlay.closing)", adult_qml)
        self.assertIn("adultResumeTimer.restart()", main_qml)
        self.assertIn("interval: 400", main_qml)

    def test_visible_adult_player_is_inside_stall_monitor(self) -> None:
        source = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn('QStringLiteral("mabeltvAdultPlayer")', source)
        self.assertIn("adultVideo->isVisible() ? adultVideo : video", source)

    def test_pi4_avoids_wedged_h264_driver_but_keeps_hevc_hardware_decode(self) -> None:
        launcher = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-launch.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn('MABELTV_HWDEC="drm-copy"', launcher)
        self.assertNotIn('MABELTV_HWDEC="v4l2m2m-copy,drm-copy"', launcher)

    def test_pi_display_uses_saved_720p_default_with_fixed_refresh(self) -> None:
        launcher = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-launch.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn('.get("display_resolution", "720p")', launcher)
        self.assertIn('*) kms_mode="1280x720@60"', launcher)
        self.assertIn('1080p) kms_mode="1920x1080@30"', launcher)
        self.assertIn('MABELTV_DRM_MODE:-$kms_mode', launcher)
        self.assertIn("silently select 1080p120", launcher)
        self.assertIn('"format": "xrgb8888"', launcher)
        self.assertIn('native) kms_mode="preferred"', launcher)

    def test_adult_mode_has_a_direct_shortcut_and_subtitle_control(self) -> None:
        controller_header = (PROJECT_ROOT / "src" / "core" / "TvController.h").read_text(
            encoding="utf-8"
        )
        controller_source = (PROJECT_ROOT / "src" / "core" / "TvController.cpp").read_text(
            encoding="utf-8"
        )
        player_header = (PROJECT_ROOT / "src" / "media" / "MpvVideo.h").read_text(
            encoding="utf-8"
        )
        player_source = (PROJECT_ROOT / "src" / "media" / "MpvVideo.cpp").read_text(
            encoding="utf-8"
        )
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")
        application = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn("void requestAdultModeShortcut();", controller_header)
        self.assertIn("Adult mode requested from parent-access shortcut", controller_source)
        self.assertIn("Q_PROPERTY(bool subtitlesVisible", player_header)
        self.assertIn("Q_INVOKABLE void toggleSubtitles();", player_header)
        self.assertIn('"sub-auto",', player_source)
        self.assertIn("subtitleDefaultOn: true", adult_qml)
        self.assertIn("adultPlayer.toggleSubtitles()", adult_qml)
        self.assertIn('QStringLiteral("toggle-subtitles")', application)
        self.assertIn('command === "toggle-subtitles"', main_qml)

    def test_adult_back_returns_to_library_before_leaving_adult_mode(self) -> None:
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")

        self.assertIn("function back(waitForRelease)", adult_qml)
        self.assertIn("if (playing || stopping)", adult_qml)
        self.assertIn("ignoreLibraryBackBeforeMs = Date.now() + 750", adult_qml)
        self.assertIn("function handleKeyReleased", adult_qml)
        self.assertIn("adultMode.handleKeyReleased(event.key, event.isAutoRepeat)", main_qml)
        self.assertIn("adultMode.back(false)", main_qml)

    def test_adult_library_is_a_remote_first_media_portal(self) -> None:
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")
        application = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn('text: "Adult Library"', adult_qml)
        self.assertIn("id: detailPanel", adult_qml)
        self.assertIn("id: collectionTabs", adult_qml)
        self.assertIn("id: posterGrid", adult_qml)
        self.assertIn("readonly property int columns: 5", adult_qml)
        self.assertIn("cellHeight: height / 2", adult_qml)
        self.assertIn("anchors.right: parent.right", adult_qml)
        self.assertIn("fillMode: Image.PreserveAspectFit", adult_qml)
        self.assertIn("function selectCollectionRelative(offset)", adult_qml)
        self.assertIn("function navigateGrid(horizontal, vertical)", adult_qml)
        self.assertIn("function selectRelative(offset)", adult_qml)
        self.assertIn("function togglePause()", adult_qml)
        self.assertIn("function restartFilm()", adult_qml)
        self.assertIn("adultMode.restartFilm()", main_qml)
        self.assertIn("adultMode.togglePause()", main_qml)
        self.assertIn("adultMode.selectRelative(-1)", main_qml)
        self.assertIn('objectName: "mabeltvAdultMode"', adult_qml)
        self.assertIn('command == QStringLiteral("status")', application)

    def test_usb_playback_reuses_the_serialised_adult_decoder(self) -> None:
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")
        application = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )
        self.assertIn("function portalExternalPlayback", main_qml)
        self.assertIn("pendingExternalSource", main_qml)
        self.assertIn("function requestExternal", adult_qml)
        self.assertIn("onPlaybackStopped", adult_qml)
        self.assertIn("externalStartTimer.restart()", adult_qml)
        self.assertIn('QStringLiteral("play-external")', application)
        self.assertIn('path.startsWith(QStringLiteral(', application)
        self.assertIn('"/media/mabeltv-usb/"', application)

    def test_film_channels_get_a_skippable_countdown_before_starting(self) -> None:
        controller_header = (PROJECT_ROOT / "src" / "core" / "TvController.h").read_text(
            encoding="utf-8"
        )
        controller_source = (PROJECT_ROOT / "src" / "core" / "TvController.cpp").read_text(
            encoding="utf-8"
        )
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")

        self.assertIn("currentContentType", controller_header)
        self.assertIn("channel.contentType", controller_source)
        self.assertIn('tvController.currentContentType === "films"', main_qml)
        self.assertIn("function beginFilmCountdown", main_qml)
        self.assertIn("function finishFilmCountdown", main_qml)
        self.assertIn("PRESS OK TO SKIP", main_qml)
        self.assertIn("function cancelFilmCountdown", main_qml)
        self.assertIn("function onStopPlaybackRequested()", main_qml)
        self.assertIn("root.cancelFilmCountdown()", main_qml)

    def test_power_waits_for_adult_decoder_before_entering_standby(self) -> None:
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        self.assertIn('property string pendingPowerAction: ""', main_qml)
        self.assertIn("if (adultMode.active) {\n            adultMode.close()", main_qml)
        self.assertIn("root.performPowerOff()", main_qml)
        self.assertIn("tvController.turnOff()", main_qml)
        self.assertIn("if (root.pendingPowerAction.length > 0)", main_qml)
        self.assertNotIn("powerHoldTimer", main_qml)
        self.assertNotIn("requestSafeShutdown", main_qml)
        self.assertIn("if (overlay.closing)\n                overlay.finishClose()", adult_qml)

    def test_tv_power_uses_one_explicit_cec_layer_for_remote_and_portal(self) -> None:
        controller = (PROJECT_ROOT / "src" / "core" / "TvController.cpp").read_text(
            encoding="utf-8"
        )
        cec = (PROJECT_ROOT / "src" / "hardware" / "CecTvControl.cpp").read_text(
            encoding="utf-8"
        )
        portal = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.html").read_text(
            encoding="utf-8"
        )

        self.assertIn("m_tvControl->turnOn()", controller)
        self.assertIn("m_tvControl->turnOff()", controller)
        self.assertIn('QStringLiteral("on 0")', cec)
        self.assertIn('QStringLiteral("as")', cec)
        self.assertIn('QStringLiteral("standby 0")', cec)
        self.assertNotIn('QStringLiteral("toggle")', cec)
        self.assertIn("id=\"homePowerToggle\"", portal)
        self.assertIn("id=\"homeNowPlayingTitle\"", portal)
        self.assertIn("id=\"homeNowPlayingMeta\"", portal)
        self.assertNotIn("id=\"homeTurnOn\"", portal)
        self.assertNotIn("id=\"homeTurnOff\"", portal)
        self.assertIn("const command = turningOn ? 'turn-on' : 'turn-off'", portal)
        self.assertIn("state.programme || 'Current programme'", portal)
        self.assertIn("MabelTV is in standby", portal)
        self.assertIn("body: JSON.stringify({ command, ...extra })", portal)

    def test_portal_uses_shared_intro_and_sheet_design_tokens(self) -> None:
        portal = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.html").read_text(
            encoding="utf-8"
        )

        self.assertEqual(portal.count('class="home-greeting surface portal-intro"'), 1)
        self.assertEqual(portal.count('library-hero portal-intro'), 1)
        self.assertEqual(portal.count('adult-hero surface portal-intro'), 1)
        self.assertEqual(portal.count('watch-top portal-intro'), 1)
        self.assertEqual(portal.count('<header class="page-head portal-page-head'), 2)
        self.assertIn("--portal-intro-radius:20px", portal)
        self.assertIn("--portal-sheet-radius:22px", portal)
        self.assertIn(":is(.library-sheet,.remote-sheet,.watch-sheet)[open]", portal)
        self.assertIn(":is(.library-sheet-panel,.remote-sheet-panel,.watch-sheet-panel)", portal)
        self.assertNotIn("Everything Mabel can watch, organised by channel", portal)
        self.assertNotIn("Organise what appears on Adult TV", portal)
        self.assertNotIn("Pick up a film exactly where you left it", portal)
        self.assertIn("#view-adult .adult-film-list{grid-template-columns:repeat(3", portal)
        self.assertIn("#view-live .page{width:100%;padding-right:10px;padding-left:10px}", portal)

    def test_health_monitor_resets_for_every_playback_request(self) -> None:
        source = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn("activeVideo->playbackGeneration()", source)
        self.assertIn("activeGeneration != monitoredPlaybackGeneration", source)
        self.assertIn('status == QStringLiteral("Stopping")', source)
        self.assertIn("std::_Exit(exitCode)", source)

    def test_pi_service_bounds_decoder_allocator_arenas(self) -> None:
        service = (PROJECT_ROOT / "packaging" / "linux" / "mabeltv.service").read_text(
            encoding="utf-8"
        )

        self.assertIn("Environment=MALLOC_ARENA_MAX=2", service)
        self.assertIn("Environment=MALLOC_TRIM_THRESHOLD_=131072", service)

    def test_power_click_releases_hdmi_before_intro_audio_starts(self) -> None:
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")

        self.assertIn("function schedulePlaybackAfterPowerClick", main_qml)
        self.assertIn("id: playbackAfterPowerClickTimer", main_qml)
        self.assertIn("interval: tvController.soundEffectsEnabled ? 250 : 0", main_qml)
        self.assertIn("root.schedulePlaybackAfterPowerClick(true)", main_qml)
        self.assertIn("root.schedulePlaybackAfterPowerClick(false)", main_qml)

    def test_adult_transition_uses_one_renderer_and_preserves_film_position(self) -> None:
        main_qml = (PROJECT_ROOT / "qml" / "Main.qml").read_text(encoding="utf-8")
        adult_qml = (PROJECT_ROOT / "qml" / "AdultModeOverlay.qml").read_text(
            encoding="utf-8"
        )
        application = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn("visible: !adultMode.active", main_qml)
        self.assertIn("property bool openingAdultMode", main_qml)
        self.assertIn("openingAdultMode = true\n        player.stop()", main_qml)
        self.assertIn("onPlaybackStopped", main_qml)
        self.assertIn("if (root.openingAdultMode)", main_qml)
        self.assertIn("adultMode.open()", main_qml)
        self.assertIn("if (!adultMode.active && !root.openingAdultMode", main_qml)
        self.assertIn("if (adultMode.active)\n                adultMode.toggleSubtitles()", main_qml)
        self.assertIn("controller.adultPlaybackPosition(film.id)", adult_qml)
        self.assertIn("controller.setAdultPlaybackPosition(film.id", adult_qml)
        self.assertIn("id: adultPositionTimer", adult_qml)
        self.assertIn("rememberCurrentFilmPosition", adult_qml)
        self.assertIn("savedPosition", adult_qml)
        self.assertNotIn("HOLD MUTE  SUBTITLES", adult_qml)
        self.assertIn("id: playbackChoiceModal", adult_qml)
        self.assertIn("function confirmPlaybackChoice()", adult_qml)
        self.assertIn("id: filmProgressTrack", adult_qml)
        self.assertIn("controller.adultPlaybackDuration(modelData.id)", adult_qml)
        self.assertIn("Number(modelData.runtime || 0) * 60", adult_qml)
        self.assertIn("id: subtitleAction", adult_qml)
        self.assertIn("visible: overlay.scrubberActive && adultPlayer.subtitlesAvailable", adult_qml)
        self.assertIn("id: noSubtitlesMessage", adult_qml)
        self.assertIn("NO SUBTITLES AVAILABLE", adult_qml)
        self.assertIn("scrubberFocus === 1", adult_qml)
        self.assertIn("function openScrubber()", adult_qml)
        self.assertIn("function requestLibraryFilm(filePath)", adult_qml)
        self.assertIn("id: libraryFilmStartTimer", adult_qml)
        self.assertIn("if (playing && scrubberActive)", adult_qml)
        self.assertIn("!scrubberActive && (key === Qt.Key_Up || key === Qt.Key_Down)", adult_qml)
        self.assertIn("id: adultVolumeRail", adult_qml)
        self.assertNotIn("id: adultVolumeCard", adult_qml)
        self.assertNotIn("seek(300)", adult_qml)
        self.assertNotIn("seek(-300)", adult_qml)
        self.assertIn("interval: 3000", main_qml)
        self.assertNotIn("adultMode.active ? 700 : 3000", main_qml)
        self.assertIn("function portalPlayChannelProgramme(channel, file)", main_qml)
        self.assertIn("function portalPlayAdultFilm(file)", main_qml)
        self.assertIn("portalPlayChannelProgramme", application)
        self.assertIn("portalPlayAdultFilm", application)


if __name__ == "__main__":
    unittest.main()
