import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import yaml from 'js-yaml';

const root = new URL('../../../', import.meta.url).pathname;
const doc = name => yaml.load(readFileSync(join(root, '.github/workflows', name), 'utf8'));
const sha = 'a'.repeat(40);
async function fixture(handler, callback) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(handler(req, body)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`, requests); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function shell(command, env = {}) {
  return new Promise(resolve => {
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', command], {
      cwd: root, env: { PATH: process.env.PATH, ...env },
    });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('Preview workflow 绑定PR真实head并缺少secret时失败', async () => {
  const job = doc('preview-deploy.yml').jobs.preview_deploy;
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with?.ref, '${{ github.event.pull_request.head.sha }}');
  for (const name of ['触发 preview-env-start（Brain API）', '健康检查预览 Brain']) {
    assert.equal(job.steps.find(step => step.name === name).env.EXPECTED_SHA, '${{ github.event.pull_request.head.sha }}');
  }
  const step = job.steps.find(step => step.id === 'check_ts');
  const result = await shell(step.run, { SECRET_TS: '', DEPLOY_TOKEN: '', GITHUB_OUTPUT: '/dev/null' });
  assert.notEqual(result.code, 0, result.output);
});

test('Preview start HTTP请求携带固定SHA并安全编码分支', async () => {
  await fixture(() => ({ port: 5311, db_name: 'cecelia_preview_42', status: 'starting' }), async (url, requests) => {
    const branch = 'feature/quote"branch';
    const result = await shell('bash scripts/request-preview-start.sh', {
      BRAIN_URL: url, DEPLOY_TOKEN: 'fixture-token', PR_NUMBER: '42', BRANCH_NAME: branch, EXPECTED_SHA: sha,
      PREVIEW_START_MAX_ATTEMPTS: '1',
    });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(JSON.parse(requests[0].body), { pr_number: 42, branch_name: branch, expected_sha: sha });
    assert.equal(requests[0].authorization, 'Bearer fixture-token');
  });
});

for (const mismatch of [null, 'git_sha', 'db_name', 'pr_number', 'tick_enabled']) {
  test(`Preview健康步骤实读实例身份并拒绝错配：${mismatch ?? '匹配'}`, async () => {
    const step = doc('preview-deploy.yml').jobs.preview_deploy.steps.find(step => step.id === 'healthcheck');
    const identity = { git_sha: sha, db_name: 'cecelia_preview_42', pr_number: 42, tick_enabled: false };
    if (mismatch) identity[mismatch] = mismatch === 'tick_enabled' ? true : 'wrong';
    await fixture(req => req.url.endsWith('/identity') ? identity : { status: 'running' }, async (url, requests) => {
      const result = await shell(step.run, { PREVIEW_URL: url, EXPECTED_SHA: sha, EXPECTED_DB_NAME: 'cecelia_preview_42', PR_NUMBER: '42', GITHUB_OUTPUT: '/dev/null' });
      assert.equal(result.code === 0, mismatch === null, result.output);
      assert.ok(requests.some(req => req.url.endsWith('/identity')), '健康步骤没有请求运行实例身份');
    });
  });
}

test('Standalone staging workflow真执行请求并按request/SHA/镜像隔离回执验收', async () => {
  const steps = doc('auto-staging-deploy.yml').jobs.staging_deploy_and_smoke.steps;
  const request = steps.find(step => step.name === '请求固定 SHA 的隔离候选');
  const wait = steps.find(step => step.name === '等待同 SHA、同镜像的隔离验证回执');
  for (const bad of [null, 'request_id', 'sha', 'image_id', 'isolated']) {
    const status = { status: 'success', request_id: 'fixture-request', sha, image_id: `sha256:${'b'.repeat(64)}`, isolated: true };
    if (bad) status[bad] = 'wrong';
    await fixture(req => req.method === 'POST' ? { request_id: 'fixture-request' } : status, async (url, requests) => {
      const temp = mkdtempSync(join(tmpdir(), 'staging-contract-'));
      try {
        const result = await shell(`${request.run}\nset -a; source "$GITHUB_ENV"; set +a\n${wait.run}`, {
          BRAIN_URL: url, DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, EXPECTED_SHA: sha, GITHUB_ENV: join(temp, 'env'), RUNNER_TEMP: temp,
        });
        assert.equal(result.code === 0, bad === null, result.output);
        assert.deepEqual(JSON.parse(requests[0].body), { staging: true, sha });
        assert.equal(requests[0].authorization, 'Bearer fixture-token');
        assert.equal(requests[1].url, '/api/brain/deploy/staging/status');
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
});

test('两个staging诊断入口保持手动且不把诊断描述为自动部署证据', () => {
  for (const name of ['auto-staging-deploy.yml', 'nightly-real-machine.yml']) {
    assert.deepEqual(Object.keys(doc(name).on), ['workflow_dispatch']);
  }
  const text = readFileSync(join(root, '.github/workflows/nightly-real-machine.yml'), 'utf8');
  assert.doesNotMatch(text, /每夜在|常驻 Staging|Nightly Staging/);
});
