import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/smoke/e1-observer-runner-flow.sh', import.meta.url));
async function runFixture({ isolated, running, leak = false, missingFields = false, statusCode = 200 }) {
  let reads = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/brain/health') {
      res.end(JSON.stringify({ status: 'healthy', runtime: { isolated, background_automation: !isolated } }));
    } else if (req.url === '/api/brain/observer/state') {
      res.statusCode = statusCode;
      reads++;
      if (missingFields) { res.end(JSON.stringify({ run_count: 0 })); return; }
      const active = running || (leak && reads > 1);
      res.end(JSON.stringify({ run_count: active ? reads : 0,
        last_run_at: active ? new Date(reads * 1000).toISOString() : null,
        alertness: active ? { level: 1 } : null, health: active ? { level: 1 } : null,
        resources: active ? { ok: true } : null,
      }));
    } else if (req.url === '/api/brain/observer/health') {
      res.end(JSON.stringify(running ? { healthy: true, last_run_age_ms: 1 } : { healthy: false, reason: 'never_run' }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await exec('bash', [script], { timeout: 5000,
      env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${server.address().port}`, SMOKE_SLEEP_S: '0' },
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

describe('Observer 冒烟按真实运行模式验收', () => {
  it('隔离实例两次采样保持从未运行且健康状态诚实标 never_run', async () => {
    await expect(runFixture({ isolated: true, running: false })).resolves.toMatchObject({ stdout: expect.stringContaining('被动实例') });
  });
  it('隔离实例采样期间启动后台任务必须报红', async () => {
    await expect(runFixture({ isolated: true, running: false, leak: true })).rejects.toMatchObject({ code: 1 });
  });
  it('隔离实例缺失字段不得等同未运行的空值', async () => {
    await expect(runFixture({ isolated: true, running: false, missingFields: true })).rejects.toMatchObject({ code: 1 });
  });
  it('隔离实例仍严格要求状态接口 HTTP 200', async () => {
    await expect(runFixture({ isolated: true, running: false, statusCode: 201 })).rejects.toMatchObject({ code: 1 });
  });
  it('生产实例仍要求计数及时间推进', async () => {
    await expect(runFixture({ isolated: false, running: true })).resolves.toMatchObject({ stdout: expect.stringContaining('PASSED') });
  });
  it('生产实例停摆不得因测试适配被放行', async () => {
    await expect(runFixture({ isolated: false, running: false })).rejects.toMatchObject({ code: 1 });
  });
});
