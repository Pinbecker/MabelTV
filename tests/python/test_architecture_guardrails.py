"""Ratcheted checks that keep MabelTV's refactored ownership boundaries intact."""

from __future__ import annotations

import ast
import json
import re
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = PROJECT_ROOT / "config/architecture-guardrails.json"
PORTAL_ROOT = PROJECT_ROOT / "scripts/pi/portal"
BACKEND_ROOT = PROJECT_ROOT / "scripts/pi/mabeltv_backend"
INCLUDE_PATTERN = re.compile(r"portal-include:([^\s]+)")


def relative(path: Path) -> str:
    return path.relative_to(PROJECT_ROOT).as_posix()


class ArchitectureGuardrailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    def test_every_owned_source_file_has_a_size_budget(self) -> None:
        self.assertEqual(self.config["schema_version"], 1)
        exclusions = tuple(self.config["excluded_paths"])
        budgets: dict[str, tuple[int, str]] = {}

        for rule in self.config["rules"]:
            self.assertTrue(rule["area"].strip())
            self.assertGreater(rule["max_lines"], 0)
            for pattern in rule["patterns"]:
                for path in PROJECT_ROOT.glob(pattern):
                    if not path.is_file():
                        continue
                    name = relative(path)
                    previous = budgets.get(name)
                    if previous is None or rule["max_lines"] < previous[0]:
                        budgets[name] = (rule["max_lines"], rule["area"])

        for exception in self.config["exceptions"]:
            self.assertTrue(exception["reason"].strip())
            self.assertTrue((PROJECT_ROOT / exception["path"]).is_file())
            budgets[exception["path"]] = (
                exception["max_lines"],
                f"exception: {exception['reason']}",
            )

        uncovered = []
        suffixes = set(self.config["source_suffixes"])
        for source_root in self.config["source_roots"]:
            for path in (PROJECT_ROOT / source_root).rglob("*"):
                if not path.is_file():
                    continue
                name = relative(path)
                if any(name == item or name.startswith(f"{item}/")
                       for item in exclusions):
                    continue
                is_script = path.suffix in suffixes
                if not is_script and path.suffix == "":
                    try:
                        is_script = path.read_bytes().startswith(b"#!")
                    except OSError:
                        is_script = False
                if is_script and name not in budgets:
                    uncovered.append(name)

        self.assertEqual(
            uncovered,
            [],
            "Source files without an architecture budget:\n" + "\n".join(uncovered),
        )

        oversized = []
        for name, (limit, area) in sorted(budgets.items()):
            line_count = len(
                (PROJECT_ROOT / name).read_text(
                    encoding="utf-8", errors="replace"
                ).splitlines()
            )
            if line_count > limit:
                oversized.append(
                    f"{name}: {line_count} lines exceeds {limit} ({area})"
                )
        self.assertEqual(
            oversized,
            [],
            "Split the owned responsibility instead of raising its budget:\n"
            + "\n".join(oversized),
        )

    def test_every_native_source_and_qml_component_is_registered(self) -> None:
        cmake = (PROJECT_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
        expected = sorted(
            list((PROJECT_ROOT / "src").rglob("*.cpp"))
            + list((PROJECT_ROOT / "src").rglob("*.h"))
            + list((PROJECT_ROOT / "qml").rglob("*.qml"))
        )
        missing = [relative(path) for path in expected if relative(path) not in cmake]
        self.assertEqual(missing, [], "Native files missing from CMakeLists.txt")

    def test_library_mixins_do_not_import_each_other(self) -> None:
        modules = {
            path.stem: ast.parse(path.read_text(encoding="utf-8"))
            for path in BACKEND_ROOT.glob("*.py")
            if path.name != "__init__.py"
        }
        mixins = {
            module
            for module, tree in modules.items()
            if any(
                isinstance(node, ast.ClassDef) and node.name.endswith("Mixin")
                for node in tree.body
            )
        }
        violations = []
        for module, tree in modules.items():
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or node.level != 1:
                    continue
                imported_module = (node.module or "").partition(".")[0]
                if imported_module in mixins:
                    violations.append(f"{module}.py imports {imported_module}.py")
        self.assertEqual(
            violations,
            [],
            "Library responsibilities communicate through the composed Library, "
            "not cross-imported mixins",
        )

        architecture = (
            PROJECT_ROOT / "docs/library-service-architecture.md"
        ).read_text(encoding="utf-8")
        undocumented = [
            f"{module}.py" for module in modules if f"`{module}.py`" not in architecture
        ]
        self.assertEqual(undocumented, [], "Undocumented Library backend modules")

    def test_every_portal_partial_is_reachable_from_an_entry_document(self) -> None:
        entry_documents = (
            PROJECT_ROOT / "scripts/pi/mabeltv-library.html",
            PROJECT_ROOT / "scripts/pi/mabeltv-library-classic.html",
        )
        visited: set[Path] = set()
        active: set[Path] = set()

        def visit(path: Path) -> None:
            self.assertNotIn(path, active, f"Recursive portal include: {relative(path)}")
            if path in visited:
                return
            self.assertTrue(path.is_file(), f"Missing portal include: {relative(path)}")
            active.add(path)
            for included in INCLUDE_PATTERN.findall(path.read_text(encoding="utf-8")):
                visit(PORTAL_ROOT / included)
            active.remove(path)
            visited.add(path)

        for entry_document in entry_documents:
            visit(entry_document)

        partials = set((PORTAL_ROOT / "html").rglob("*.html"))
        self.assertEqual(
            sorted(relative(path) for path in partials - visited),
            [],
            "Orphaned portal partials",
        )

    def test_every_portal_css_and_javascript_module_is_loaded(self) -> None:
        entries = "\n".join(
            (PROJECT_ROOT / name).read_text(encoding="utf-8")
            for name in (
                "scripts/pi/mabeltv-library.html",
                "scripts/pi/mabeltv-library-classic.html",
            )
        )
        referenced = set(re.findall(r"/portal/((?:css|js)/[^\"']+)", entries))
        assets = {
            path.relative_to(PORTAL_ROOT).as_posix()
            for folder, suffix in (("css", "*.css"), ("js", "*.js"))
            for path in (PORTAL_ROOT / folder).rglob(suffix)
        }
        self.assertEqual(sorted(assets - referenced), [], "Unloaded portal modules")

    def test_ai_instructions_cannot_quietly_weaken_the_guardrails(self) -> None:
        instructions = (PROJECT_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        required_contracts = (
            "The installed iOS PWA is the primary interface",
            "Do not raise a size budget, add an exception, weaken an assertion",
            "Keep `mabeltv-library.py` a thin compatibility/composition shell",
            "Keep `Main.qml` an application coordinator",
            "Keep `TvController.h` as the one stable QML-facing state machine",
            "Deployment requires explicit user authorization",
            "Do not commit or push unless the user asks",
            "a supposedly non-visual change alters a frozen screenshot",
        )
        for contract in required_contracts:
            self.assertIn(contract, instructions)


if __name__ == "__main__":
    unittest.main()
