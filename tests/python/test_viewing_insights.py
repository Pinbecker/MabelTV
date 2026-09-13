from __future__ import annotations

import time
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from scripts.pi.mabeltv_backend.viewing_analytics import (
    date_window,
    diary_payload,
    overview_payload,
    range_window,
)


class ViewingAnalyticsTests(unittest.TestCase):
    @staticmethod
    def epoch(value: str) -> float:
        return datetime.fromisoformat(value).timestamp()

    def test_cross_midnight_session_is_allocated_to_both_calendar_days(self) -> None:
        session = {
            "id": "cross-midnight", "viewing_item_id": "channel:1",
            "kind": "channel", "title": "Stories", "seconds": 1200,
            "started": self.epoch("2026-09-12T22:50:00+00:00"),
            "ended": self.epoch("2026-09-12T23:10:00+00:00"),
        }
        first = diary_payload([session], {}, "2026-09-12", -60,
                              self.epoch("2026-09-13T12:00:00+01:00"),
                              "Europe/London")
        second = diary_payload([session], {}, "2026-09-13", -60,
                               self.epoch("2026-09-13T12:00:00+01:00"),
                               "Europe/London")
        self.assertEqual(sum(value["seconds"] for value in first["periods"]), 600)
        self.assertEqual(sum(value["seconds"] for value in second["periods"]), 600)

    def test_historical_dst_day_uses_named_zone_boundaries(self) -> None:
        try:
            ZoneInfo("Europe/London")
        except ZoneInfoNotFoundError:
            self.skipTest("system time-zone database is unavailable")
        now = self.epoch("2026-03-29T12:00:00+01:00")
        window = date_window("2026-03-29", 0, now, "Europe/London")
        self.assertEqual(window["end"] - window["start"], 23 * 3600)
        dashboard = range_window(1, 0, now, "Europe/London")
        self.assertEqual(dashboard["start"], window["start"])

    def test_overview_counts_both_active_days_for_cross_boundary_viewing(self) -> None:
        now = self.epoch("2026-09-13T12:00:00+01:00")
        session = {
            "id": "cross-midnight", "viewing_item_id": "channel:1",
            "kind": "channel", "title": "Stories", "seconds": 1200,
            "started": self.epoch("2026-09-12T22:50:00+00:00"),
            "ended": self.epoch("2026-09-12T23:10:00+00:00"),
        }
        result = overview_payload([session], now - 86400, 7, -60, now,
                                  "Europe/London")
        self.assertEqual(result["summary"]["active_days"], 2)
        self.assertEqual(result["summary"]["range_seconds"], 1200)

    def test_empty_period_has_no_invented_favourite(self) -> None:
        result = overview_payload([], time.time(), 7, 0, time.time(), "UTC")
        self.assertEqual(result["summary"]["busiest_period"], "—")
        self.assertEqual(result["summary"]["busiest_weekday"], "—")


if __name__ == "__main__":
    unittest.main()
