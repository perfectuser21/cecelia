/**
 * capture-atom-routing.integration.test.ts
 *
 * pushCaptureAtom 签名断裂修复回归测试（真 Postgres TEMP 影子表，禁 mock 边：capture-inbox ↔ DB）。
 * 根因回归：capture-inbox.js 签名改成 _routedToTable/_routedToId 弃用后，全部调用方
 * （ledger-hygiene/cortex/auto-learning/handoff）传入的溯源字段被静默丢弃，routed_to_id 全空。
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

const { pushCaptureAtom } = await import(brainMod('capture-inbox.js'));
const { DB_DEFAULTS } = await import(brainMod('db-config.js'));

const TARGET_ID = '33333333-3333-4333-8333-333333333333';

let client: any;

beforeAll(async () => {
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  for (const t of ['captures', 'capture_atoms']) {
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

describe('pushCaptureAtom — 溯源字段落库（修签名断裂）[BEHAVIOR]', () => {
  it('pushCaptureAtom 传 routedToTable/routedToId 真实落库到 capture_atoms', async () => {
    const atomId = await pushCaptureAtom(client, {
      content: 'learning: 溯源落库测试',
      targetType: 'learning',
      targetSubtype: 'failure_pattern',
      routedToTable: 'learnings',
      routedToId: TARGET_ID,
    });
    expect(atomId).toBeTruthy();
    const { rows } = await client.query(
      `SELECT routed_to_table, routed_to_id FROM capture_atoms WHERE id = $1`,
      [atomId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].routed_to_table).toBe('learnings');
    expect(rows[0].routed_to_id).toBe(TARGET_ID);
  });

  it('pushCaptureAtom 透传 lane 落库', async () => {
    const atomId = await pushCaptureAtom(client, {
      content: 'issue: lane 标识测试',
      targetType: 'issue',
      lane: 'ledger-hygiene',
    });
    expect(atomId).toBeTruthy();
    const { rows } = await client.query(`SELECT lane FROM capture_atoms WHERE id = $1`, [atomId]);
    expect(rows[0].lane).toBe('ledger-hygiene');
  });

  it('routedToTable/routedToId 未传时列为 NULL（可选参数不回退既有调用方）', async () => {
    const atomId = await pushCaptureAtom(client, { content: '无溯源 atom', targetType: 'learning' });
    expect(atomId).toBeTruthy();
    const { rows } = await client.query(
      `SELECT routed_to_table, routed_to_id, lane FROM capture_atoms WHERE id = $1`,
      [atomId]
    );
    expect(rows[0].routed_to_table).toBeNull();
    expect(rows[0].routed_to_id).toBeNull();
    expect(rows[0].lane).toBeNull();
  });

  it('缺 content 或 targetType 返回 null 不写库', async () => {
    expect(await pushCaptureAtom(client, { content: '', targetType: 'learning' })).toBeNull();
    expect(await pushCaptureAtom(client, { content: 'x', targetType: null as any })).toBeNull();
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM capture_atoms`);
    expect(rows[0].n).toBe(0);
  });
});
