import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
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

test('隔离候选回执按request/SHA/镜像验证，不依赖旧手动workflow', async () => {
  for (const bad of [null, 'request_id', 'sha', 'image_id', 'isolated']) {
    const status = { status: 'success', request_id: 'fixture-request', sha, image_id: `sha256:${'b'.repeat(64)}`, isolated: true };
    if (bad) status[bad] = 'wrong';
    await fixture(() => status, async (url, requests) => {
      const result = await shell('bash scripts/wait-for-staging.sh', {
        BRAIN_URL: url, EXPECTED_SHA: sha, STAGING_REQUEST_ID: 'fixture-request',
      });
      assert.equal(result.code === 0, bad === null, result.output);
      assert.equal(requests[0].url, '/api/brain/deploy/staging/status');
    });
  }
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

for (const enabled of [false, true]) test(`手动staging健康诊断真实HTTP执行，tick enabled=${enabled}`, async () => {
  // 直接验证保留的诊断工具，不依赖已退役的手动工作流。
  await fixture(req => req.url.includes('/tick/status') ? { enabled } : { status: 'healthy' }, async (url, requests) => {
    const result = await shell('bash scripts/auto-staging-smoke.sh', { STAGING_HOST: '127.0.0.1', STAGING_PORT: new URL(url).port });
    assert.equal(result.code === 0, !enabled, result.output);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(req => req.url.startsWith('/api/brain/')));
  });
});

// 合法业务正文不能覆盖HTTP失败；302也不能跟随到另一个看似成功的实例。
for (const code of [302, 401, 500]) {
  for (const target of ['staging-wait', 'smoke-health', 'smoke-tick', 'smoke-tasks']) {
    test(`${target} 拒绝HTTP ${code}的合法业务正文且不跟随重定向`, async () => {
      const endpoint = {
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
        if (target === 'staging-wait') return { status: 'success', request_id: 'fixture-request', sha, image_id: `sha256:${'b'.repeat(64)}`, isolated: true };
        return req.url.includes('/tick/status') ? { enabled: false } : { status: 'healthy' };
      }, async (url, requests) => {
        const temp = mkdtempSync(join(tmpdir(), 'http-status-contract-'));
        try {
          const env = {
            BRAIN_URL: url, PREVIEW_URL: url, EXPECTED_SHA: sha, EXPECTED_DB_NAME: 'cecelia_preview_42', PR_NUMBER: '42',
            DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, GITHUB_ENV: join(temp, 'env'), GITHUB_OUTPUT: join(temp, 'output'),
            RUNNER_TEMP: temp, STAGING_REQUEST_ID: 'fixture-request', STAGING_HOST: '127.0.0.1', STAGING_PORT: new URL(url).port,
          };
          let command;
          if (target === 'staging-wait') command = 'bash scripts/wait-for-staging.sh';
          else command = 'bash scripts/auto-staging-smoke.sh';
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
  for (const target of ['staging-wait', 'smoke-health', 'smoke-tick', 'smoke-tasks']) {
    const suffix = target.split('-')[1];
    await fixture((req, _body, res) => {
      const isTarget = target.startsWith('smoke-') ? req.url.includes(`/${suffix === 'tick' ? 'tick/status' : suffix}`) : true;
      if (isTarget) {
        res.setHeader('Content-Length', '4096');
        res.setHeader('Connection', 'close');
      }
      if (target === 'staging-wait') return { status: 'success', request_id: 'fixture-request', sha, image_id: `sha256:${'b'.repeat(64)}`, isolated: true };
      return req.url.includes('/tick/status') ? { enabled: false } : { status: 'healthy' };
    }, async url => {
      const temp = mkdtempSync(join(tmpdir(), 'http-transport-contract-'));
      try {
        const command = target === 'staging-wait' ? 'bash scripts/wait-for-staging.sh' : 'bash scripts/auto-staging-smoke.sh';
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
