import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = () => yaml.load(readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8'));

test('分类smoke诊断迁入现有Nightly且必须显式手动启用，独立PG和本地容器', () => {
  const doc = workflow(), job = doc.jobs['classified-smoke-diagnostics'];
  assert.ok(job, '缺少原分类smoke的明确诊断owner');
  assert.equal(doc.on.pull_request, undefined); assert.equal(doc.on.push, undefined);
  assert.equal(doc.on.workflow_dispatch.inputs.classified_smoke.type, 'boolean');
  assert.equal(doc.on.workflow_dispatch.inputs.classified_smoke.default, false);
  assert.equal(job.if, "github.event_name == 'workflow_dispatch' && inputs.classified_smoke == true");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.services.postgres.env.POSTGRES_DB, 'cecelia_test');
  assert.equal(job.env.DB_NAME, 'cecelia_test');
  assert.equal(job.env.BRAIN_URL, 'http://127.0.0.1:5521');
  assert.equal(job.env.BRAIN_CONTAINER, 'cecelia-brain-classified-smoke');
  assert.equal(job.steps.find(s => s.name === 'Cleanup classified smoke fixture').if, 'always()');
});

for (const childExit of [0, 17]) test(`Nightly的真实分类器命令执行私有脚本并保留失败：exit=${childExit}`, () => {
  const job = workflow().jobs['classified-smoke-diagnostics'];
  assert.ok(job, '缺少迁后的分类器job');
  const step = job.steps.find(s => s.name === 'Run classified Brain smoke diagnostics');
  assert.ok(step?.run);
  const temp = mkdtempSync(join(tmpdir(), 'nightly-classified-'));
  try {
    const marker = join(temp, 'executed');
    writeFileSync(join(temp, 'abilities-api-smoke.sh'), `printf actual > '${marker}'\nexit ${childExit}\n`);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, HOME: temp, SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: '', BRAIN_URL: 'http://127.0.0.1:1' },
    });
    assert.equal(result.status, childExit === 0 ? 0 : 1, result.stdout + result.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'actual');
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
