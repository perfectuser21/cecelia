/** 真库火：458 后 project 根 + parent_task_id 真列 + 链上下文 + handoff_log 追加 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getChainContext, saveHandoff, buildHandoff } from '../../handoff.js';
import { createRoutedTask } from '../../work-routing-store.js';

let pool; let rootId; let childIds = [];
beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, task_type, status) VALUES ('IT 接力棒根 ' || md5(random()::text), '打通留痕', 'project', 'in_progress') RETURNING id`
  );
  rootId = rows[0].id;
});
afterAll(async () => {
  // work_routing_receipts 只追加（触发器拒绝删改）→ 子任务只能置 cancelled，不能物理删
  if (childIds.length) await pool.query(`UPDATE tasks SET status = 'cancelled' WHERE id = ANY($1::uuid[])`, [childIds]);
  if (rootId) await pool.query('DELETE FROM tasks WHERE id = $1', [rootId]);
});

describe('接力棒脊柱（真库）', () => {
  it('task_type=project 可插；createRoutedTask 写真列 parent_task_id 且 sequence_no 自增', async () => {
    const tag = Date.now();
    for (const title of [`IT 第一棒 ${tag}`, `IT 第二棒 ${tag}`]) {
      const routed = await createRoutedTask(pool, {
        source: 'conversation', source_id: `relay-it-${title}-${Date.now()}`, title, description: 'x',
        requested_task_type: 'data', declared_domain: 'operations', mutation_intent: 'none',
        parent_task_id: rootId, task: { status: 'queued', trigger_source: 'test' },
      });
      childIds.push(routed.task.id);
      expect(routed.task.parent_task_id).toBe(rootId);
    }
    const { rows } = await pool.query('SELECT sequence_no FROM tasks WHERE parent_task_id = $1 ORDER BY sequence_no', [rootId]);
    expect(rows.map((r) => r.sequence_no)).toEqual([1, 2]);
  });
  it('父不存在 → parent_task_not_found', async () => {
    await expect(createRoutedTask(pool, {
      source: 'conversation', source_id: `relay-it-bad-${Date.now()}`, title: `IT bad ${Date.now()}`, description: 'x',
      requested_task_type: 'data', declared_domain: 'operations', mutation_intent: 'none',
      parent_task_id: '00000000-0000-4000-8000-000000000000', task: { status: 'queued', trigger_source: 'test' },
    })).rejects.toMatchObject({ code: 'parent_task_not_found' });
  });
  it('第一棒写 handoff 后：第二棒的链上下文能看到根与第一棒的 handoff；handoff_log 追加两次成两条', async () => {
    const [first, second] = childIds;
    await saveHandoff({ pool }, buildHandoff({ task_id: first, title: 'IT 第一棒', verdict: 'PASS', done: ['做了 A'], next_steps: ['做 B'] }));
    await saveHandoff({ pool }, buildHandoff({ task_id: first, title: 'IT 第一棒', verdict: 'PASS', done: ['做了 A2'], next_steps: [] }));
    const { rows } = await pool.query(`SELECT jsonb_array_length(result->'handoff_log') AS n, result->'handoff'->'done'->>0 AS latest FROM tasks WHERE id=$1`, [first]);
    expect(rows[0].n).toBe(2);
    expect(rows[0].latest).toBe('做了 A2');
    const ctx = await getChainContext({ pool }, second);
    expect(ctx.root.id).toBe(rootId);
    expect(ctx.is_chained).toBe(true);
    expect(ctx.position).toEqual({ sequence_no: 2, total: 2 });
    expect(ctx.recent.map((r) => r.id)).toContain(first);
  });
});
