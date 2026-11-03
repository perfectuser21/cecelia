import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const yaml = createRequire(import.meta.url)('js-yaml');
const root = new URL('../../../', import.meta.url).pathname;
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8'));
function classify(event, path = 'apps/dashboard/src/main.tsx', { invalidBase = false, message = 'fix: candidate' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-lane-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-q'); git('config', 'core.hooksPath', '/dev/null'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(cwd, 'seed'), 'seed'); git('add', '.'); git('commit', '-qm', 'chore: seed');
    const before = git('rev-parse', 'HEAD');
    mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), 'candidate');
    git('add', '.'); git('commit', '-qm', message);
    const after = git('rev-parse', 'HEAD');
    const output = join(cwd, 'outputs'); writeFileSync(output, '');
    const values = { 'github.event_name': event, 'github.event.before': invalidBase ? 'missing-base' : before, 'github.event.after': after };
    const command = workflow.jobs.changes.steps.find(step => step.id === 'filter').run
      .replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => { assert.ok(key in values, key); return values[key]; });
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
      cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
for (const event of ['schedule', 'workflow_dispatch']) {
  test(`${event}全量候选缺少生产前驱差异时必须进入现有隔离Safe Lane`, () => {
    const output = classify(event);
    assert.equal(output.risk_level, 'high');
    assert.equal(output.brain, 'true'); assert.equal(output.workspace, 'true');
    assert.equal(workflow.jobs.staging_deploy.if, "needs.changes.outputs.risk_level == 'high'");
    assert.match(workflow.jobs.deploy.if, /risk_level == 'high' && needs.staging_deploy.result == 'success'/);
  });
}
test('实际迁移目录和隔离部署实现的已知差异必须分类为高风险', () => {
  for (const path of ['packages/brain/migrations/557_fixture.sql', 'scripts/lib/brain-staging.sh', 'scripts/brain-deploy.sh']) {
    assert.equal(classify('push', path).risk_level, 'high', path);
  }
});
test('不可读取前驱时不能用最近一次commit的小差异误判为安全', () => {
  assert.equal(classify('push', 'apps/dashboard/src/main.tsx', { invalidBase: true }).risk_level, 'high');
});
test('已知低风险差异及既有SAFE-DEPLOY显式紧急边界保持', () => {
  assert.equal(classify('push').risk_level, 'low');
  assert.equal(classify('push', 'packages/brain/src/tick.js', { message: 'fix: emergency [SAFE-DEPLOY]' }).risk_level, 'low');
  assert.equal(classify('push', 'apps/dashboard/src/main.tsx', { invalidBase: true, message: 'fix: [SAFE-DEPLOY]' }).risk_level, 'high');
});
