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

    def test_python_classes_do_not_shadow_their_own_methods(self) -> None:
        violations = []
        for path in [PROJECT_ROOT / "scripts/pi/mabeltv-library.py",
                     *BACKEND_ROOT.glob("*.py")]:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for klass in (node for node in ast.walk(tree)
                          if isinstance(node, ast.ClassDef)):
                names = [node.name for node in klass.body
                         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
                duplicates = sorted({name for name in names if names.count(name) > 1})
                for name in duplicates:
                    violations.append(f"{relative(path)}:{klass.name}.{name}")
        self.assertEqual(violations, [], "A later method silently shadows an earlier one")

    def test_native_runtime_has_no_retired_json_authority(self) -> None:
        sources = "\n".join(
            path.read_text(encoding="utf-8", errors="replace")
            for path in (PROJECT_ROOT / "src").rglob("*")
            if path.suffix in {".cpp", ".h"}
            and path.name != "media-check.cpp"
        )
        for retired in (".mabeltv-channels.json", ".mabeltv-adult.json",
                        "m_channelsPath", "m_settingsPath", "m_statePath"):
            self.assertNotIn(retired, sources)
        launcher = (PROJECT_ROOT / "scripts/pi/mabeltv-launch.sh").read_text(
            encoding="utf-8")
        for option in ("--channels", "--settings", "--state"):
            self.assertNotIn(option, launcher)
        self.assertIn('--database "$database_path"', launcher)

    def test_every_portal_partial_is_reachable_from_an_entry_document(self) -> None:
        entry_documents = (PROJECT_ROOT / "scripts/pi/mabeltv-library.html",)
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
        documents = [PROJECT_ROOT / "scripts/pi/mabeltv-library.html"]
        documents.extend((PORTAL_ROOT / "html").rglob("*.html"))
        entries = "\n".join(
            path.read_text(encoding="utf-8") for path in documents
        )
        referenced = set(re.findall(r"/portal/((?:css|js)/[^\"']+)", entries))
        portal_owner = ast.parse(
            (BACKEND_ROOT / "portal.py").read_text(encoding="utf-8")
        )
        app_sources = next(
            ast.literal_eval(node.value)
            for node in portal_owner.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name)
                    and target.id == "PORTAL_APP_SOURCES" for target in node.targets)
        )
        referenced.update(f"js/{name}" for name in app_sources)
        assets = {
            path.relative_to(PORTAL_ROOT).as_posix()
            for folder, suffix in (("css", "*.css"), ("js", "*.js"))
            for path in (PORTAL_ROOT / folder).rglob(suffix)
        }
        self.assertEqual(sorted(assets - referenced), [], "Unloaded portal modules")

    def test_portal_bundle_does_not_restore_internal_window_bridges(self) -> None:
        source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (PORTAL_ROOT / "js").rglob("*.js")
        )
        internal_names = (
            "attemptPortalReconnect", "openPrimarySection", "navigateDomainRoute",
            "loadAdultHome", "bindUpNextReorder", "openInsightsRoute",
            "openAdultInsightsRoute", "closeAdultInsightsRoute",
            "setMyInsightsMode", "loadMyInsights", "renderLgTvPowerState",
            "startLgTvRemote", "stopLgTvRemote", "MabelPortalLibrary", "liveHls",
        )
        for name in internal_names:
            self.assertNotRegex(source, rf"window\.{name}\b")

    def test_ai_instructions_cannot_quietly_weaken_the_guardrails(self) -> None:
        instructions = " ".join(
            (PROJECT_ROOT / "AGENTS.md").read_text(encoding="utf-8").split()
        )
        required_contracts = (
            "The installed iOS PWA is the primary portal",
            "mabeltv.db` is the sole authority",
            "Do not raise a limit, add an exception, weaken an assertion",
            "Keep `mabeltv-library.py` a thin composition shell",
            "`Main.qml` an application coordinator",
            "`TvController.h` the single QML-facing state machine",
            "This is a phone-first project",
            "mabeltv-512.local",
            "Do not commit or push unless asked",
            "update a screenshot merely to pass a gate",
        )
        for contract in required_contracts:
            self.assertIn(contract, instructions)

    def test_linux_entrypoints_have_lf_line_endings(self) -> None:
        attributes = (PROJECT_ROOT / ".gitattributes").read_text(encoding="utf-8")
        for pattern in ("*.sh text eol=lf", "*.py text eol=lf",
                        "*.mjs text eol=lf"):
            self.assertIn(pattern, attributes)

        violations = []
        for source_root in ("scripts", "packaging", "integrations"):
            for path in (PROJECT_ROOT / source_root).rglob("*"):
                if not path.is_file():
                    continue
                data = path.read_bytes()
                if data.startswith(b"#!") and b"\r\n" in data:
                    violations.append(relative(path))
        self.assertEqual(
            violations,
            [],
            "Linux entrypoints must survive a Windows-built release archive:\n"
            + "\n".join(violations),
        )

    def test_owner_operations_use_the_authoritative_database(self) -> None:
        recovery = (PROJECT_ROOT / "packaging/linux/mabeltv-owner-recovery").read_text(
            encoding="utf-8")
        doctor = (PROJECT_ROOT / "scripts/pi/doctor.sh").read_text(encoding="utf-8")
        installer = (PROJECT_ROOT / "scripts/pi/install.sh").read_text(encoding="utf-8")
        self.assertIn('runuser --user mabeltv -- "$state_tool" reset-owner', recovery)
        self.assertNotIn("mv /var/lib/mabeltv/owner.json", recovery)
        self.assertIn("mabeltv-state-migrate owner-status", doctor)
        self.assertIn('mabeltv-state-migrate" owner-status', installer)
        self.assertIn("owner_status != 3", doctor)
        self.assertIn("owner_status == 3", installer)


if __name__ == "__main__":
    unittest.main()
