import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const script = new URL('../check-nightly-green.sh', import.meta.url).pathname;
for (const [name, time, pass] of [
  ['缺失', null, false], ['空值', '', false], ['损坏', 'invalid', false],
  ['无时区', '2026-11-03T00:00:00', false], ['未来', '2999-01-01T00:00:00Z', false],
  ['近期成功允许最新红灯', new Date(Date.now() - 3600000).toISOString(), true],
  ['过期', '2020-01-01T00:00:00Z', false],
]) test(`nightly ${name}的真实脚本判定`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-nightly-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const response = { total_count: 2, workflow_runs: [{ id: 2, conclusion: 'failure' }, { id: 1, conclusion: 'success', updated_at: time, head_sha: 'abcdef123', html_url: 'https://example.invalid/run/1' }] };
  writeFileSync(join(dir, 'response'), JSON.stringify(response));
  writeFileSync(join(dir, 'curl'), '#!/bin/bash\ncat "$FIXTURE_RESPONSE"\nprintf \"\\n200\"\n'); chmodSync(join(dir, 'curl'), 0o755);
  const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_RESPONSE: join(dir, 'response'), GITHUB_TOKEN: 'isolated-fixture', GITHUB_REPOSITORY: 'fixture/repo', WINDOW_HOURS: '72', BYPASS_NIGHTLY_GATE: '', GITHUB_STEP_SUMMARY: join(dir, 'summary') } });
  assert.equal(result.status === 0, pass, result.stdout + result.stderr);
  if (!pass) assert.doesNotMatch(result.stdout, /Release Gate 通过/);
});
