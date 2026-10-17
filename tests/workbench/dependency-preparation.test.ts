import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandTokens, dependencyCommand } from '../../reproduction/commands.mjs';
import { validateReproductionPlan } from '../../src/server/reproduction/plan';

const prefix = 'python3 -m pip install --target .repocare-python --no-compile ';
test('Python dependency inputs are bounded to root manifests, extras or one declared group', () => {
  for (const tail of ['-r requirements.txt', '--no-build-isolation .', '--no-build-isolation .[test]', '--no-build-isolation .[test,dev,docs]', '--group test']) {
    assert.ok(dependencyCommand(prefix + tail));
    assert.ok(commandTokens(prefix + tail).length > 3);
  }
});
test('Python dependency preparation cannot select host paths, URLs, extra flags or unbounded extras', () => {
  for (const tail of ['--group ../secret', '--group /tmp/file:test', '--group test --index-url https://bad.example', '--group test other', '--no-build-isolation .[a,b,c,d]', '--no-build-isolation ./other[test]', '--no-build-isolation .[test] --editable .', '-r requirements.txt --trusted-host bad.example', 'https://bad.example/pkg.whl', '--target /tmp/escape .']) {
    assert.throws(() => commandTokens(prefix + tail));
  }
});
test('dependency groups and extras remain setup-only and require the existing explicit plan confirmation', () => {
  const plan = { mode: 'test', confidence: 'medium', summary: 'Run reviewed tests', environment: { language: 'Python', dependencies: [] }, setup: [], steps: [{ type: 'run-test', command: prefix + '--group test' }], oracle: { type: 'all-steps-pass', value: 'pass' }, expected: 'Pass', evidence: ['stdout'], risks: [], missingInformation: [], requiresHumanApproval: true };
  assert.throws(() => validateReproductionPlan(plan), /setup/);
  assert.equal(validateReproductionPlan({ ...plan, setup: plan.steps, steps: [{ type: 'run-test', command: 'python3 -m pytest test_value.py -q' }] }).setup.length, 1);
});
