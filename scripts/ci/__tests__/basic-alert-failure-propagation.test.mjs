import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
const yaml = createRequire(import.meta.url)('js-yaml');
const root = new URL('../../../', import.meta.url).pathname;
const load = name => yaml.load(readFileSync(join(root, '.github/workflows', name), 'utf8'));
const red = load('ci-red-alert.yml');
const sentinel = load('heartbeat-sentinel.yml');
function fixture(t, commands = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-alert-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, script] of Object.entries(commands)) {
    writeFileSync(join(dir, name), `#!/bin/bash\n${script}\n`); chmodSync(join(dir, name), 0o755);
  }
  return { dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary') } };
}
function run(command, env, cwd = root) {
  return new Promise(resolve => {
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', command], { cwd, env });
    let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
    child.on('close', status => resolve({ status, out }));
  });
}
async function server(t, handler) {
  const instance = createServer(handler); await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}
for (const failure of ['workflow-list', 'workflow-runs']) test(`扫描 ${failure} API 故障拒绝零红灯成功`, async t => {
  const f = fixture(t, { gh: failure === 'workflow-list' ? 'exit 22' : 'case "$*" in *actions/workflows/1/runs*) exit 22;; *) printf "1\\tBroken\\tbroken.yml\\n";; esac' });
  const result = await run(red.jobs.scan.steps.find(s => s.id === 'scan').run, { ...f.env, WATCH_REPOS: 'fixture/repo', CONSECUTIVE_N: '3', RECENT_DAYS: '7' });
  assert.notEqual(result.status, 0, result.out);
  assert.doesNotMatch(result.out, /共发现 0|无连续/);
});
for (const scenario of ['list-500', 'list-302', 'create-500', 'create-302', 'create-no-receipt', 'notify-500', 'notify-302', 'notify-unsent', 'success', 'duplicate']) test(`红灯真实 HTTP ${scenario}`, async t => {
  let creates = 0; let notifications = 0;
  const url = await server(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      res.statusCode = scenario === 'list-500' ? 500 : scenario === 'list-302' ? 302 : 200;
      return res.end(JSON.stringify({ issues: scenario === 'duplicate' ? [{ id: 'existing', title: '[CI红灯] fixture/repo｜Broken 连续3次失败' }] : [] }));
    }
    if (req.url.endsWith('/notify')) {
      notifications++; res.statusCode = scenario === 'notify-500' ? 500 : scenario === 'notify-302' ? 302 : 200;
      return res.end(JSON.stringify({ ok: true, sent: scenario !== 'notify-unsent' }));
    }
    creates++; res.statusCode = scenario === 'create-500' ? 500 : scenario === 'create-302' ? 302 : 201;
    res.end(JSON.stringify(scenario === 'create-no-receipt' ? {} : { id: '4ef251d2-d573-493d-aecc-5eb172c24afc', title: '[CI红灯] fixture/repo｜Broken 连续3次失败' }));
  });
  const f = fixture(t); const alerts = join(f.dir, 'alerts.txt');
  writeFileSync(alerts, 'fixture/repo\tBroken\tbroken.yml\n');
  // 执行真实 workflow step，仅将跨步骤中间文件定向到本例隔离目录。
  const step = red.jobs.scan.steps.find(s => s.name.startsWith('开 Brain issue'));
  const result = await run(step.run.replaceAll('/tmp/alerts.txt', alerts), { ...f.env, BRAIN_URL: url });
  assert.equal(result.status === 0, ['success', 'duplicate'].includes(scenario), result.out);
  if (scenario.startsWith('create-')) assert.equal(creates, 1, result.out);
  if (scenario.startsWith('notify-')) { assert.equal(creates, 1, result.out); assert.equal(notifications, 1, result.out); }
  if (scenario.startsWith('create-') || scenario.startsWith('list-')) {
    assert.doesNotMatch(result.out, /新开 issue：1/); assert.equal(notifications, 0);
  }
  if (scenario.startsWith('list-') || scenario === 'duplicate') assert.equal(creates, 0);
  if (scenario === 'success') { assert.equal(creates, 1); assert.equal(notifications, 1); assert.match(result.out, /新开 issue：1/); }
});
function condition(expression, probe) {
  return Function('needs', 'always', `return (${expression})`)({ probe }, () => true);
}
for (const result of ['failure', 'cancelled', 'skipped']) test(`哨兵控制面 ${result} 且无输出仍走告警`, () => {
  assert.equal(condition(sentinel.jobs.alert.if, { result, outputs: {} }), true);
  assert.equal(condition(sentinel.jobs['close-on-success'].if, { result, outputs: {} }), false);
});
test('哨兵成功必须有双份绿色证据，缺失输出触发告警', () => {
  assert.equal(condition(sentinel.jobs.alert.if, { result: 'success', outputs: { health_ok: 'true' } }), true);
  assert.equal(condition(sentinel.jobs.alert.if, { result: 'success', outputs: { health_ok: 'true', kv_ok: 'true' } }), false);
});
test('哨兵 Issue 故障保留失败并仍执行 Bark', async t => {
  const f = fixture(t, { gh: 'exit 22' });
  const job = sentinel.jobs.alert;
  const result = await run(job.steps[0].run, { ...f.env, REPO: 'fixture/repo', ISSUE_TITLE_PREFIX: '[heartbeat-sentinel]', ISSUE_LABEL: 'heartbeat-sentinel', HEALTH_OK: '', KV_OK: '', KV_AGE: '', PROBE_URL: '', RUN_URL: 'fixture' });
  assert.notEqual(result.status, 0, result.out);
  assert.equal(job.steps[1].if, 'always()', 'Issue 失败后仍须执行独立通知步骤');
});
