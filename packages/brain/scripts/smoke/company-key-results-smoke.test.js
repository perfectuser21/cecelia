import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { COMPANY_KR_CATALOG, COMPANY_METRIC_MODE, companyMetric } from '../../src/lib/company-kr-metrics.js';

const script = fileURLToPath(new URL('./company-key-results-smoke.sh', import.meta.url));
const validItems = () => COMPANY_KR_CATALOG.map((source, index) => ({
  id: `brain-${index}`, source_page_id: source.page_id, source_goal_id: source.goal_id,
  source_area_ids: [], unit: source.unit, metric_mode: COMPANY_METRIC_MODE,
  start_value: '0', current_value: '2.345', target_value: '5',
  progress_ratio: companyMetric('0', '2.345', '5').ratio,
  progress_pct: 46.9, validation_state: 'unverified', updated_at: '2026-10-01T08:00:00.123001Z',
}));
async function run(body) {
  const calls = [];
  const server = createServer((req, res) => { calls.push([req.method, req.url]); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn('bash', [script], { env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    expect(calls).toEqual([['GET', '/api/brain/okr/company-key-results']]);
    return { code, output };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
describe('company-key-results-smoke 真实HTTP只读合同', () => {
  it('公司只读smoke必须唯一登记在通过基线，禁止以deny或debt代替', () => {
    const entries = name => readFileSync(new URL(`../../../quality/smoke-${name}.txt`, import.meta.url), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    expect(entries('allowlist').filter(name => name === 'company-key-results-smoke.sh')).toEqual(['company-key-results-smoke.sh']);
    expect(entries('denylist')).not.toContain('company-key-results-smoke.sh');
    expect(entries('debt')).not.toContain('company-key-results-smoke.sh');
  });
  it('未登记空集及完整8条原精度指标通过且只发GET', async () => {
    for (const items of [[], validItems()]) { const result = await run({ success: true, items }); expect(result.code, result.output).toBe(0); }
  });
  it('只有7条或未知来源替代第8条均失败', async () => {
    const unknown = validItems(); unknown[0].source_page_id = 'unknown';
    for (const items of [validItems().slice(0, 7), unknown]) { const result = await run({ success: true, items }); expect(result.code, result.output).not.toBe(0); }
  });
  it('数值冒充raw或公式ratio失真均失败', async () => {
    const numeric = validItems(); numeric[0].current_value = 2.345;
    const wrongRatio = validItems(); wrongRatio[0].progress_ratio = 0;
    for (const items of [numeric, wrongRatio]) { const result = await run({ success: true, items }); expect(result.code, result.output).not.toBe(0); }
  });
});
