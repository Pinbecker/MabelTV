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

    def test_visible_adult_player_is_inside_stall_monitor(self) -> None:
        source = (PROJECT_ROOT / "src" / "app" / "main.cpp").read_text(
            encoding="utf-8"
        )

        self.assertIn('QStringLiteral("mabeltvAdultPlayer")', source)
        self.assertIn("adultVideo->isVisible() ? adultVideo : video", source)


if __name__ == "__main__":
    unittest.main()
