import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./company-kr-analysis-smoke.sh', import.meta.url));
const valid = () => ({ success: true, config: { enabled: false, hour: 8, timezone: 'Asia/Shanghai', agent: 'company-kr-analyst' }, latest: null });
async function run(body, status = 200) {
  const calls = [];
  const server = createServer((req, res) => { calls.push([req.method, req.url]); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn('bash', [script], { env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${server.address().port}` } });
    let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
    return { code, output, calls };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
describe('公司KR分析smoke真实HTTP只读验证', () => {
  it('读取真实配置，不启用调度或制造分析任务', async () => {
    const result = await run(valid());
    expect(result.code, result.output).toBe(0);
    expect(result.calls).toEqual([['GET', '/api/brain/okr/company-key-results/analysis']]);
  });
  it('接口未部署、执行员错误、时区错误均不能通过', async () => {
    for (const [body, status] of [[{}, 404], [{ ...valid(), config: { ...valid().config, agent: 'main' } }, 200], [{ ...valid(), config: { ...valid().config, timezone: 'UTC' } }, 200]]) {
      expect((await run(body, status)).code).not.toBe(0);
    }
  });
  it('有最近任务时验证真实快照身份，缺失快照拒绝', async () => {
    const latest = { id: '00000000-0000-4000-8000-000000000001', status: 'completed_no_pr', input: { version: 1, snapshot_id: 'a'.repeat(64), formal_hash: 'b'.repeat(64), items: [{ id: '00000000-0000-4000-8000-000000000002', formal_revision: 'c'.repeat(64) }] } };
    expect((await run({ ...valid(), latest })).code).toBe(0);
    expect((await run({ ...valid(), latest: { ...latest, input: null } })).code).not.toBe(0);
  });
});
