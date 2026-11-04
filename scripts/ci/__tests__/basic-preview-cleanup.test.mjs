import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const yaml = createRequire(import.meta.url)('js-yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/preview-cleanup.yml'), 'utf8'));
const steps = workflow.jobs.preview_cleanup.steps;
const command = steps.find(step => step.id === 'brain_stop').run;

async function fixture(t, status, body) {
  const dir = mkdtempSync(join(tmpdir(), 'preview-cleanup-ci-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization });
    res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 302 ? { Location: '/redirected' } : {}) });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { dir, requests, server, url: `http://127.0.0.1:${server.address().port}` };
}

function run(f) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', command], {
      cwd: root,
      env: { ...process.env, BRAIN_URL: f.url, DEPLOY_TOKEN: 'isolated-fixture-token', PR_NUMBER: '999999', GITHUB_OUTPUT: join(f.dir, 'output') },
    });
    let out = '';
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => out += b);
    child.on('error', reject);
    child.on('close', status => {
      let output = '';
      try { output = readFileSync(join(f.dir, 'output'), 'utf8'); } catch (err) { if (err.code !== 'ENOENT') return reject(err); }
      resolve({ status, out, output });
    });
  });
}

for (const [name, status, body, success] of [
  ['实际销毁终态', 200, { stopped: true, status: 'inactive', cleanup_detail: null }, true],
  ['无记录幂等', 200, { stopped: true, note: 'no active preview found' }, true],
  ['HTTP200业务失败', 200, { stopped: false, status: 'cleanup_failed', cleanup_detail: { residual: ['db_still_exists'] } }, false],
  ['矛盾终态', 200, { stopped: true, status: 'cleanup_failed' }, false],
  ['未知终态', 200, { stopped: true, status: 'stopped' }, false],
  ['缺失终态', 200, { stopped: true }, false],
  ['字符串布尔值', 200, { stopped: 'true', status: 'inactive' }, false],
  ['缺失确认', 200, { status: 'inactive' }, false],
  ['无效JSON', 200, 'not-json', false],
  ['JSON空值', 200, 'null', false],
  ['HTTP302不得跟随', 302, { stopped: true, status: 'inactive' }, false],
  ['HTTP401', 401, { stopped: true, status: 'inactive' }, false],
  ['HTTP500', 500, { stopped: true, status: 'inactive' }, false],
]) test(`真实清理步骤：${name}`, { timeout: 10000 }, async t => {
  const f = await fixture(t, status, body);
  const result = await run(f);
  assert.equal(result.status === 0, success, result.out);
  assert.equal(result.output.includes('success=true'), success, result.output);
  assert.deepEqual(f.requests, [{ method: 'POST', path: '/api/brain/preview/stop/999999', auth: 'Bearer isolated-fixture-token' }]);
});

test('真实清理步骤：连接失败不得写成功', { timeout: 10000 }, async t => {
  const f = await fixture(t, 200, {});
  await new Promise(resolve => f.server.close(resolve));
  const result = await run(f);
  assert.notEqual(result.status, 0, result.out);
  assert.doesNotMatch(result.output, /success=true/);
});

test('评论区分确认成功与未确认，不把所有失败归为不可达', () => {
  const success = steps.find(step => step.if?.includes("outputs.success == 'true'"));
  assert.ok(success);
  assert.match(success.with.script, /无需清理|无需回收/);
  const failure = steps.find(step => step.if?.includes("brain_stop.outcome == 'failure'"));
  assert.ok(failure.if.includes('always()'));
  assert.match(failure.with.script, /未确认/);
  assert.doesNotMatch(failure.with.script, /Brain 不可达|预览资源尚未回收|将由宿主/);
});
