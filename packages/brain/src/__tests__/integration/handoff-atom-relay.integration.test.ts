/**
 * handoff-atom-relay.integration.test.ts
 *
 * relay handoff 登记缺口修复回归测试（真 Postgres TEMP 影子表，禁 mock 边：handoff ↔ capture-inbox ↔ DB）。
 * 根因回归：skill-relay 完成任务的 handoff 由 relay 侧直接 PATCH tasks.result.handoff，
 * 不走 saveHandoff（其中才有 pushCaptureAtom）→ 零 handoff atom。
 * 修复口径：handoff.js 新增导出 pushHandoffAtom(pool, taskId, handoff)（saveHandoff 内部复用，
 * PATCH /api/brain/tasks/:id 在 result.handoff 有效时调用），两条路径同口径。
 * 需真 PG：注册进 vitest.config.js POSTGRES_INTEGRATION_TESTS。
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

// pushHandoffAtom 为本 sprint 新增导出：实现前此 import 失败 = TDD Red
const { pushHandoffAtom, buildHandoff } = await import(brainMod('handoff.js'));
const { DB_DEFAULTS } = await import(brainMod('db-config.js'));

const TASK_ID = '44444444-4444-4444-8444-444444444444';

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

describe('pushHandoffAtom — relay PATCH 路径 handoff 登记（与 saveHandoff 同口径）[BEHAVIOR]', () => {
  it('pushHandoffAtom 写入 target_type=handoff 且 routed_to_table=tasks routed_to_id=task_id', async () => {
    const handoff = buildHandoff({
      task_id: TASK_ID,
      title: 'relay 交接单',
      verdict: 'FAIL',
      done: ['完成 A'],
      not_done: ['未完成 B'],
    });
    const atomId = await pushHandoffAtom(client, TASK_ID, handoff);
    expect(atomId).toBeTruthy();
    const { rows } = await client.query(
      `SELECT target_type, target_subtype, routed_to_table, routed_to_id FROM capture_atoms WHERE id = $1`,
      [atomId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('handoff');
    expect(rows[0].target_subtype).toBe('FAIL');
    expect(rows[0].routed_to_table).toBe('tasks');
    expect(rows[0].routed_to_id).toBe(TASK_ID);
  });

  it('handoff 为空对象或非对象时不产 atom 且不抛异常', async () => {
    expect(await pushHandoffAtom(client, TASK_ID, {})).toBeNull();
    expect(await pushHandoffAtom(client, TASK_ID, null)).toBeNull();
    expect(await pushHandoffAtom(client, TASK_ID, 'not-an-object' as any)).toBeNull();
    expect(await pushHandoffAtom(client, TASK_ID, [1, 2] as any)).toBeNull();
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM capture_atoms`);
    expect(rows[0].n).toBe(0);
  });

  it('verdict=PASS 且含真实 next_steps → target_subtype=PASS+NEXT 与 saveHandoff 同口径', async () => {
    const handoff = buildHandoff({
      task_id: TASK_ID,
      title: 'relay 交接单',
      verdict: 'PASS',
      next_steps: ['补充文档'],
    });
    const atomId = await pushHandoffAtom(client, TASK_ID, handoff);
    expect(atomId).toBeTruthy();
    const { rows } = await client.query(`SELECT target_subtype FROM capture_atoms WHERE id = $1`, [atomId]);
    expect(rows[0].target_subtype).toBe('PASS+NEXT');
  });
});
