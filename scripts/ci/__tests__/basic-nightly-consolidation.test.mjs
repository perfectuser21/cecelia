import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { smokeCiFailures } from '../../../packages/brain/scripts/coding-workflow/lib/qa-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = () => yaml.load(readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8'));

test('分类smoke工作流入口退役，现役Nightly仅保留两类真实测试与失败告警', () => {
  const doc = workflow();
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['brain-integration', 'open-issue-on-failure', 'real-env-smoke']);
  assert.equal(doc.on.pull_request, undefined); assert.equal(doc.on.push, undefined);
  assert.equal(doc.on.workflow_dispatch?.inputs, undefined);
  assert.equal(doc.jobs['brain-integration'].env.SMOKE_ALLOW_WRITE, undefined);
  assert.equal(doc.jobs['real-env-smoke'].services.postgres.env.POSTGRES_DB, 'cecelia_test');
  assert.deepEqual(doc.jobs['open-issue-on-failure'].needs, ['brain-integration', 'real-env-smoke']);
});

for (const childExit of [0, 17]) test(`保留的真实分类器CLI执行私有脚本并保留失败：exit=${childExit}`, () => {
  const temp = mkdtempSync(join(tmpdir(), 'nightly-classified-'));
  try {
    const marker = join(temp, 'executed');
    writeFileSync(join(temp, 'abilities-api-smoke.sh'), `printf actual > '${marker}'\nprintf 'FAIL: T-2\\n'\nexit ${childExit}\n`);
    const result = spawnSync('bash', ['packages/brain/scripts/smoke-tools/run-smoke-ratchet.sh'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, HOME: temp, SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: '', BRAIN_URL: 'http://127.0.0.1:1' },
    });
    assert.equal(result.status, childExit === 0 ? 0 : 1, result.stdout + result.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'actual');
    assert.deepEqual(smokeCiFailures(result.stdout, 'abilities-api-smoke.sh'),
      childExit === 0 ? { failed: false, ids: [] } : { failed: true, ids: ['T-2'] });
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Nightly迁后的launcher脚本编排真执行、失败停止，不读宿主HOME', () => {
  const job = workflow().jobs['brain-integration'];
  const step = job.steps.find(s => s.name === 'Run isolated launcher and utility regressions');
  assert.ok(step?.run, '有效shell fixture尚未接入Nightly');
  const paths = [
    'tests/regression/codex-grok-launcher-supervisor/install-launchers.test.sh',
    'tests/regression/codex-grok-launcher-supervisor/codex-launch.test.sh',
    'tests/regression/codex-grok-launcher-supervisor/grok-launch.test.sh',
    'scripts/smoke/e2e/headed-r7.sh',
  ];
  for (const path of paths) assert.ok(readFileSync(join(root, path)).length);
  for (const failIndex of [-1, 1]) {
    const temp = mkdtempSync(join(tmpdir(), 'nightly-launchers-'));
    try {
      const marker = join(temp, 'executed');
      for (const [index, path] of paths.entries()) {
        mkdirSync(dirname(join(temp, path)), { recursive: true });
        writeFileSync(join(temp, path), `printf '%s\\n' '${index}' >> '${marker}'\n[ "$HOME" != '${temp}' ] || exit 91\nexit ${index === failIndex ? 17 : 0}\n`);
      }
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        cwd: temp, encoding: 'utf8', timeout: 10000,
        env: { PATH: process.env.PATH, HOME: temp, RUNNER_TEMP: temp },
      });
      assert.equal(result.status, failIndex === -1 ? 0 : 17, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n'), failIndex === -1 ? ['0','1','2','3'] : ['0','1']);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
});
