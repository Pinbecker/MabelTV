from __future__ import annotations

import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
QML_ROOT = PROJECT_ROOT / "qml"


class NativeIconTests(unittest.TestCase):
    def test_parent_dashboard_uses_the_shared_vector_icon_component(self) -> None:
        dashboard = (QML_ROOT / "ParentDashboardView.qml").read_text(
            encoding="utf-8")
        coordinator = (QML_ROOT / "ModernParentOverlay.qml").read_text(
            encoding="utf-8")
        icon = (QML_ROOT / "SignalIcon.qml").read_text(encoding="utf-8")
        cmake = (PROJECT_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")

        self.assertGreaterEqual(dashboard.count("SignalIcon {"), 6)
        self.assertIn("function pageIconName(value)", coordinator)
        self.assertIn("PathSvg { path: iconRoot.pathData }", icon)
        self.assertIn("qml/SignalIcon.qml", cmake)

    def test_parent_control_icons_do_not_depend_on_font_glyphs(self) -> None:
        sources = "\n".join(
            (QML_ROOT / name).read_text(encoding="utf-8")
            for name in ("ModernParentOverlay.qml", "ParentDashboardView.qml")
        )

        for glyph in ("⌂", "◫", "≡", "⚙", "✓", "‹", "›", "◉", "⊘"):
            self.assertNotIn(glyph, sources)


if __name__ == "__main__":
    unittest.main()
