// F1「工厂 · 开发闭环」步骤 1 —— 边：接单登记的依赖只有一个写口（链 bf5088a3 棒5，任务 3fad28e0，决策 105a5868）
//
// 接单进车间即分档，分档的一部分是「这个活等谁」。依赖曾散在三处写：
//   harness-dag 直 INSERT task_dependencies、proposal.js 直写 payload.depends_on、建单入口把 depends_on 当普通 payload。
// 三处各写各的，Notion 看板与派发闸看到的依赖各不相同。现在只有 lib/task-dependencies.js 能写。
//
// 守卫真 import 被改模块 harness-dag.js（不 mock 它），只用一个记录 SQL 的假 client：
// 一旦有人把边 INSERT 改回内联，或绕过写口的 ON CONFLICT 幂等 / edge_type 绑定参数，这里立刻红。
import { describe, it, expect } from 'vitest';

import { upsertTaskPlan } from '../../../packages/brain/src/harness-dag.js';
import { insertEdgeRow } from '../../../packages/brain/src/lib/task-dependencies.js';

const task = (id, depends_on = []) => ({
  task_id: id,
  title: `Task ${id}`,
  scope: `scope of ${id}`,
  dod: [`[BEHAVIOR] ${id} works`],
  files: [`packages/brain/src/${id}.js`],
  depends_on,
  complexity: 'S',
  estimated_minutes: 30,
});

describe('F1 step1 — 依赖边只经单一写口 insertEdgeRow', () => {
  it('upsertTaskPlan 的每条依赖 = 一次写口 INSERT（hard，绑定参数，ON CONFLICT 幂等），且不碰 tasks / payload', async () => {
    const calls = [];
    const client = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [], rowCount: 1 }; } };
    const { idMap } = await upsertTaskPlan({
      client,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: { initiative_id: 'init-1', tasks: [task('ws1'), task('ws2', ['ws1']), task('ws3', ['ws1']), task('ws4', ['ws2', 'ws3'])] },
    });

    const edges = calls.filter((c) => /INSERT INTO task_dependencies/i.test(c.sql));
    expect(edges).toHaveLength(4); // ws2→ws1, ws3→ws1, ws4→ws2, ws4→ws3
    for (const e of edges) {
      expect(e.sql).toMatch(/ON CONFLICT DO NOTHING/);
      expect(e.params[2]).toBe('hard');
    }
    expect(edges.map((e) => [e.params[0], e.params[1]])).toEqual(expect.arrayContaining([
      [idMap.ws2, idMap.ws1], [idMap.ws3, idMap.ws1], [idMap.ws4, idMap.ws2], [idMap.ws4, idMap.ws3],
    ]));
    // 虚拟 uuid 审计边：不查任务存在、不同步 payload（这些不存在的任务行本就没有）
    expect(calls.some((c) => /UPDATE tasks/i.test(c.sql) || /FROM tasks/i.test(c.sql) || /INSERT INTO tasks/i.test(c.sql))).toBe(false);
  });

  it('insertEdgeRow 自身：ON CONFLICT DO NOTHING，重复边返回 inserted=false', async () => {
    const client = { query: async () => ({ rows: [], rowCount: 0 }) };
    expect(await insertEdgeRow(client, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'hard'))
      .toEqual({ inserted: false });
  });
});
