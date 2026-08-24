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

    def test_pi4_tries_both_h264_and_hevc_hardware_decoders(self) -> None:
        launcher = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-launch.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn('MABELTV_HWDEC="v4l2m2m-copy,drm-copy"', launcher)

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

        self.assertIn("void requestAdultModeShortcut();", controller_header)
        self.assertIn("Adult mode requested from parent-access shortcut", controller_source)
        self.assertIn("Q_PROPERTY(bool subtitlesVisible", player_header)
        self.assertIn("Q_INVOKABLE void toggleSubtitles();", player_header)
        self.assertIn('"sub-auto",', player_source)
        self.assertIn("subtitleDefaultOn: true", adult_qml)
        self.assertIn("adultPlayer.toggleSubtitles()", adult_qml)

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


if __name__ == "__main__":
    unittest.main()
