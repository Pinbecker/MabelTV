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

        self.assertIn('text: "Your private film library"', adult_qml)
        self.assertIn("id: featurePanel", adult_qml)
        self.assertIn("id: filmStrip", adult_qml)
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
        self.assertIn("root.performPowerOff(action === \"shutdown\")", main_qml)
        self.assertIn("if (root.pendingPowerAction.length > 0)", main_qml)
        self.assertIn("if (overlay.closing)\n                overlay.finishClose()", adult_qml)

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

        self.assertIn("visible: !adultMode.active", main_qml)
        self.assertIn("property bool openingAdultMode", main_qml)
        self.assertIn("openingAdultMode = true\n        player.stop()", main_qml)
        self.assertIn("onPlaybackStopped", main_qml)
        self.assertIn("if (root.openingAdultMode)", main_qml)
        self.assertIn("adultMode.open()", main_qml)
        self.assertIn("if (!adultMode.active && !root.openingAdultMode", main_qml)
        self.assertIn("if (adultMode.active)\n                adultMode.toggleSubtitles()", main_qml)
        self.assertIn("property var filmPositions", adult_qml)
        self.assertIn("rememberCurrentFilmPosition", adult_qml)
        self.assertIn("savedPosition", adult_qml)
        self.assertIn("HOLD MUTE subtitles", adult_qml)


if __name__ == "__main__":
    unittest.main()
