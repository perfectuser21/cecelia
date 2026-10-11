/**
 * 有头会话收尾：会话结束（捕获时判定闲置≥15min）→ 摘要并入关联任务 handoff；
 * 无关联任务 → 补建一张 completed 账本任务挂摘要。确保「有头做过的事 Brain 都知道」。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  attachHeadedSession,
  resolveHeadedResumeKind,
  buildLedgerTaskRequest,
  HEADED_SOURCE_ID_PREFIX,
} from '../headed-session-handoff.js';

const SID = '378b2dc0-0037-4bbf-8755-f9a5e5d8ec51';
const TID = 'c8b27bc5-dd78-4139-aaf8-4060ff11c6bf';

function session(over = {}) {
  return {
    sessionId: SID,
    source: 'conversation-claude',
    repo: '-Users-administrator-perfect21-cecelia',
    turns: [{ text: '修对话捕获' }],
    entrypoint: 'cli',
    linkedTaskIds: [],
    ...over,
  };
}

function poolWithTasks(tasks) {
  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('FROM tasks WHERE id = ANY')) {
        return { rows: tasks.filter((t) => params[0].includes(t.id)) };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

describe('resolveHeadedResumeKind（B 项 resume_headed 适配点）', () => {
  it('B 未合并（kinds 无 resume_headed）→ note', () => {
    expect(resolveHeadedResumeKind(['task', 'decision', 'done', 'note'])).toBe('note');
  });
  it('B 合并后（kinds 含 resume_headed）→ resume_headed', () => {
    expect(resolveHeadedResumeKind(['task', 'decision', 'done', 'note', 'resume_headed'])).toBe('resume_headed');
  });
});

describe('attachHeadedSession', () => {
  it('关联任务无 handoff 且未完成 → 新建 handoff：done=摘要，next_steps=有头续接，带 session_id', async () => {
    const pool = poolWithTasks([{ id: TID, title: '修对话捕获', status: 'in_progress', result: null }]);
    const saveHandoff = vi.fn(async () => ({ dbWritten: true }));
    const createRoutedTask = vi.fn();
    const r = await attachHeadedSession(pool, { session: session({ linkedTaskIds: [TID] }), summary: '1. 修对话捕获\n2. 有头收尾' }, {
      saveHandoff, createRoutedTask, nextStepKinds: ['task', 'decision', 'done', 'note'],
    });
    expect(r).toEqual({ linked: [TID], created: null, unchanged: [] });
    expect(createRoutedTask).not.toHaveBeenCalled();
    const h = saveHandoff.mock.calls[0][1];
    expect(h.task_id).toBe(TID);
    expect(h.session_id).toBe(SID);
    expect(h.done.join('\n')).toContain('修对话捕获');
    expect(h.headed_sessions).toEqual([expect.objectContaining({ session_id: SID, summary: '1. 修对话捕获\n2. 有头收尾' })]);
    expect(h.next_steps).toEqual([expect.objectContaining({ kind: 'note' })]);
    expect(h.next_steps[0].title).toMatch(/有头续接/);
  });

  it('关联任务已有真 handoff → 合并保留原内容，不覆盖；已完成任务不加续接步', async () => {
    const existing = {
      schema_version: 1, task_id: TID, title: 'x', verdict: 'PASS',
      done: ['PR #1 合并'], not_done: [], next_steps: [{ kind: 'task', title: '下一棒' }],
      data_sources: ['a'], decision_refs: [], artifacts: { pr_urls: ['https://pr/1'], sprint_dir: null, branch: null, docs: [] },
      created_at: '2026-10-11T00:00:00.000Z',
    };
    const pool = poolWithTasks([{ id: TID, title: 'x', status: 'completed', result: { handoff: existing } }]);
    const saveHandoff = vi.fn(async () => ({}));
    await attachHeadedSession(pool, { session: session({ linkedTaskIds: [TID] }), summary: '1. 收尾' }, { saveHandoff, createRoutedTask: vi.fn(), nextStepKinds: ['note'] });
    const h = saveHandoff.mock.calls[0][1];
    expect(h.done[0]).toBe('PR #1 合并');
    expect(h.done.at(-1)).toContain('收尾');
    expect(h.next_steps).toEqual([{ kind: 'task', title: '下一棒' }]);
    expect(h.artifacts.pr_urls).toEqual(['https://pr/1']);
    expect(h.created_at).toBe(existing.created_at);
    expect(h.headed_sessions).toHaveLength(1);
  });

  it('同一会话同一摘要已并入过 → 幂等不重写', async () => {
    const existing = {
      schema_version: 1, task_id: TID, done: [], not_done: [], next_steps: [], data_sources: [], decision_refs: [],
      artifacts: { pr_urls: [], docs: [] }, created_at: 'x',
      headed_sessions: [{ session_id: SID, summary: '1. 收尾', captured_at: 'y' }],
    };
    const pool = poolWithTasks([{ id: TID, title: 'x', status: 'completed', result: { handoff: existing } }]);
    const saveHandoff = vi.fn();
    const r = await attachHeadedSession(pool, { session: session({ linkedTaskIds: [TID] }), summary: '1. 收尾' }, { saveHandoff, createRoutedTask: vi.fn(), nextStepKinds: ['note'] });
    expect(saveHandoff).not.toHaveBeenCalled();
    expect(r.unchanged).toEqual([TID]);
  });

  it('provenance 登记的 task_id 也算关联；查无此任务的 id 忽略', async () => {
    const pool = poolWithTasks([{ id: TID, title: 'x', status: 'queued', result: {} }]);
    const saveHandoff = vi.fn(async () => ({}));
    const r = await attachHeadedSession(pool, {
      session: session({ linkedTaskIds: ['00000000-0000-4000-8000-000000000000'] }), summary: '1. a', provenanceTaskId: TID,
    }, { saveHandoff, createRoutedTask: vi.fn(), nextStepKinds: ['note'] });
    expect(r.linked).toEqual([TID]);
  });

  it('无任何关联任务 → 补建 completed 账本任务（source=conversation，source_id 幂等）并写 handoff', async () => {
    const pool = poolWithTasks([]);
    const createRoutedTask = vi.fn(async () => ({ task: { id: 'new-ledger', title: 't', status: 'completed', result: null }, deduplicated: false }));
    const saveHandoff = vi.fn(async () => ({}));
    const r = await attachHeadedSession(pool, { session: session(), summary: '1. 盘点派发总闸\n2. 修捕获' }, { saveHandoff, createRoutedTask, nextStepKinds: ['note'] });
    expect(r.created).toBe('new-ledger');
    const req = createRoutedTask.mock.calls[0][1];
    expect(req).toMatchObject({
      source: 'conversation',
      source_id: `${HEADED_SOURCE_ID_PREFIX}${SID}`,
      mutation_intent: 'none',
      task: { status: 'completed' },
    });
    expect(req.metadata).toMatchObject({ ledger_only: true, headed_session_id: SID });
    expect(req.title).toContain('盘点派发总闸');
    const h = saveHandoff.mock.calls[0][1];
    expect(h.task_id).toBe('new-ledger');
    expect(h.next_steps).toEqual([]);
  });

  it('账本任务已建过（deduplicated）且摘要相同 → 不重写 handoff', async () => {
    const pool = poolWithTasks([]);
    const createRoutedTask = vi.fn(async () => ({
      task: { id: 'old', status: 'completed', result: { handoff: { schema_version: 1, done: [], next_steps: [], artifacts: {}, headed_sessions: [{ session_id: SID, summary: '1. a' }] } } },
      deduplicated: true,
    }));
    const saveHandoff = vi.fn();
    const r = await attachHeadedSession(pool, { session: session(), summary: '1. a' }, { saveHandoff, createRoutedTask, nextStepKinds: ['note'] });
    expect(saveHandoff).not.toHaveBeenCalled();
    expect(r.created).toBeNull();
    expect(r.unchanged).toEqual(['old']);
  });

  it('buildLedgerTaskRequest：标题取首条话题，无摘要时取原文首句', () => {
    expect(buildLedgerTaskRequest(session(), '1. 话题甲\n2. 话题乙').title).toBe('有头会话：话题甲');
    expect(buildLedgerTaskRequest(session(), null).title).toBe('有头会话：修对话捕获');
  });
});
