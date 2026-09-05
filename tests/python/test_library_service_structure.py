"""Structural guardrails for the split local library service."""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENTRY_POINT = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.py"
BACKEND = ENTRY_POINT.parent / "mabeltv_backend"


class LibraryServiceStructureTests(unittest.TestCase):
    def test_entry_point_stays_a_small_compatibility_shell(self) -> None:
        source = ENTRY_POINT.read_text(encoding="utf-8")
        tree = ast.parse(source)
        library = next(node for node in tree.body
                       if isinstance(node, ast.ClassDef) and node.name == "Library")
        methods = [node.name for node in library.body
                   if isinstance(node, ast.FunctionDef)]
        self.assertEqual(methods, ["__init__", "close", "_open_url"])
        self.assertLessEqual(len(source.splitlines()), 600)

    def test_backend_responsibilities_are_explicit_and_bounded(self) -> None:
        expected = {
            "auth.py", "constants.py", "http.py", "lg.py", "media.py",
            "portal.py", "providers.py", "remote.py", "system.py",
            "uploads.py", "usb.py", "viewing.py",
        }
        self.assertTrue(expected.issubset({path.name for path in BACKEND.glob("*.py")}))
        for path in BACKEND.glob("*.py"):
            self.assertLessEqual(
                len(path.read_text(encoding="utf-8").splitlines()),
                1600,
                f"{path.name} has grown beyond one focused responsibility",
            )

    def test_http_entry_methods_delegate_to_named_routes(self) -> None:
        source = (BACKEND / "http.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        assignments = {
            target.id
            for node in tree.body if isinstance(node, ast.Assign)
            for target in node.targets if isinstance(target, ast.Name)
        }
        self.assertTrue({
            "GET_JSON_ROUTES", "POST_JSON_ROUTES", "POST_NO_ARGUMENT_ROUTES",
        }.issubset(assignments))
        handler = next(node for node in tree.body
                       if isinstance(node, ast.ClassDef) and node.name == "Handler")
        methods = {node.name: node for node in handler.body
                   if isinstance(node, ast.FunctionDef)}
        self.assertLessEqual(methods["do_GET"].end_lineno - methods["do_GET"].lineno, 120)
        self.assertLessEqual(methods["do_POST"].end_lineno - methods["do_POST"].lineno, 70)

    def test_installers_ship_the_entry_point_and_package_together(self) -> None:
        install = (PROJECT_ROOT / "scripts" / "pi" / "install.sh").read_text(
            encoding="utf-8")
        deploy = (PROJECT_ROOT / "scripts" / "windows" /
                  "deploy-dev-to-pi.ps1").read_text(encoding="utf-8")
        for source in (install, deploy):
            self.assertIn("mabeltv_backend", source)
            self.assertIn("mabeltv-library-classic.html", source)


if __name__ == "__main__":
    unittest.main()
