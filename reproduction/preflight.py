"""Inspect selected Python inputs as data. Never import or run repository code."""
import ast
import configparser
import importlib.metadata
import importlib.util
import json
import os
import re
from pathlib import Path
import sys
import tomllib
from packaging.specifiers import SpecifierSet, InvalidSpecifier
from packaging.requirements import Requirement, InvalidRequirement


def inspect(workspace, plan):
    root = Path(workspace).resolve()
    checks = []
    seen_checks = set()
    visited = set()
    overlays = {step['path']: step.get('content', '') for step in plan['setup'] if step['type'] == 'create-file'}
    working = plan.get('workingDirectory', '.')
    prefix = '' if working == '.' else working.rstrip('/') + '/'
    installs = any('pip install ' in step.get('command', '') for step in plan['setup'])

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

    try:
        manifest_text = text(prefix+'pyproject.toml')
        manifest = tomllib.loads(manifest_text) if manifest_text else {}
        project = manifest.get('project', {})
        python_rule = project.get('requires-python')
        if python_rule:
            matches = SpecifierSet(python_rule).contains(runtime['python'], prereleases=True)
            add('project-python', 'pass' if matches else 'blocked', '项目Python要求', python_rule, prefix+'pyproject.toml', None if matches else '按项目声明选择兼容的Runner。')
        requirements = list(project.get('dependencies', []))
        for name, values in project.get('optional-dependencies', {}).items():
            if name in ('test', 'tests', 'testing', 'dev'):
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
        config = manifest.get('tool', {}).get('pytest', {})
        minimum = config.get('minversion') or config.get('ini_options', {}).get('minversion')
        if minimum and runtime['pytest']:
            matches = SpecifierSet('>='+str(minimum)).contains(runtime['pytest'])
            add('pytest-minimum', 'pass' if matches else 'warning' if installs else 'blocked', 'pytest配置的最低版本', str(minimum), prefix+'pyproject.toml', None if matches else '更新受支持Runner的pytest版本后再检查。')
        build = manifest.get('build-system', {})
        for requirement_text in build.get('requires', []):
            try:
                requirement = Requirement(requirement_text)
                installed = version(requirement.name)
                matches = bool(installed) and requirement.specifier.contains(installed, prereleases=True)
                add('build-'+requirement.name, 'pass' if matches else 'warning', '构建依赖 '+requirement.name, installed or '当前镜像未安装；直接从src导入不一定需要构建。', prefix+'pyproject.toml', None if matches else '本地包安装需要兼容构建后端；当前预检不安装依赖。')
            except InvalidRequirement:
                add('build-unknown', 'unknown', '构建依赖需核对', '无法解析构建声明。', prefix+'pyproject.toml')
    except (ValueError, tomllib.TOMLDecodeError):
        add('pyproject', 'unknown', '项目清单无法完整解析', '未据此推断依赖或版本满足。', prefix+'pyproject.toml')

    for filename, section in (('pytest.ini', 'pytest'), ('setup.cfg', 'tool:pytest'), ('tox.ini', 'pytest')):
        try:
            value = text(prefix+filename)
            if not value:
                continue
            config = configparser.ConfigParser(interpolation=None)
            config.read_string(value)
            minimum = config.get(section, 'minversion', fallback=None)
            if minimum and runtime['pytest']:
                matches = SpecifierSet('>='+minimum).contains(runtime['pytest'])
                add('pytest-minimum-'+filename, 'pass' if matches else 'warning' if installs else 'blocked', 'pytest配置的最低版本', minimum, prefix+filename, None if matches else '按项目配置准备兼容的pytest后再核对。')
        except (ValueError, configparser.Error):
            add('config-'+filename, 'unknown', '测试配置需核对', '未据此推断pytest版本满足。', prefix+filename)

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
        selectors = [token.split('::')[0] for token in command.split() if token.split('::')[0].endswith('.py')]
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
    return dict(status='blocked' if any(c['status']=='blocked' for c in checks) else 'review' if any(c['status'] in ('warning','unknown') for c in checks) else 'ready', runtime=runtime, checks=checks,
                limitations=['仅静态读取选定文件、祖先conftest和有限顶层导入；不执行仓库代码、不收集测试、不安装依赖。', '条件导入、动态插件、运行时服务及完整套件兼容性仍需实际验证。'])


if __name__ == '__main__':
    plan = json.loads(Path(os.environ['REPRO_PLAN']).read_text(encoding='utf-8'))
    print(json.dumps(inspect(os.environ['REPRO_WORKSPACE'], plan), ensure_ascii=False))
