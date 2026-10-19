"""Inspect selected Python inputs as data. Never import or run repository code."""
import ast
import configparser
import importlib.metadata
import importlib.util
import json
import os
import re
import shlex
from pathlib import Path
import sys
import tomllib
from packaging.specifiers import SpecifierSet, InvalidSpecifier
from packaging.requirements import Requirement, InvalidRequirement


def inspect(workspace, plan):
    root = Path(workspace).resolve()
    checks = []
    preparation_options = []
    seen_checks = set()
    visited = set()
    overlays = {step['path']: step.get('content', '') for step in plan['setup'] if step['type'] == 'create-file'}
    working = plan.get('workingDirectory', '.')
    prefix = '' if working == '.' else working.rstrip('/') + '/'
    installs = any('pip install ' in step.get('command', '') for step in plan['setup'])
    project_installs = [step['command'] for step in plan['setup'] if re.search(r'--no-build-isolation\s+[\"\']?\.(?:\[|[\"\']?$)', step.get('command', ''))]
    requested_extras = set()
    requested_groups = [shlex.split(step['command'])[-1] for step in plan['setup'] if 'pip install ' in step.get('command', '') and ' --group ' in step['command']]
    pytest_commands = []
    for step in plan['steps']:
        tokens = shlex.split(step.get('command', ''))
        if tokens and (tokens[0] == 'pytest' or tokens[:3] in (['python', '-m', 'pytest'], ['python3', '-m', 'pytest'])):
            pytest_commands.append(tokens)
    for command in project_installs:
        target = shlex.split(command)[-1]
        if target.startswith('.['):
            requested_extras.update(target[2:-1].split(','))

    def add(identity, status, title, detail, path=None, remedy=None):
        if identity in seen_checks:
            return
        if len(checks) >= 79:
            if 'check-budget' not in seen_checks:
                seen_checks.add('check-budget')
                checks.append(dict(id='check-budget', status='unknown', title='检查条目达到上限', detail='后续条件未完整记录，不能据此判断全部满足。'))
            return
        seen_checks.add(identity)
        checks.append({k: v for k, v in dict(id=identity, status=status, title=title, detail=detail, path=path, remedy=remedy).items() if v is not None})

    def text(path):
        # Planned writes are inspected virtually, without applying the patch.
        candidate = root / path
        if not candidate.resolve().is_relative_to(root) or any(part == '..' for part in Path(path).parts):
            raise ValueError('Path escapes the snapshot')
        current = root
        for part in Path(path).parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('Symlink is outside static inspection scope')
        if path in overlays:
            value = overlays[path]
        elif candidate.is_file() and candidate.stat().st_size <= 120000:
            value = candidate.read_text(encoding='utf-8')
        else:
            return None
        if len(value.encode('utf-8')) > 120000:
            return None
        if '\0' in value or re.search(r'(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)', value):
            raise ValueError('Binary or possible credential data is outside inspection scope')
        return value

    def version(name):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return None

    runtime = {'python': sys.version.split()[0], 'pytest': version('pytest')}
    add('python', 'pass', 'Runner Python', runtime['python'])
    add('pytest', 'pass' if runtime['pytest'] else 'blocked', 'Runner pytest', runtime['pytest'] or '镜像没有pytest', remedy=None if runtime['pytest'] else '使用包含pytest的受支持Runner镜像。')
    requested = plan.get('environment', {}).get('version', '')
    if requested:
        try:
            rule = SpecifierSet(requested if requested[0] in '<>=!~' else '=='+requested+'.*')
            matches = rule.contains(runtime['python'], prereleases=True)
            add('requested-python', 'pass' if matches else 'blocked', '计划要求的Python版本', requested, remedy=None if matches else '选择满足已审阅版本要求的Runner，再重新预检。')
        except InvalidSpecifier:
            add('requested-python', 'unknown', '计划版本要求需核对', requested)

    manifest = {}
    try:
        manifest_text = text(prefix+'pyproject.toml')
        manifest = tomllib.loads(manifest_text) if manifest_text else {}
        project = manifest.get('project', {})
        extras = project.get('optional-dependencies', {})
        groups = manifest.get('dependency-groups', {})
        # Offer only declarations; pip and a fresh preflight still validate a selected plan.
        if not prefix:
            pip = 'python3 -m pip install --target .repocare-python --no-compile '
            for name in ['requirements-dev.txt', 'requirements-test.txt', 'requirements.txt']:
                if text(name) is not None:
                    preparation_options.append(dict(id='requirements:'+name, path=name, command=pip+'-r '+name))
            if project or manifest.get('build-system'):
                preparation_options.append(dict(id='project', path='pyproject.toml', command=pip+'--no-build-isolation .'))
            for kind, values, suffix in [('group', groups, '--group '), ('extra', extras, '--no-build-isolation .[')]:
                if not isinstance(values, dict):
                    continue
                for name in sorted(values)[:8]:
                    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,39}', name) and isinstance(values[name], list):
                        preparation_options.append(dict(id=kind+':'+name, path='pyproject.toml', command=pip+suffix+name+(']' if kind == 'extra' else '')))
        for group in requested_groups:
            add('group-'+group, 'pass' if group in groups else 'blocked', '项目依赖组 '+group, '已读取根目录pyproject.toml声明；具体解析和安装仍由pip完成。' if group in groups else '根目录清单没有声明此依赖组。', prefix+'pyproject.toml')
        for extra in sorted(requested_extras):
            known = extra in extras
            dynamic = not project or 'optional-dependencies' in project.get('dynamic', [])
            add('extra-'+extra, 'pass' if known else 'unknown' if dynamic else 'blocked', '项目扩展 '+extra, '读取项目声明；依赖实际安装仍需审阅并执行准备步骤。' if known else '当前静态清单不能确认该扩展存在。', prefix+'pyproject.toml', None if known else '核对扩展名称；不能把pip忽略未知扩展的警告当成安装成功。')
        python_rule = project.get('requires-python')
        if python_rule:
            matches = SpecifierSet(python_rule).contains(runtime['python'], prereleases=True)
            add('project-python', 'pass' if matches else 'blocked', '项目Python要求', python_rule, prefix+'pyproject.toml', None if matches else '按项目声明选择兼容的Runner。')
        requirements = list(project.get('dependencies', []))
        for group in requested_groups:
            for dependency in groups.get(group, []):
                if isinstance(dependency, str):
                    requirements.append(dependency)
                else:
                    add('group-include-'+group, 'unknown', '依赖组包含其他组', '静态检查不展开继承组；pip准备阶段仍需解析并记录真实结果。', prefix+'pyproject.toml')
        for name, values in extras.items():
            if name in ('test', 'tests', 'testing', 'dev') or name in requested_extras:
                requirements.extend(values)
        for requirement_text in requirements:
            try:
                requirement = Requirement(requirement_text)
                if requirement.name.lower() != 'pytest' or (requirement.marker and not requirement.marker.evaluate()):
                    continue
                matches = bool(runtime['pytest']) and requirement.specifier.contains(runtime['pytest'], prereleases=True)
                add('project-pytest', 'pass' if matches else 'warning' if installs else 'blocked', '项目声明的pytest要求', str(requirement), prefix+'pyproject.toml', None if matches else '使用符合项目声明的pytest；依赖准备后的实际版本仍需核对。')
            except InvalidRequirement:
                add('project-requirement', 'unknown', '依赖声明未解析', '需人工核对项目测试依赖。', prefix+'pyproject.toml')
        build = manifest.get('build-system', {})
        for requirement_text in build.get('requires', []):
            try:
                requirement = Requirement(requirement_text)
                if requirement.marker and not requirement.marker.evaluate():
                    continue
                installed = version(requirement.name)
                matches = bool(installed) and requirement.specifier.contains(installed, prereleases=True)
                add('build-'+requirement.name, 'pass' if matches else 'blocked' if project_installs else 'warning', '构建依赖 '+requirement.name, installed or '当前镜像未安装；直接从src导入不一定需要构建。', prefix+'pyproject.toml', None if matches else '本地包安装需要兼容构建后端；当前预检不安装依赖。')
            except InvalidRequirement:
                add('build-unknown', 'unknown', '构建依赖需核对', '无法解析构建声明。', prefix+'pyproject.toml')
    except (ValueError, tomllib.TOMLDecodeError):
        add('pyproject', 'unknown', '项目清单无法完整解析', '未据此推断依赖或版本满足。', prefix+'pyproject.toml')

    def pytest_config(tokens):
        explicit = next((tokens[i+1] for i, value in enumerate(tokens[:-1]) if value == '-c'), None)
        explicit = explicit or next((value[2:] for value in tokens if value.startswith('-c') and len(value) > 2), None)
        names = [explicit] if explicit else ['pytest.toml', '.pytest.toml', 'pytest.ini', '.pytest.ini', 'pyproject.toml', 'tox.ini', 'setup.cfg']
        for filename in names:
            path = prefix+filename
            try:
                value = text(path)
                if value is None:
                    if explicit:
                        add('config-'+path, 'unknown', '指定的测试配置不可读', '不能推断配置选项或插件满足。', path)
                    continue
                if filename.endswith('.toml'):
                    data = tomllib.loads(value)
                    config = data.get('tool', {}).get('pytest') if Path(filename).name == 'pyproject.toml' else data.get('pytest', {})
                    if config is None and not explicit:
                        continue
                    config = config or {}
                    if not isinstance(config, dict):
                        raise ValueError('Invalid pytest settings')
                    config = config.get('ini_options', config)
                else:
                    parser = configparser.ConfigParser(interpolation=None)
                    parser.read_string(value)
                    section = 'tool:pytest' if filename.endswith('setup.cfg') else 'pytest'
                    if not parser.has_section(section) and filename not in ('pytest.ini', '.pytest.ini') and not explicit:
                        continue
                    config = dict(parser.items(section)) if parser.has_section(section) else {}
                if not isinstance(config, dict):
                    raise ValueError('Invalid pytest settings')
                return path, config
            except (ValueError, configparser.Error, OSError, UnicodeError):
                add('config-'+path, 'unknown', '测试配置需核对', '配置未完整读取，不回退到低优先级配置或推断插件满足。', path)
                return path, {}
        return None, {}

    legacy = manifest.get('tool', {}).get('poetry', {}).get('dev-dependencies', {})
    if pytest_commands:
        if isinstance(legacy, dict) and legacy:
            names = sorted(name for name in legacy if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', name))[:20]
            add('poetry-dev-dependencies', 'unknown', '旧Poetry开发依赖需单独准备', '声明包含 '+', '.join(names)+'；根项目安装不等于安装这些开发依赖。当前不转换Poetry版本约束或自动安装此表。', prefix+'pyproject.toml', '提供已审阅的受支持requirements、项目扩展、标准依赖组，或使用已具备所需插件的Runner。')
    cov_options = {'--cov', '--cov-report', '--cov-config', '--cov-fail-under', '--cov-append', '--cov-branch', '--cov-context', '--cov-reset', '--no-cov', '--no-cov-on-fail'}
    for tokens in pytest_commands:
        path, config = pytest_config(tokens)
        try:
            minimum = config.get('minversion')
            if minimum and runtime['pytest']:
                matches = SpecifierSet('>='+str(minimum)).contains(runtime['pytest'])
                add('pytest-minimum-'+str(path), 'pass' if matches else 'warning' if installs else 'blocked', 'pytest配置的最低版本', str(minimum), path, None if matches else '按生效配置准备兼容的pytest后再核对。')
            options = config.get('addopts', [])
            options = shlex.split(options) if isinstance(options, str) else options
            if not isinstance(options, list) or any(not isinstance(value, str) for value in options):
                raise ValueError('Invalid addopts')
            if any(value in ('-o', '--override-ini') or value.startswith(('--override-ini=', '-oaddopts=')) for value in tokens):
                add('pytest-override-'+str(path), 'unknown', '命令覆盖pytest配置需核对', '静态检查不合并命令覆盖，不据此推断插件满足。', path)
                continue
            options = options+tokens
            required = config.get('required_plugins', [])
            required = shlex.split(required) if isinstance(required, str) else required
            if not isinstance(required, list) or any(not isinstance(value, str) for value in required):
                raise ValueError('Invalid required_plugins')
            if len(required) > 12:
                add('pytest-required-limit', 'unknown', '插件声明达到检查上限', '仅检查前十二项声明。', path)
            requirements = [Requirement(value) for value in required[:12]]
            needs_cov = any(value.split('=', 1)[0] in cov_options for value in options)
            if needs_cov and not any(re.sub(r'[-_.]+', '-', req.name).lower() == 'pytest-cov' for req in requirements):
                requirements.append(Requirement('pytest-cov'))
            plugins = [options[i+1] for i, value in enumerate(options[:-1]) if value == '-p']
            for requirement in requirements:
                if requirement.marker and not requirement.marker.evaluate():
                    continue
                name = re.sub(r'[-_.]+', '-', requirement.name).lower()
                installed = version(requirement.name)
                matches = bool(installed) and requirement.specifier.contains(installed, prereleases=True)
                disabled = name == 'pytest-cov' and (any(value in ('no:cov', 'no:pytest_cov') for value in plugins) or bool(os.environ.get('PYTEST_DISABLE_PLUGIN_AUTOLOAD')) and not any(value in ('cov', 'pytest_cov', 'pytest_cov.plugin') for value in plugins))
                install_steps = [step for step in plan['setup'] if 'pip install ' in step.get('command', '')]
                root_only = bool(install_steps) and len(install_steps) == len(project_installs) and not requested_extras
                legacy_names = {re.sub(r'[-_.]+', '-', key).lower() for key in legacy} if isinstance(legacy, dict) else set()
                main_names = {re.sub(r'[-_.]+', '-', key).lower() for key in manifest.get('tool', {}).get('poetry', {}).get('dependencies', {})}
                for dependency in manifest.get('project', {}).get('dependencies', []):
                    try:
                        main_names.add(re.sub(r'[-_.]+', '-', Requirement(dependency).name).lower())
                    except InvalidRequirement:
                        pass
                unprepared_legacy = root_only and name in legacy_names and name not in main_names
                status = 'blocked' if disabled else 'pass' if matches else 'warning' if installs and not unprepared_legacy else 'blocked'
                detail = '插件被命令或Runner自动加载设置禁用。' if disabled else '发行包 '+installed+' 已安装；未实际加载插件或收集测试。' if matches else '当前镜像没有满足要求的 '+str(requirement)+'；覆盖率参数需要pytest-cov插件。' if name == 'pytest-cov' else '当前镜像没有满足要求的 '+str(requirement)+'。'
                add('pytest-plugin-'+name+'-'+str(path), status, 'pytest插件 '+name, detail, path, None if status == 'pass' else '按固定源码声明审阅依赖准备；根项目安装不会自动安装开发依赖，不能通过删除配置参数消除缺口。')
        except (ValueError, InvalidRequirement, InvalidSpecifier):
            add('pytest-options-'+str(path), 'unknown', 'pytest选项或插件声明需核对', '没有加载插件或执行项目代码，不能证明配置可用。', path)

    def local_module(module):
        relative = module.replace('.', '/')
        for base in (prefix+'src/', prefix):
            for suffix in ('.py', '/__init__.py'):
                path = base+relative+suffix
                if text(path) is not None:
                    return path
        return None

    def scan(path):
        if path in visited:
            return
        if len(visited) >= 120:
            add('scan-budget', 'unknown', '静态检查达到范围上限', '剩余导入尚未检查。')
            return
        visited.add(path)
        try:
            source = text(path)
            if source is None:
                add('missing-'+path, 'blocked', '选定测试文件不可读', '固定快照及候选写入中没有可读文件。', path, '核对测试路径或重新准备候选。')
                return
            parsed = ast.parse(source)
        except (SyntaxError, ValueError, UnicodeError, OSError):
            add('parse-'+path, 'blocked', '源码或路径无法静态读取', '检查语法、大小、编码和符号链接；没有运行该文件。', path)
            return
        for node in parsed.body:
            # Only unconditional module-level imports. Dynamic/conditional imports
            # remain a documented unknown, rather than a false missing dependency.
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    directory = Path(path).parent
                    for _ in range(node.level-1):
                        directory = directory.parent
                    relative = directory / ((node.module or '').replace('.', '/'))
                    targets = [str(relative)+'.py', str(relative/'__init__.py')]
                    target = next((candidate for candidate in targets if text(candidate) is not None), None)
                    if target:
                        scan(target)
                    else:
                        add('relative-'+path+'-'+str(node.lineno), 'unknown', '本地相对导入需核对', '可能涉及生成模块、扩展或动态注入，静态检查不能证明可导入。', path)
                    continue
                modules = [node.module] if node.module else []
            else:
                continue
            for module in modules:
                target = local_module(module)
                top = module.split('.')[0]
                package = local_module(top)
                if package and package != target:
                    scan(package)
                if target:
                    scan(target)
                elif top not in sys.stdlib_module_names and importlib.util.find_spec(top) is None:
                    add('import-'+top+'-'+path, 'warning' if installs else 'blocked', '导入依赖 '+top, '选定文件的顶层导入在当前镜像中不可用。', path, '依据固定仓库声明准备依赖，或明确调整验证范围；不禁用原配置。')
        add('parsed-'+path, 'pass', '已静态读取', '仅语法和顶层导入检查，不等同于测试收集或执行通过。', path)

    for step in plan['steps']:
        command = step.get('command', '')
        selectors = [token.split('::')[0] for token in shlex.split(command) if token.split('::')[0].endswith('.py')]
        if not selectors:
            add('selector-'+str(len(checks)), 'unknown', '命令未指定单个测试文件', '目录或模块形式的完整收集不在本次静态扫描范围。')
        for selector in selectors:
            path = prefix+selector.removeprefix('./')
            scan(path)
            parent = Path(path).parent
            while str(parent) != '.':
                conftest = str(parent/'conftest.py')
                if text(conftest) is not None:
                    scan(conftest)
                parent = parent.parent
            root_conftest = prefix+'conftest.py'
            if text(root_conftest) is not None:
                scan(root_conftest)
    return dict(status='blocked' if any(c['status']=='blocked' for c in checks) else 'review' if any(c['status'] in ('warning','unknown') for c in checks) else 'ready', runtime=runtime, checks=checks, preparationOptions=preparation_options,
                limitations=['仅静态读取选定文件、祖先conftest和有限顶层导入；不执行仓库代码、不收集测试、不安装依赖。', '插件检查覆盖required_plugins发行包要求及已知pytest-cov参数；不执行插件，条件导入、自定义插件、运行时服务及完整套件兼容性仍需实际验证。'])


if __name__ == '__main__':
    plan = json.loads(Path(os.environ['REPRO_PLAN']).read_text(encoding='utf-8'))
    print(json.dumps(inspect(os.environ['REPRO_WORKSPACE'], plan), ensure_ascii=False))
