/**
 * 有头会话收尾 × 真 PostgreSQL：账本任务经唯一写入口 createRoutedTask 真建（completed、不派发）、
 * handoff 真写进 tasks.result；同会话重放幂等；另一会话关联同任务时追加不覆盖。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { attachHeadedSession, HEADED_SOURCE_ID_PREFIX } from '../../headed-session-handoff.js';

let pool;
// work_routing_receipts 不可删改（reject_work_routing_receipt_mutation 触发器），任务行因外键也删不掉：
// 每轮用唯一 repo/session 隔离，而不是事后清理。
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const REPO = `itest-headed-${RUN}`;
const SID_A = `itest-headed-a-${RUN}`;
const SID_B = `itest-headed-b-${RUN}`;
const LEDGER = `SELECT id FROM tasks WHERE payload->>'headed_repo' = '${REPO}'`;

function session(sessionId, over = {}) {
  return {
    sessionId,
    source: 'conversation-claude',
    repo: REPO,
    turns: [{ text: '盘点派发总闸' }],
    entrypoint: 'cli',
    linkedTaskIds: [],
    ...over,
  };
}

describe('headed-session-handoff 集成（真 DB）', () => {
  beforeAll(async () => {
    pool = (await import('../../db.js')).default;
  });

  it('无关联任务 → 真建 completed 账本任务并写 handoff；重放幂等；别的会话关联它时追加不覆盖', async () => {
    const first = await attachHeadedSession(pool, { session: session(SID_A), summary: '1. 盘点派发总闸\n2. 修对话捕获' });
    expect(first.created).toBeTruthy();

    const { rows } = await pool.query(
      `SELECT t.id, t.status, t.title, t.claimed_by, t.payload, t.result, r.source, r.source_id
         FROM tasks t JOIN work_routing_receipts r ON r.task_id = t.id WHERE t.id = $1`,
      [first.created],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'completed', title: '有头会话：盘点派发总闸', source: 'conversation', source_id: `${HEADED_SOURCE_ID_PREFIX}${SID_A}` });
    expect(rows[0].payload).toMatchObject({ ledger_only: true, headed_session_id: SID_A });
    expect(rows[0].result.handoff.headed_sessions).toEqual([expect.objectContaining({ session_id: SID_A })]);
    expect(rows[0].result.handoff.done.join('\n')).toContain('修对话捕获');
    expect(rows[0].result.handoff_log).toHaveLength(1);

    const replay = await attachHeadedSession(pool, { session: session(SID_A), summary: '1. 盘点派发总闸\n2. 修对话捕获' });
    expect(replay).toEqual({ linked: [], created: null, unchanged: [first.created] });
    const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE id IN (${LEDGER})`);
    expect(count[0].n).toBe(1);

    const linked = await attachHeadedSession(pool, { session: session(SID_B, { linkedTaskIds: [first.created] }), summary: '1. 收尾验收' });
    expect(linked.linked).toEqual([first.created]);
    const { rows: after } = await pool.query('SELECT result FROM tasks WHERE id = $1', [first.created]);
    const h = after[0].result.handoff;
    expect(h.headed_sessions.map((x) => x.session_id)).toEqual([SID_A, SID_B]);
    expect(h.done.join('\n')).toContain('修对话捕获');
    expect(h.done.join('\n')).toContain('收尾验收');
    expect(h.next_steps).toEqual([]);
    expect(after[0].result.handoff_log).toHaveLength(2);
  });
});
