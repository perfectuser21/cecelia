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
    res.end(JSON.stringify(handler(req, body, res)));
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

test('预览实际checkout固定commit，即使远程分支已前进；非法SHA不触碰worktree', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'preview-checkout-'));
  try {
    const result = await shell(`
      git init -q "$FIXTURE/origin"
      git -C "$FIXTURE/origin" -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -qm first
      first=$(git -C "$FIXTURE/origin" rev-parse HEAD)
      git clone -q "$FIXTURE/origin" "$FIXTURE/repo"
      branch=$(git -C "$FIXTURE/origin" branch --show-current)
      git -C "$FIXTURE/origin" -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -qm second
      bash scripts/preview-checkout.sh "$FIXTURE/repo" "$FIXTURE/worktree" "$branch" "$first"
      test "$(git -C "$FIXTURE/worktree" rev-parse HEAD)" = "$first"
      ! git -C "$FIXTURE/worktree" symbolic-ref -q HEAD
      if bash scripts/preview-checkout.sh "$FIXTURE/repo" "$FIXTURE/unsafe" "$branch" bad; then exit 91; fi
      test ! -e "$FIXTURE/unsafe"
    `, { FIXTURE: temp });
    assert.equal(result.code, 0, result.output);
    assert.match(readFileSync(join(root, 'scripts/preview-env-start.sh'), 'utf8'), /bash "\$\{SCRIPT_DIR\}\/preview-checkout\.sh"/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Standalone staging拒绝无有效request id的接受响应', async () => {
  const step = doc('auto-staging-deploy.yml').jobs.staging_deploy_and_smoke.steps.find(step => step.name === '请求固定 SHA 的隔离候选');
  for (const request_id of [42, '', 'id\nEVIL=fixture']) {
    await fixture(() => ({ request_id }), async url => {
      const temp = mkdtempSync(join(tmpdir(), 'staging-request-'));
      try {
        const result = await shell(step.run, { BRAIN_URL: url, DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, GITHUB_ENV: join(temp, 'env'), RUNNER_TEMP: temp });
        assert.notEqual(result.code, 0, result.output);
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
});

for (const enabled of [false, true]) test(`手动staging健康诊断真实HTTP执行，tick enabled=${enabled}`, async () => {
  const step = doc('nightly-real-machine.yml').jobs['nightly-smoke'].steps.find(step => step.name === 'Staging Smoke（真实机器 5222）');
  // 使用相同YAML命令，覆盖可参数化端口，不访问真实5222。
  await fixture(req => req.url.includes('/tick/status') ? { enabled } : { status: 'healthy' }, async (url, requests) => {
    const result = await shell(step.run, { BRAIN_URL: url, STAGING_PORT: new URL(url).port });
    assert.equal(result.code === 0, !enabled, result.output);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(req => req.url.startsWith('/api/brain/')));
  });
});

// 合法业务正文不能覆盖HTTP失败；302也不能跟随到另一个看似成功的实例。
for (const code of [302, 401, 500]) {
  for (const target of ['preview-identity', 'staging-request', 'staging-wait', 'smoke-health', 'smoke-tick', 'smoke-tasks']) {
    test(`${target} 拒绝HTTP ${code}的合法业务正文且不跟随重定向`, async () => {
      const endpoint = {
        'preview-identity': '/api/brain/preview/identity',
        'staging-request': '/api/brain/deploy',
        'staging-wait': '/api/brain/deploy/staging/status',
        'smoke-health': '/api/brain/health',
        'smoke-tick': '/api/brain/tick/status',
        'smoke-tasks': '/api/brain/tasks?limit=1',
      }[target];
      await fixture((req, _body, res) => {
        if (req.url === endpoint) {
          res.statusCode = code;
          if (code === 302) res.setHeader('Location', '/redirected-success');
        }
        if (target === 'preview-identity') return { git_sha: sha, db_name: 'cecelia_preview_42', pr_number: 42, tick_enabled: false };
        if (target === 'staging-request') return { request_id: 'fixture-request' };
        if (target === 'staging-wait') return { status: 'success', request_id: 'fixture-request', sha, image_id: `sha256:${'b'.repeat(64)}`, isolated: true };
        return req.url.includes('/tick/status') ? { enabled: false } : { status: 'healthy' };
      }, async (url, requests) => {
        const temp = mkdtempSync(join(tmpdir(), 'http-status-contract-'));
        try {
          const env = {
            BRAIN_URL: url, PREVIEW_URL: url, EXPECTED_SHA: sha, EXPECTED_DB_NAME: 'cecelia_preview_42', PR_NUMBER: '42',
            DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, GITHUB_ENV: join(temp, 'env'), GITHUB_OUTPUT: join(temp, 'output'),
            RUNNER_TEMP: temp, STAGING_REQUEST_ID: 'fixture-request', STAGING_PORT: new URL(url).port,
          };
          let command;
          if (target === 'preview-identity') command = 'bash scripts/verify-preview-identity.sh';
          else if (target === 'staging-request') command = doc('auto-staging-deploy.yml').jobs.staging_deploy_and_smoke.steps.find(step => step.name === '请求固定 SHA 的隔离候选').run;
          else if (target === 'staging-wait') command = 'bash scripts/wait-for-staging.sh';
          else command = doc('nightly-real-machine.yml').jobs['nightly-smoke'].steps.find(step => step.name === 'Staging Smoke（真实机器 5222）').run;
          const result = await shell(command, env);
          assert.notEqual(result.code, 0, result.output);
          assert.ok(requests.some(req => req.url === endpoint), '没有执行目标HTTP请求');
          assert.ok(requests.every(req => req.url !== '/redirected-success'), '禁止跟随重定向');
          assert.equal(requests.length, target.startsWith('smoke-') ? 3 : 1);
        } finally { rmSync(temp, { recursive: true, force: true }); }
      });
    });
  }
}

for (const enabled of ['false', 'true', 'unknown', 0, 1, null, undefined, {}, []]) {
  test(`staging tick拒绝非布尔enabled：${JSON.stringify(enabled)}`, async () => {
    await fixture(req => req.url.includes('/tick/status') ? { enabled } : { status: 'healthy' }, async (url, requests) => {
      const result = await shell('bash scripts/auto-staging-smoke.sh', { STAGING_HOST: '127.0.0.1', STAGING_PORT: new URL(url).port });
      assert.notEqual(result.code, 0, result.output);
      assert.equal(requests.length, 3);
    });
  });
}

test('所有身份/回执消费者拒绝HTTP200但传输截断的合法JSON正文', async () => {
  for (const target of ['preview-identity', 'staging-request', 'staging-wait', 'smoke-health', 'smoke-tick', 'smoke-tasks']) {
    const suffix = target.split('-')[1];
    await fixture((req, _body, res) => {
      const isTarget = target.startsWith('smoke-') ? req.url.includes(`/${suffix === 'tick' ? 'tick/status' : suffix}`) : true;
      if (isTarget) {
        res.setHeader('Content-Length', '4096');
        res.setHeader('Connection', 'close');
      }
      if (target === 'preview-identity') return { git_sha: sha, db_name: 'cecelia_preview_42', pr_number: 42, tick_enabled: false };
      if (target === 'staging-request') return { request_id: 'fixture-request' };
      if (target === 'staging-wait') return { status: 'success', request_id: 'fixture-request', sha, image_id: `sha256:${'b'.repeat(64)}`, isolated: true };
      return req.url.includes('/tick/status') ? { enabled: false } : { status: 'healthy' };
    }, async url => {
      const temp = mkdtempSync(join(tmpdir(), 'http-transport-contract-'));
      try {
        const command = target === 'preview-identity' ? 'bash scripts/verify-preview-identity.sh'
          : target === 'staging-request' ? doc('auto-staging-deploy.yml').jobs.staging_deploy_and_smoke.steps.find(step => step.name === '请求固定 SHA 的隔离候选').run
          : target === 'staging-wait' ? 'bash scripts/wait-for-staging.sh' : 'bash scripts/auto-staging-smoke.sh';
        const result = await shell(command, {
          BRAIN_URL: url, PREVIEW_URL: url, EXPECTED_SHA: sha, EXPECTED_DB_NAME: 'cecelia_preview_42', PR_NUMBER: '42',
          DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, GITHUB_ENV: join(temp, 'env'), GITHUB_OUTPUT: join(temp, 'output'),
          RUNNER_TEMP: temp, STAGING_REQUEST_ID: 'fixture-request', STAGING_HOST: '127.0.0.1', STAGING_PORT: new URL(url).port,
        });
        assert.notEqual(result.code, 0, `${target}: ${result.output}`);
        assert.match(result.output, /HTTP 000|HTTP 0|curl: \(18\)/, `${target}: 未证实传输失败，而可能被其他错误拒绝：${result.output}`);
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
});
