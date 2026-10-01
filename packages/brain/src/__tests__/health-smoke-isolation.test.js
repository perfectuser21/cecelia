import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
async function runFixture(script, body, status = 200) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await exec('bash', [fileURLToPath(new URL(`../../scripts/smoke/${script}`, import.meta.url))], {
      timeout: 5000, env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${server.address().port}` },
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const passive = () => ({
  status: 'healthy', runtime: { isolated: true, background_automation: false },
  local_execution: { enabled: false, role: 'disabled', reason: 'runtime_isolated' },
  fleet_transport: { enabled: false, status: 'disabled', reason: 'runtime_isolated', worker_machines: [] },
});
const active = local => ({
  status: 'healthy', runtime: { isolated: false, background_automation: true },
  local_execution: { enabled: local, role: local ? 'executor' : 'scheduler_only', reason: local ? null : 'configured_disabled' },
  fleet_transport: { enabled: !local, status: local ? 'disabled' : 'ready', worker_machines: local ? [] : ['fixture-worker'] },
});
for (const script of ['local-execution-guard-smoke.sh', 'orchestrator-remote-launch-smoke.sh']) {
  describe('/health smoke ' + script, () => {
    it('隔离实例明确禁用所有执行路径时通过', async () => {
      await expect(runFixture(script, passive())).resolves.toMatchObject({ stdout: expect.stringContaining('OK') });
    });
    it.each(['local', 'remote', 'automation', 'missing'])('隔离实例 %s 约束被破坏必须拒绝', async kind => {
      const body = passive();
      if (kind === 'local') body.local_execution.enabled = true;
      if (kind === 'remote') body.fleet_transport.enabled = true;
      if (kind === 'automation') body.runtime.background_automation = true;
      if (kind === 'missing') delete body.fleet_transport.worker_machines;
      await expect(runFixture(script, body)).rejects.toMatchObject({ code: 1 });
    });
    it.each([true, false])('生产模式 local=%s 保留合法执行路径', async local => {
      await expect(runFixture(script, active(local))).resolves.toMatchObject({ stdout: expect.stringContaining('OK') });
    });
    it('响应 HTTP 非 200 仍失败', async () => {
      await expect(runFixture(script, passive(), 201)).rejects.toMatchObject({ code: 1 });
    });
    it('缺少隔离声明不能将全部停用当作正常生产', async () => {
      const body = passive(); delete body.runtime;
      await expect(runFixture(script, body)).rejects.toMatchObject({ code: 1 });
    });
  });
}
it('生产调度器缺少远端执行路径仍失败', async () => {
  const body = active(false); body.fleet_transport.enabled = false;
  await expect(runFixture('orchestrator-remote-launch-smoke.sh', body)).rejects.toMatchObject({ code: 1 });
});
