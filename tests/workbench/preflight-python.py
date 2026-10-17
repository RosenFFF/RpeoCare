"""Opt-in container checks for the trusted static inspector, with synthetic data."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('preflight', '/opt/repocare/preflight.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreflightTests(unittest.TestCase):
    def check_plan(self, files, test='test_value.py', setup=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, text in files.items():
                path = root/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding='utf-8')
            report = module.inspect(root, {'environment': {'language': 'Python'}, 'setup': setup or [], 'steps': [{'type': 'run-test', 'command': 'python3 -m pytest '+test+'::test_value -q'}]})
            self.assertFalse((root/'EXECUTED').exists())
            return report

    def test_never_executes_repository_or_test_code(self):
        report = self.check_plan({'test_value.py': 'from pathlib import Path\nPath("EXECUTED").write_text("bad")\ndef test_value(): pass\n'})
        self.assertEqual(report['status'], 'ready')

    def test_ancestor_conftest_dependency_is_found(self):
        report = self.check_plan({'tests/conftest.py': 'import repocare_missing_dependency\n', 'tests/test_value.py': 'def test_value(): pass\n'}, 'tests/test_value.py')
        self.assertEqual(report['status'], 'blocked')
        self.assertTrue(any(check.get('path') == 'tests/conftest.py' and check['status'] == 'blocked' for check in report['checks']))

    def test_root_test_does_not_collect_sibling_conftest(self):
        report = self.check_plan({'tests/conftest.py': 'import repocare_missing_dependency\n', 'test_value.py': 'def test_value(): pass\n'})
        self.assertEqual(report['status'], 'ready')

    def test_declared_pytest_and_python_versions_are_checked(self):
        report = self.check_plan({'pyproject.toml': '[project]\nrequires-python=">=99"\n[project.optional-dependencies]\ntests=["pytest>=999"]\n', 'test_value.py': 'def test_value(): pass\n'})
        self.assertEqual(report['status'], 'blocked')
        self.assertEqual(len([check for check in report['checks'] if check['id'] in ('project-python', 'project-pytest') and check['status']=='blocked']), 2)

    def test_candidate_tests_are_read_virtually(self):
        report = self.check_plan({}, setup=[{'type': 'create-file', 'path': 'test_value.py', 'content': 'import repocare_missing_dependency\n'}])
        self.assertEqual(report['status'], 'blocked')

    def test_src_import_is_discovered_without_importing_package(self):
        report = self.check_plan({'src/value/__init__.py': 'open("EXECUTED", "w").write("bad")\n', 'test_value.py': 'import value\ndef test_value(): pass\n'})
        self.assertEqual(report['status'], 'ready')

    def test_missing_build_backend_is_a_scoped_warning_for_src_tests(self):
        report = self.check_plan({'pyproject.toml': '[build-system]\nrequires=["repocare-missing-build-backend"]\nbuild-backend="missing.build"\n', 'test_value.py': 'def test_value(): pass\n'})
        self.assertEqual(report['status'], 'review')

    def test_directory_only_selection_remains_unknown(self):
        report = self.check_plan({}, test='tests')
        self.assertEqual(report['status'], 'review')

    def test_ini_minimum_is_checked_without_interpolation(self):
        for name, section in (('pytest.ini', 'pytest'), ('setup.cfg', 'tool:pytest'), ('tox.ini', 'pytest')):
            with self.subTest(name=name):
                report = self.check_plan({name: '['+section+']\nminversion=999\nlog_format=%(message)s\n', 'test_value.py': 'def test_value(): pass\n'})
                self.assertEqual(report['status'], 'blocked')

    def test_unreadable_or_invalid_test_does_not_report_ready(self):
        for source in ('def invalid(:', '\0binary', 'token="'+'sk-'+'x'*25+'"'):
            with self.subTest(source=source[:10]):
                report = self.check_plan({'test_value.py': source})
                self.assertEqual(report['status'], 'blocked')

    def test_dependency_preparation_does_not_claim_installed(self):
        report = self.check_plan({'test_value.py': 'import repocare_missing_dependency\n'}, setup=[{'type': 'run-command', 'command': 'python3 -m pip install --target .repocare-python --no-compile -r requirements.txt'}])
        self.assertEqual(report['status'], 'review')
        self.assertTrue(any(check['status']=='warning' and 'repocare_missing_dependency' in check['title'] for check in report['checks']))

    def test_check_limit_cannot_silently_report_ready(self):
        files = {'test_value.py': '\n'.join('import local'+str(i) for i in range(90))}
        files.update({'local'+str(i)+'.py': 'VALUE=1\n' for i in range(90)})
        report = self.check_plan(files)
        self.assertLessEqual(len(report['checks']), 80)
        self.assertEqual(report['status'], 'review')
        self.assertTrue(any(check['id']=='check-budget' for check in report['checks']))

    def test_missing_backend_blocks_a_project_install(self):
        report = self.check_plan({'pyproject.toml': '[build-system]\nrequires=["repocare-missing-backend"]\n', 'test_value.py': 'def test_value(): pass\n'}, setup=[{'type': 'run-command', 'command': 'python3 -m pip install --target .repocare-python --no-compile --no-build-isolation .'}])
        self.assertEqual(report['status'], 'blocked')

    def test_project_extra_requires_actual_declaration(self):
        for name, status in (('test', 'ready'), ('typo', 'blocked')):
            report = self.check_plan({'pyproject.toml': '[project]\nname="local"\n[project.optional-dependencies]\ntest=[]\n', 'test_value.py': 'def test_value(): pass\n'}, setup=[{'type': 'run-command', 'command': 'python3 -m pip install --target .repocare-python --no-compile --no-build-isolation .['+name+']'}])
            self.assertEqual(report['status'], status)

    def test_declared_group_is_read_without_installing(self):
        files = {'pyproject.toml': '[dependency-groups]\ntest=["pytest>=999"]\n', 'test_value.py': 'def test_value(): pass\n'}
        report = self.check_plan(files, setup=[{'type': 'run-command', 'command': 'python3 -m pip install --target .repocare-python --no-compile --group test'}])
        self.assertEqual(report['status'], 'review')
        self.assertTrue(any(check['id']=='project-pytest' and check['status']=='warning' for check in report['checks']))
        report = self.check_plan(files, setup=[{'type': 'run-command', 'command': 'python3 -m pip install --target .repocare-python --no-compile --group typo'}])
        self.assertEqual(report['status'], 'blocked')


unittest.main()
