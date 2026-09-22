/**
 * 接力棒 PR1 脊柱 — 失败复现（先红后绿）
 *  1. saveHandoff 必须追加 result.handoff_log（跨 session 历史不丢）
 *  2. getChainContext 沿 parent_task_id 找根、算位置、取最近 handoff
 *  3. formatChainForPrompt：不在链上且无 handoff → ''；在链上 → 含根/目标/第 n 棒/规矩
 *  4. buildChainPromptSafe 吞异常
 *  5. resolveParentTaskId：非 uuid / 不存在 → parent_task_not_found
 */
import { describe, it, expect, vi } from 'vitest';
import {
  saveHandoff, buildHandoff, buildHandoffLogEntry, getChainContext, formatChainForPrompt,
  buildChainPromptSafe, HANDOFF_LOG_MAX,
} from '../handoff.js';
import { resolveParentTaskId } from '../work-routing-store.js';

vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn(async () => null) }));

const ROOT = '11111111-1111-4111-8111-111111111111';
const MID = '22222222-2222-4222-8222-222222222222';
const LEAF = '33333333-3333-4333-8333-333333333333';

describe('saveHandoff 追加日志', () => {
  it('UPDATE 同时写 handoff（覆盖）与 handoff_log（追加，带上限）', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1, rows: [] }; }) };
    const h = buildHandoff({ task_id: LEAF, title: 't', verdict: 'PASS', done: ['a'], next_steps: ['b'] });
    await saveHandoff({ pool }, { ...h, session_id: 's1' });
    const upd = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd.sql).toContain("'handoff'");
    expect(upd.sql).toContain("'handoff_log'");
    expect(upd.sql).toContain(`LIMIT ${HANDOFF_LOG_MAX}`);
    const entry = JSON.parse(upd.params[2]);
    expect(entry).toMatchObject({ task_id: LEAF, verdict: 'PASS', session_id: 's1', done: ['a'], next_steps: ['b'] });
  });
  it('buildHandoffLogEntry 只留精简字段', () => {
    const e = buildHandoffLogEntry({ task_id: LEAF, title: 'x'.repeat(500), done: Array(10).fill('d'), next_steps: [{ kind: 'task', title: 'n' }] });
    expect(e.title.length).toBeLessThanOrEqual(200);
    expect(e.done).toHaveLength(5);
    expect(e.next_steps[0]).toEqual({ kind: 'task', title: 'n' });
  });
});

function chainPool({ up, siblings = 3, recent = [] }) {
  return { query: vi.fn(async (sql) => {
    if (/WITH RECURSIVE up/.test(sql)) return { rows: up };
    if (/count\(\*\)::int AS total/.test(sql)) return { rows: [{ total: siblings }] };
    if (/WITH RECURSIVE down/.test(sql)) return { rows: recent };
    return { rows: [] };
  }) };
}

describe('getChainContext', () => {
  it('叶子沿 parent 找到根，位置=第 n/total 棒，recent 排除自己', async () => {
    const pool = chainPool({
      up: [
        { id: LEAF, parent_task_id: MID, title: 'leaf', task_type: 'dev', status: 'queued', sequence_no: 2, depth: 0 },
        { id: MID, parent_task_id: ROOT, title: 'mid', task_type: 'dev', status: 'in_progress', sequence_no: 1, depth: 1 },
        { id: ROOT, parent_task_id: null, title: '接力棒项目', description: '打通留痕', task_type: 'project', status: 'in_progress', sequence_no: null, depth: 2 },
      ],
      recent: [{ id: MID, title: 'mid', completed_at: null, handoff: { verdict: 'PASS', done: ['写了 458'], next_steps: ['接棒'] } }],
    });
    const ctx = await getChainContext({ pool }, LEAF);
    expect(ctx.root.id).toBe(ROOT);
    expect(ctx.root.task_type).toBe('project');
    expect(ctx.is_chained).toBe(true);
    expect(ctx.position).toEqual({ sequence_no: 2, total: 3 });
    expect(ctx.recent).toHaveLength(1);
    const downCall = pool.query.mock.calls.find(([sql]) => /WITH RECURSIVE down/.test(sql));
    expect(downCall[1][0]).toBe(ROOT);
    expect(downCall[1][1]).toBe(LEAF);
  });
  it('孤立任务：root=自身、is_chained=false、position=null', async () => {
    const pool = chainPool({ up: [{ id: LEAF, parent_task_id: null, title: 'solo', task_type: 'dev', status: 'queued', depth: 0 }] });
    const ctx = await getChainContext({ pool }, LEAF);
    expect(ctx.root.id).toBe(LEAF);
    expect(ctx.is_chained).toBe(false);
    expect(ctx.position).toBeNull();
  });
  it('任务不存在 → null', async () => {
    expect(await getChainContext({ pool: chainPool({ up: [] }) }, LEAF)).toBeNull();
  });
});

describe('formatChainForPrompt / buildChainPromptSafe', () => {
  it('孤立且无 handoff → 空串（不注入噪音）', () => {
    expect(formatChainForPrompt({ root: { id: LEAF }, is_chained: false, recent: [] })).toBe('');
    expect(formatChainForPrompt(null)).toBe('');
  });
  it('在链上 → 含根标题、目标、第 n 棒、handoff 规矩、最近 handoff', () => {
    const txt = formatChainForPrompt({
      root: { id: ROOT, title: '接力棒项目', description: '打通留痕', task_type: 'project', status: 'in_progress' },
      is_chained: true, position: { sequence_no: 2, total: 3 },
      recent: [{ id: MID, title: 'mid', handoff: { verdict: 'PASS', done: ['写了 458'], next_steps: ['接棒'] } }],
    });
    expect(txt).toContain('项目链上下文');
    expect(txt).toContain('接力棒项目');
    expect(txt).toContain('目标：打通留痕');
    expect(txt).toContain('第 2 / 3 棒');
    expect(txt).toContain('kind=task|decision|done');
    expect(txt).toContain('写了 458');
  });
  it('buildChainPromptSafe：查询抛错 → 空串不抛', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('boom'); }) };
    expect(await buildChainPromptSafe({ pool }, LEAF)).toBe('');
  });
});

describe('resolveParentTaskId', () => {
  it('null/空 → null 直通', async () => {
    expect(await resolveParentTaskId({ query: vi.fn() }, null)).toBeNull();
    expect(await resolveParentTaskId({ query: vi.fn() }, '')).toBeNull();
  });
  it('非 uuid → parent_task_not_found，不查库', async () => {
    const q = vi.fn();
    await expect(resolveParentTaskId({ query: q }, 'abc')).rejects.toMatchObject({ code: 'parent_task_not_found' });
    expect(q).not.toHaveBeenCalled();
  });
  it('uuid 但不存在 → parent_task_not_found；存在 → 返回 id', async () => {
    await expect(resolveParentTaskId({ query: vi.fn(async () => ({ rows: [] })) }, ROOT)).rejects.toMatchObject({ code: 'parent_task_not_found' });
    expect(await resolveParentTaskId({ query: vi.fn(async () => ({ rows: [{ id: ROOT }] })) }, ROOT)).toBe(ROOT);
  });
});
