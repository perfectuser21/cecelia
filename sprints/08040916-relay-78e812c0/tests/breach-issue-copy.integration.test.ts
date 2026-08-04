/**
 * breach-issue-copy.integration.test.ts
 *
 * raiseBreachAlerts 文案修正 + 自产 atom 标识回归测试（真 Postgres TEMP 影子表）。
 * 根因回归：absolute 指标 debt 持平时文案写"上升 1→1"误导；探针自产 atom 无来源标识致自污染。
 * 需真 PG：注册进 vitest.config.js POSTGRES_INTEGRATION_TESTS。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

function repoRoot(): string {
  let d = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(d, 'DEFINITION.md'))) {
    const parent = path.dirname(d);
    if (parent === d) throw new Error('repo root not found (DEFINITION.md)');
    d = parent;
  }
  return d;
}
const ROOT = repoRoot();
const brainMod = (f: string) => pathToFileURL(path.join(ROOT, 'packages/brain/src', f)).href;
const pg = createRequire(path.join(ROOT, 'packages/brain/package.json'))('pg');

const { raiseBreachAlerts } = await import(brainMod('ledger-hygiene.js'));
const { DB_DEFAULTS } = await import(brainMod('db-config.js'));

let client: any;

beforeAll(async () => {
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  for (const t of ['captures', 'capture_atoms', 'issues']) {
    await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL)`);
  }
});

afterAll(async () => {
  await client?.end();
});

beforeEach(async () => {
  await client.query('DELETE FROM capture_atoms');
  await client.query('DELETE FROM captures');
  await client.query('DELETE FROM issues');
});

// streak=2 固定使用：避免 streak>=3 触发真实 Bark 推送
const flatBreach = { key: 'm7', name: '自主循环零产出', prevDebt: 1, debt: 1, streak: 2 };

describe('raiseBreachAlerts — debt 持平文案 + 自产标识 [BEHAVIOR]', () => {
  it('debt 持平时 issue 文案不含「上升」且含持平或连续第 N 天表述', async () => {
    await raiseBreachAlerts(client, [flatBreach], '2099-01-01');
    const { rows } = await client.query(
      `SELECT title, body FROM issues WHERE title LIKE '[ledger-hygiene] 自主循环零产出%'`
    );
    expect(rows).toHaveLength(1);
    const text = `${rows[0].title} ${rows[0].body || ''}`;
    expect(text).not.toContain('上升');
    expect(text.includes('持平') || text.includes('连续第 2 天')).toBe(true);
  });

  it('debt 真实上升时保留上升表述', async () => {
    await raiseBreachAlerts(client, [{ key: 'm7', name: '自主循环零产出', prevDebt: 0, debt: 1, streak: 1 }], '2099-01-02');
    const { rows } = await client.query(`SELECT title FROM issues`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain('上升');
  });

  it('探针自产 issue atom 带 lane=ledger-hygiene 且 routed_to_table=issues routed_to_id 非空', async () => {
    await raiseBreachAlerts(client, [flatBreach], '2099-01-03');
    const { rows } = await client.query(
      `SELECT lane, routed_to_table, routed_to_id FROM capture_atoms WHERE target_type = 'issue'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lane).toBe('ledger-hygiene');
    expect(rows[0].routed_to_table).toBe('issues');
    expect(rows[0].routed_to_id).toBeTruthy();
  });

  it('issue title 保持 [ledger-hygiene] 指标名前缀不变', async () => {
    // 每指标每日一条频控靠 title LIKE '[ledger-hygiene] <指标名>%' 去重，前缀不可破坏
    await raiseBreachAlerts(client, [flatBreach], '2099-01-04');
    const { rows } = await client.query(`SELECT title FROM issues`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title.startsWith('[ledger-hygiene] 自主循环零产出')).toBe(true);
  });
});
