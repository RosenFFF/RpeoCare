"""Read distribution metadata only; never import project packages."""
import importlib.metadata as metadata
import json
import sys

target = sorted((item.metadata.get('Name', '')[:200], item.version[:200]) for item in metadata.distributions(path=[sys.argv[1]]))
tools = {}
for name in ('pip', 'pytest', 'setuptools', 'wheel', 'hatchling', 'hatch-vcs'):
    try:
        tools[name] = metadata.version(name)
    except metadata.PackageNotFoundError:
        tools[name] = 'unavailable'
effective = dict(tools)
for name, version in target:
    normalized = name.lower().replace('_', '-')
    if normalized in effective:
        effective[normalized] = version
print(json.dumps({'python': sys.version.split()[0], 'bundledTools': tools, 'effectiveToolDistributions': effective, 'targetDependencies': target[:300], 'truncated': len(target) > 300}, sort_keys=True))
