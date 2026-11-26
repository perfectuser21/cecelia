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

test('Nightly快照回归使用与PR同版且支持方法压缩的真实PG服务', () => {
  const main = yaml.load(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
  const imageExpression = main.jobs.checks.services.postgres.image;
  const tags = [...imageExpression.matchAll(/mirror\.gcr\.io\/pgvector\/pgvector:pg(\d+)/g)];
  assert.equal(tags.length, 1, 'PR实际服务表达式必须包含唯一固定PG版本');
  const major = Number(tags[0][1]);
  // PG16起支持--compress=method[:detail]；生产helper真实传递gzip:1。
  assert.ok(major >= 16, '快照生产helper的方法压缩参数需要PG16或更新客户端');
  assert.equal(workflow().jobs['brain-integration'].services.postgres.image, tags[0][0],
    'Nightly绑定service内的pg_dump/pg_restore必须与已验证PR集成服务同版');
});

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
    writeFileSync(join(temp, 'company-key-results-smoke.sh'), `printf actual > '${marker}'\nprintf 'FAIL: T-2\\n'\nexit ${childExit}\n`);
    const result = spawnSync('bash', ['packages/brain/scripts/smoke-tools/run-smoke-ratchet.sh'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, HOME: temp, SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: '', BRAIN_URL: 'http://127.0.0.1:1' },
    });
    assert.equal(result.status, childExit === 0 ? 0 : 1, result.stdout + result.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'actual');
    assert.match(result.stdout, childExit === 0 ? /PASS: company-key-results-smoke\.sh/ : /BASELINE FAIL/);
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
      assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n'), failIndex === -1 ? ['0','1','2'] : ['0','1']);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
});

test('Nightly Commander真实PG审计先建独占scratch再传入其受保护URL，建库失败即停止', () => {
  const job = workflow().jobs['brain-integration'];
  const prepare = job.steps.find(s => s.name === 'Create isolated Commander audit database');
  const run = job.steps.find(s => s.name === 'Run full database regressions');
  assert.ok(prepare?.run, 'Commander PG审计缺少独占scratch准备');
  assert.ok(job.steps.indexOf(prepare) < job.steps.indexOf(run), '必须先建库再执行PG审计');
  const url = new URL(run.env.TEST_DB_URL);
  assert.equal(url.pathname, '/cecelia_scratch');
  assert.equal(url.hostname, job.env.DB_HOST);
  assert.equal(url.port, job.env.DB_PORT);
  assert.equal(prepare.env.PGPASSWORD, '${{ env.DB_PASSWORD }}');
  for (const failed of [false, true]) {
    const temp = mkdtempSync(join(tmpdir(), 'nightly-commander-db-'));
    try {
      const marker = join(temp, 'created');
      writeFileSync(join(temp, 'createdb'), `#!/bin/bash\n[ "$*" = '-h localhost -p 5432 -U cecelia cecelia_scratch' ] || exit 91\n[ "$PGPASSWORD" = isolated-ci ] || exit 92\n${failed ? 'exit 17' : `printf ready > '${marker}'`}\n`, {mode: 0o700});
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare.run], {
        cwd: temp, encoding: 'utf8', timeout: 10000,
        env: {...job.env, PATH: `${temp}:${process.env.PATH}`, PGPASSWORD: job.env.DB_PASSWORD},
      });
      assert.equal(result.status, failed ? 17 : 0, result.stdout + result.stderr);
      if (!failed) assert.equal(readFileSync(marker, 'utf8'), 'ready');
    } finally { rmSync(temp, {recursive: true, force: true}); }
  }
});
