/** Explicit public historical-case preparation. No repository code runs on the host. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

async function main() {
  const repoUrl = 'https://github.com/pallets/itsdangerous', sha = 'd101100c395958d67368b8c37d95a9c404598c2e';
  const sourceDir = resolve('data/acceptance-itsdangerous-source'); mkdirSync(resolve('data'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!existsSync(sourceDir)) git('clone', '--depth', '1', '--branch', '2.0.0', `${repoUrl}.git`, sourceDir);
  if (git('-C', sourceDir, 'rev-parse', 'HEAD') !== sha) throw new Error('Existing case source has a different commit; it was not overwritten.');
  const response = await fetch('https://api.github.com/repos/pallets/itsdangerous/issues/237', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Public historical issue could not be read.');
  const raw = await response.json(); writeFileSync('data/acceptance-itsdangerous-issue.json', JSON.stringify(raw, null, 2));
  const before = readFileSync(join(sourceDir, 'src/itsdangerous/signer.py'), 'utf8');
  const needle = '        self.salt: bytes = want_bytes(salt)';
  if (before.split(needle).length !== 2) throw new Error('Historical source does not match the reviewed replacement.');
  const after = before.replace(needle, '        if salt is None:\n            salt = b"itsdangerous.Signer"\n' + needle);
  const tests = `from itsdangerous import Serializer, Signer, BadSignature
import pytest

def test_none_salt():
    try:
        serializer = Serializer('secret-key', salt=None)
        token = serializer.dumps([1, 2, 3, 4])
    except TypeError as error:
        pytest.fail('SALT_NONE_COMPAT: ' + str(error))
    assert token == '[1, 2, 3, 4].d6HwOZMIWe0UH9BUzXfN7AiMWXk', 'SALT_NONE_COMPAT'
    assert serializer.loads(token) == [1, 2, 3, 4]
    assert Signer('secret-key', salt=None).salt == b'itsdangerous.Signer'

def test_normal_salts():
    for salt in [b'namespace', b'', b'itsdangerous']:
        serializer = Serializer('secret-key', salt=salt)
        token = serializer.dumps({'v': 42})
        assert serializer.loads(token) == {'v': 42}
        with pytest.raises(BadSignature):
            serializer.loads(token + 'tampered')
`;
  const command = 'python3 -m pytest acceptance/test_history.py::test_none_salt -q';
  const quote = 'Calling `Serializer` in 1.1.0  with a salt set to `None` used to work fine:';
  if (!raw.body.includes(quote)) throw new Error('Historical quote changed; review before repeating.');
  const item = { number: 237, body: raw.body, updatedAt: raw.updated_at };
  const patch = { id: 'historical-manual-reference', kind: 'patch', title: 'Reviewed compatibility candidate', createdAt: new Date().toISOString(), evidenceIds: [], files: [
    { path: 'src/itsdangerous/signer.py', before, after, created: false }, { path: 'acceptance/test_history.py', before: '', after: tests, created: true },
  ] };
  const plan = { mode: 'test', confidence: 'high', summary: 'Historical #237 fixed snapshot', environment: { language: 'Python', dependencies: [] }, setup: [], steps: [{ type: 'run-test', command }, { type: 'run-test', command: 'python3 -m pytest acceptance/test_history.py::test_normal_salts -q' }, { type: 'run-test', command: 'python3 -m pytest tests/test_itsdangerous/test_signer.py tests/test_itsdangerous/test_serializer.py tests/test_itsdangerous/test_encoding.py -q' }], oracle: { type: 'all-steps-pass', value: '0' }, expected: 'Selected compatibility and regression tests pass', evidence: ['stdout', 'stderr', 'test-result'], risks: [], missingInformation: [], requiresHumanApproval: true };
  const manifest = { name: 'itsdangerous-237-scoped', repoUrl, branch: '2.0.0', expected: 'improved', sourceDir, task: { id: 'historical-237', kind: 'issue', commitSha: sha, sourceUpdatedAt: item.updatedAt }, item, patch, plan, requirements: [{ text: 'Restore None salt compatibility', quote, command, failureSignal: 'SALT_NONE_COMPAT', changedPaths: ['src/itsdangerous/signer.py'] }] };
  writeFileSync('data/acceptance-history-scoped.json', JSON.stringify(manifest, null, 2));
  const full = structuredClone(manifest); full.name = 'itsdangerous-237-full-suite'; full.expected = 'blocked'; full.plan.steps[2].command = 'python3 -m pytest tests -q';
  writeFileSync('data/acceptance-history-full.json', JSON.stringify(full, null, 2));
  console.log(`Public case prepared at ${sha}. Candidate is manually reviewed, not Agent-generated. License stays in ${sourceDir}/LICENSE.rst.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Case preparation failed'); process.exitCode = 1; });
