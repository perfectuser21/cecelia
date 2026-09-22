/**
 * 接力棒 PR2 接棒 — 失败复现
 *  1. normalizeNextSteps：字符串→note；对象保留 kind/title/detail；非法丢弃；未知 kind→note
 *  2. materializeNextSteps：task→createRoutedTask（source child、source_id 幂等、挂根）；decision→decisions pending（去重）；note→skipped
 *  3. ensureHandoffOnComplete：有 handoff 原样返回；没有→合成 synthesized 并 saveHandoff
 *  4. relayOnComplete：非 completed 不动；异常吞成 null
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn(async () => null) }));

import { normalizeNextSteps, materializeNextSteps, ensureHandoffOnComplete, relayOnComplete } from '../relay-baton.js';

const ROOT = '11111111-1111-4111-8111-111111111111';
const SELF = '33333333-3333-4333-8333-333333333333';

describe('normalizeNextSteps', () => {
  it('字符串→note，对象保留字段，非法丢弃，未知 kind→note', () => {
    const out = normalizeNextSteps([
      '先补文档',
      { kind: 'task', title: '做 B', detail: 'x', task_type: 'data' },
      { kind: 'decision', title: '要不要删列' },
      { kind: 'weird', title: 'z' },
      { kind: 'task' },
      42, null, '   ',
    ]);
    expect(out).toEqual([
      { kind: 'note', title: '先补文档' },
      { kind: 'task', title: '做 B', detail: 'x', task_type: 'data' },
      { kind: 'decision', title: '要不要删列' },
      { kind: 'note', title: 'z' },
    ]);
  });
});

describe('materializeNextSteps', () => {
  const task = { id: SELF, title: '第二棒', priority: 'P1', task_type: 'dev', parent_task_id: ROOT, payload: { repo: 'cecelia', map_scope: ['database_foundation'] } };
  it('task→createRoutedTask：source=child、source_id 幂等、parent=根、lane=AI；decision→pending 决策；note→skipped', async () => {
    const created = [];
    const create = vi.fn(async (_pool, req) => { created.push(req); return { task: { id: `t-${created.length}`, title: req.title } }; });
    const inserted = [];
    const pool = { query: vi.fn(async (sql, params) => {
      if (/SELECT id FROM decisions/.test(sql)) return { rows: [] };
      if (/INSERT INTO decisions/.test(sql)) { inserted.push(params); return { rows: [{ id: 'd-1', topic: params[0] }] }; }
      return { rows: [] };
    }) };
    const out = await materializeNextSteps(pool, task, { next_steps: [
      { kind: 'task', title: '做 B', detail: '细节' },
      { kind: 'task', title: '改代码 C', change_kind: 'bug_fix' },
      { kind: 'decision', title: '要不要删列', detail: '四张表' },
      '只是备注',
    ] }, { createRoutedTask: create });
    expect(out.tasks.map((t) => t.title)).toEqual(['做 B', '改代码 C']);
    expect(created[0]).toMatchObject({ source: 'child', source_id: `handoff:${SELF}:0`, parent_task_id: ROOT, requested_task_type: 'data', mutation_intent: 'none' });
    expect(created[0].metadata).toMatchObject({ lane: 'AI', from_handoff: SELF });
    expect(created[1]).toMatchObject({ requested_task_type: 'dev', mutation_intent: 'write', declared_change_kind: 'bug_fix', repo_hint: 'cecelia', map_scope_hint: ['database_foundation'] });
    expect(out.decisions).toEqual([{ id: 'd-1', topic: '要不要删列', reused: false }]);
    expect(inserted[0][0]).toBe('要不要删列');
    expect(JSON.parse(inserted[0][3])).toMatchObject({ kind: 'relay_pending', task_id: SELF, root_task_id: ROOT });
    expect(inserted[0][5]).toBe(SELF);
    expect(out.skipped).toEqual([{ index: 3, kind: 'note', title: '只是备注', error: null }]);
  });
  it('decision 去重：同 source_ref+topic 已存在 → reused，不再插', async () => {
    const pool = { query: vi.fn(async (sql) => (/SELECT id FROM decisions/.test(sql) ? { rows: [{ id: 'd-old' }] } : { rows: [] })) };
    const out = await materializeNextSteps(pool, task, { next_steps: [{ kind: 'decision', title: '重复' }] });
    expect(out.decisions).toEqual([{ id: 'd-old', topic: '重复', reused: true }]);
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO decisions/.test(sql))).toBe(false);
  });
  it('无父任务时子任务挂在自己下面（自己即根）', async () => {
    const create = vi.fn(async (_p, req) => ({ task: { id: 't', title: req.title } }));
    await materializeNextSteps({ query: vi.fn() }, { ...task, parent_task_id: null }, { next_steps: [{ kind: 'task', title: 'x' }] }, { createRoutedTask: create });
    expect(create.mock.calls[0][1].parent_task_id).toBe(SELF);
  });
  it('createRoutedTask 抛错 → 进 skipped，不中断其余步骤', async () => {
    const create = vi.fn(async (_p, req) => { if (req.title === 'bad') { const e = new Error('x'); e.code = 'routing_map_scope_unresolved'; throw e; } return { task: { id: 'ok', title: req.title } }; });
    const out = await materializeNextSteps({ query: vi.fn() }, task, { next_steps: [{ kind: 'task', title: 'bad' }, { kind: 'task', title: 'good' }] }, { createRoutedTask: create });
    expect(out.skipped[0]).toMatchObject({ kind: 'task', title: 'bad', error: 'routing_map_scope_unresolved' });
    expect(out.tasks.map((t) => t.title)).toEqual(['good']);
  });
});

describe('ensureHandoffOnComplete', () => {
  it('已有 handoff → 原样返回，不写库', async () => {
    const pool = { query: vi.fn() };
    const r = await ensureHandoffOnComplete(pool, { id: SELF, result: { handoff: { schema_version: 1, done: ['a'] } } });
    expect(r.synthesized).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('没有 → 合成 synthesized=true，done 取 result.summary，落 saveHandoff', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })) };
    const r = await ensureHandoffOnComplete(pool, { id: SELF, title: '退役旧网关', result: { summary: '容器删了' } }, { sessionId: 's9' });
    expect(r.synthesized).toBe(true);
    expect(r.handoff.done).toEqual(['容器删了']);
    expect(r.handoff.synthesized).toBe(true);
    expect(r.handoff.session_id).toBe('s9');
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql) && /handoff_log/.test(sql))).toBe(true);
  });
});

describe('relayOnComplete', () => {
  it('任务非 completed → null 且不合成', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: SELF, status: 'in_progress', result: null }] })) };
    expect(await relayOnComplete(pool, SELF)).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('查库抛错 → null（不阻塞 PATCH）', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('boom'); }) };
    expect(await relayOnComplete(pool, SELF)).toBeNull();
  });
});
