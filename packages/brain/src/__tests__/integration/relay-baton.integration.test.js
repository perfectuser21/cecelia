/** 真库火：completed 收口 → 合成/沿用 handoff → next_steps 落成子任务（挂根）与待拍板决策 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { relayOnComplete } from '../../lib/relay-baton.js';
import { saveHandoff, buildHandoff } from '../../handoff.js';

let pool; let rootId; let firstId; const spawned = []; const decisionIds = [];
beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const tag = Date.now();
  const r = await pool.query(`INSERT INTO tasks (title, description, task_type, status) VALUES ($1, '目标：接棒', 'project', 'in_progress') RETURNING id`, [`IT 接棒根 ${tag}`]);
  rootId = r.rows[0].id;
  const c = await pool.query(`INSERT INTO tasks (title, task_type, status, priority, parent_task_id, sequence_no) VALUES ($1, 'data', 'completed', 'P1', $2, 1) RETURNING id`, [`IT 接棒第一棒 ${tag}`, rootId]);
  firstId = c.rows[0].id;
});
afterAll(async () => {
  if (decisionIds.length) await pool.query('DELETE FROM decisions WHERE id = ANY($1::uuid[])', [decisionIds]);
  if (spawned.length) await pool.query(`UPDATE tasks SET status = 'cancelled' WHERE id = ANY($1::uuid[])`, [spawned]);
  if (firstId) await pool.query('DELETE FROM tasks WHERE id = $1', [firstId]);
  if (rootId) await pool.query('DELETE FROM tasks WHERE id = $1', [rootId]);
});

describe('接力棒接棒（真库）', () => {
  it('completed 且无 handoff → 合成 synthesized；无 next_steps 不生子任务', async () => {
    const r = await relayOnComplete(pool, firstId);
    expect(r.synthesized).toBe(true);
    expect(r.tasks).toEqual([]);
    const { rows } = await pool.query(`SELECT result->'handoff'->>'synthesized' AS s, jsonb_array_length(result->'handoff_log') AS n FROM tasks WHERE id=$1`, [firstId]);
    expect(rows[0].s).toBe('true');
    expect(rows[0].n).toBe(1);
  });
  it('补写真 handoff（带 task + decision）→ 子任务挂在根下 sequence_no=2、决策 pending；重复触发幂等', async () => {
    const h = buildHandoff({ task_id: firstId, title: '第一棒', verdict: 'PASS', done: ['A'], next_steps: [
      { kind: 'task', title: `IT 接棒第二棒 ${firstId.slice(0, 8)}`, detail: '做 B' },
      { kind: 'decision', title: `IT 要不要删列 ${firstId.slice(0, 8)}`, detail: '四张表' },
    ] });
    await saveHandoff({ pool }, h);
    const kids = await pool.query('SELECT id, title, status, sequence_no, payload FROM tasks WHERE parent_task_id = $1 AND id <> $2 ORDER BY sequence_no', [rootId, firstId]);
    expect(kids.rows).toHaveLength(1);
    spawned.push(kids.rows[0].id);
    expect(kids.rows[0].status).toBe('queued');
    expect(kids.rows[0].sequence_no).toBe(2);
    expect(kids.rows[0].payload.lane).toBe('AI');
    expect(kids.rows[0].payload.from_handoff).toBe(firstId);
    const dec = await pool.query(`SELECT id, status, context->>'root_task_id' AS root FROM decisions WHERE source_ref = $1`, [firstId]);
    expect(dec.rows).toHaveLength(1);
    decisionIds.push(dec.rows[0].id);
    expect(dec.rows[0].status).toBe('pending');
    expect(dec.rows[0].root).toBe(rootId);
    // 再触发一次（PATCH 路径同款）→ 不重复生
    const again = await relayOnComplete(pool, firstId);
    expect(again.synthesized).toBe(false);
    const kids2 = await pool.query('SELECT count(*)::int AS n FROM tasks WHERE parent_task_id = $1 AND id <> $2', [rootId, firstId]);
    expect(kids2.rows[0].n).toBe(1);
    const dec2 = await pool.query(`SELECT count(*)::int AS n FROM decisions WHERE source_ref = $1`, [firstId]);
    expect(dec2.rows[0].n).toBe(1);
  });
});
