/**
 * ledger-hygiene-m7-beijing-window.integration.test.ts
 *
 * m7 探针口径修正回归测试（真 Postgres，TEMP 影子表，禁 mock 边：ledger-hygiene ↔ capture_atoms）。
 * 根因回归：08-04 探针 NOW()-24h 秒级窗口漂移 + 自产 issue atoms 自污染 → 连续误报升 P1。
 *
 * 位置无关（repo root 经 DEFINITION.md 向上探测），毕业进 packages/brain/src/__tests__/integration/
 * 时可原样复制。需真 PG：注册进 vitest.config.js POSTGRES_INTEGRATION_TESTS。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

function repoRoot(): string {
  let d = path.dirname(fileURLToPath(import.meta.url));
  // 毕业位置适配：packages/brain 也有 DEFINITION.md，monorepo 根需同时含 packages/ 去歧义（断言与合同 tests/ 逐字一致）
  while (!(fs.existsSync(path.join(d, 'DEFINITION.md')) && fs.existsSync(path.join(d, 'packages')))) {
    const parent = path.dirname(d);
    if (parent === d) throw new Error('repo root not found (DEFINITION.md)');
    d = parent;
  }
  return d;
}
const ROOT = repoRoot();
const brainMod = (f: string) => pathToFileURL(path.join(ROOT, 'packages/brain/src', f)).href;
const pg = createRequire(path.join(ROOT, 'packages/brain/package.json'))('pg');

const { computeMetrics, evaluateRatchet } = await import(brainMod('ledger-hygiene.js'));
const { DB_DEFAULTS } = await import(brainMod('db-config.js'));

// 上一完整北京日 12:00（Asia/Shanghai 固定 UTC+8，从时区推导，不写死服务器本地时区）
const HOUR = 3600e3;
const nowShifted = new Date(Date.now() + 8 * HOUR);
const shMidnightUtcMs =
  Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth(), nowShifted.getUTCDate()) - 8 * HOUR;
const PREV_DAY_NOON = new Date(shMidnightUtcMs - 12 * HOUR).toISOString();

let client: any;

async function insertAtom(over: Record<string, unknown> = {}) {
  const row = { content: 'test atom', target_type: 'learning', lane: null, created_at: PREV_DAY_NOON, ...over };
  await client.query(
    `INSERT INTO capture_atoms (content, target_type, lane, created_at) VALUES ($1, $2, $3, $4)`,
    [row.content, row.target_type, row.lane, row.created_at]
  );
}

beforeAll(async () => {
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  for (const t of ['captures', 'capture_atoms', 'issues', 'design_docs']) {
    await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL)`);
  }
});

afterAll(async () => {
  await client?.end();
});

beforeEach(async () => {
  await client.query('DELETE FROM capture_atoms');
  await client.query('DELETE FROM captures');
});

describe('m7 统计窗 — 上一完整北京日（修 NOW()-24h 秒级漂移）[BEHAVIOR]', () => {
  it('m7 统计窗为上一完整北京日：仅当前时刻 atom 不计入 → debt=1', async () => {
    // 旧口径（NOW()-24h）会把当前时刻 atom 计入 → debt=0（假绿）；新口径必须 debt=1
    await insertAtom({ created_at: new Date().toISOString() });
    const m = await computeMetrics(client);
    expect(m.m7.enabled).toBe(true);
    expect(m.m7.debt).toBe(1);
  });

  it('m7 排除探针自产 atoms：上一北京日仅 lane=ledger-hygiene 自产 issue atom → debt=1 正确击穿', async () => {
    await insertAtom({
      lane: 'ledger-hygiene',
      target_type: 'issue',
      content: 'issue: [ledger-hygiene] 自产（应排除，防自污染自我延续）',
    });
    const m = await computeMetrics(client);
    expect(m.m7.enabled).toBe(true);
    expect(m.m7.debt).toBe(1);
  });

  it('上一北京日存在非自产 atom → m7 debt=0 清偿', async () => {
    await insertAtom({ lane: 'ledger-hygiene', target_type: 'issue', content: 'issue: 自产' });
    await insertAtom({ content: 'learning: 真实自主产出' });
    const m = await computeMetrics(client);
    expect(m.m7.debt).toBe(0);
  });

  it('debt=0 无击穿 → ratchet streak 复位为 0', async () => {
    await insertAtom({});
    const m = await computeMetrics(client);
    expect(m.m7.debt).toBe(0);
    const prev = { baseline: { m7: 0 }, last: { m7: 1 }, streaks: { m7: 2 }, baseline_date: '2026-08-01' };
    const { state, breaches } = evaluateRatchet({ m7: m.m7 }, prev, '2026-08-04');
    expect(state.streaks.m7).toBe(0);
    expect(breaches).toHaveLength(0);
  });
});
