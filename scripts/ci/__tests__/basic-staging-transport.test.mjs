import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
  for (const target of ['smoke-health', 'smoke-tick', 'smoke-tasks']) {
    test(`${target} 拒绝HTTP ${code}的合法业务正文且不跟随重定向`, async () => {
      const endpoint = {
        'smoke-health': '/api/brain/health',
        'smoke-tick': '/api/brain/tick/status',
        'smoke-tasks': '/api/brain/tasks?limit=1',
      }[target];
      await fixture((req, _body, res) => {
        if (req.url === endpoint) {
          res.statusCode = code;
          if (code === 302) res.setHeader('Location', '/redirected-success');
        }
        return req.url.includes('/tick/status') ? { enabled: false } : { status: 'healthy' };
      }, async (url, requests) => {
        const temp = mkdtempSync(join(tmpdir(), 'http-status-contract-'));
        try {
          const env = {
            BRAIN_URL: url, PREVIEW_URL: url, EXPECTED_SHA: sha, EXPECTED_DB_NAME: 'cecelia_preview_42', PR_NUMBER: '42',
            DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, GITHUB_ENV: join(temp, 'env'), GITHUB_OUTPUT: join(temp, 'output'),
            RUNNER_TEMP: temp, STAGING_HOST: '127.0.0.1', STAGING_PORT: new URL(url).port,
          };
          const command = 'bash scripts/auto-staging-smoke.sh';
          const result = await shell(command, env);
          assert.notEqual(result.code, 0, result.output);
          assert.ok(requests.some(req => req.url === endpoint), '没有执行目标HTTP请求');
          assert.ok(requests.every(req => req.url !== '/redirected-success'), '禁止跟随重定向');
          assert.equal(requests.length, 3);
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
  for (const target of ['smoke-health', 'smoke-tick', 'smoke-tasks']) {
    const suffix = target.split('-')[1];
    await fixture((req, _body, res) => {
      const isTarget = req.url.includes(`/${suffix === 'tick' ? 'tick/status' : suffix}`);
      if (isTarget) {
        res.setHeader('Content-Length', '4096');
        res.setHeader('Connection', 'close');
      }
      return req.url.includes('/tick/status') ? { enabled: false } : { status: 'healthy' };
    }, async url => {
      const temp = mkdtempSync(join(tmpdir(), 'http-transport-contract-'));
      try {
        const command = 'bash scripts/auto-staging-smoke.sh';
        const result = await shell(command, {
          BRAIN_URL: url, PREVIEW_URL: url, EXPECTED_SHA: sha, EXPECTED_DB_NAME: 'cecelia_preview_42', PR_NUMBER: '42',
          DEPLOY_TOKEN: 'fixture-token', GITHUB_SHA: sha, GITHUB_ENV: join(temp, 'env'), GITHUB_OUTPUT: join(temp, 'output'),
          RUNNER_TEMP: temp, STAGING_HOST: '127.0.0.1', STAGING_PORT: new URL(url).port,
        });
        assert.notEqual(result.code, 0, `${target}: ${result.output}`);
        assert.match(result.output, /HTTP 000|HTTP 0|curl: \(18\)/, `${target}: 未证实传输失败，而可能被其他错误拒绝：${result.output}`);
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
});
