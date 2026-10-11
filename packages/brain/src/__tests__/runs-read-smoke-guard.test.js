// runs-read-smoke.sh 守卫拒绝语义回归（QA 裁判 J-1）：
// smoke-production-guard 拒绝写入时，smoke 必须 exit 1 且不发任何请求，不能 exit 0 冒充"全部断言通过"。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SMOKE = fileURLToPath(new URL('../../scripts/smoke/runs-read-smoke.sh', import.meta.url));
const PROXY_KEYS = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];

function runSmoke(env) {
  const base = { ...process.env };
  for (const key of [...PROXY_KEYS, 'SMOKE_ALLOW_WRITE', 'BRAIN_CONTAINER', 'CECELIA_INTERNAL_TOKEN']) delete base[key];
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [SMOKE], { env: { ...base, ...env } });
    let output = '';
    proc.stdout.on('data', (d) => { output += d; });
    proc.stderr.on('data', (d) => { output += d; });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, output }));
  });
}

describe('runs-read-smoke.sh 守卫拒绝时不得静默通过', () => {
  let server;
  let requests;
  let brainUrl;

  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    brainUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('未授权写入（缺 SMOKE_ALLOW_WRITE）→ exit 1、零请求、输出 FAIL', async () => {
    const { code, output } = await runSmoke({ BRAIN_URL: brainUrl });
    expect(code, output).toBe(1);
    expect(output).toMatch(/FAIL/);
    expect(output).not.toMatch(/PASS/);
    expect(requests).toEqual([]);
  });

  it('已授权但目标身份无法核对（缺 BRAIN_CONTAINER）→ exit 1、零请求', async () => {
    const { code, output } = await runSmoke({ BRAIN_URL: brainUrl, SMOKE_ALLOW_WRITE: '1' });
    expect(code, output).toBe(1);
    expect(output).toMatch(/FAIL/);
    expect(requests).toEqual([]);
  });
});
