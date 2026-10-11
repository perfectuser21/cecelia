/**
 * handoff 下一步四类 + 有头续接（主理人 2026-10-11 决策）
 *  四类：resume_headed（有头续接，不派发）/ dispatch_headless（无头派发，≡旧 task）/ decision / note
 *  默认：有头任务未标/认不出 → resume_headed；无头任务未标/认不出 → note（不误派）
 *  「完成，无下一步」类占位一律 note
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn(async () => null) }));
vi.mock('../project-brief-apply.js', () => ({ applyHandoffBriefDelta: vi.fn(async () => null) }));

import {
  NEXT_STEP_KINDS,
  classifyNextSteps,
  normalizeNextSteps,
  isHeadedTask,
  materializeNextSteps,
  prepareHandoffForWrite,
} from '../relay-baton.js';

const SELF = '33333333-3333-4333-8333-333333333333';
const headedTask = { id: SELF, title: '有头会话任务', priority: 'P1', task_type: 'dev', executor_kind: 'headed-session', parent_task_id: null, payload: { headed_manual: 'true', repo: 'cecelia' } };
const headlessTask = { id: SELF, title: '无头任务', priority: 'P2', task_type: 'data', executor_kind: 'bridge', parent_task_id: null, payload: {} };

describe('NEXT_STEP_KINDS', () => {
  it('四类正式名', () => {
    expect(NEXT_STEP_KINDS).toEqual(['resume_headed', 'dispatch_headless', 'decision', 'note']);
  });
});

describe('isHeadedTask', () => {
  it('payload.headed_manual（布尔/字符串）或 executor_kind=headed-session 或 headed_takeover → 有头', () => {
    expect(isHeadedTask({ payload: { headed_manual: true } })).toBe(true);
    expect(isHeadedTask({ payload: { headed_manual: 'true' } })).toBe(true);
    expect(isHeadedTask({ executor_kind: 'headed-session', payload: {} })).toBe(true);
    expect(isHeadedTask({ payload: { headed_takeover: { session_id: 's' } } })).toBe(true);
  });
  it('trigger_source=manual 不算有头（notion 秋米无头单也写 manual）', () => {
    expect(isHeadedTask({ trigger_source: 'manual', executor_kind: 'openclaw-agent', payload: {} })).toBe(false);
    expect(isHeadedTask({ payload: { headed_manual: 'false' } })).toBe(false);
    expect(isHeadedTask(null)).toBe(false);
  });
});

describe('classifyNextSteps', () => {
  it('有头：未标→resume_headed，task→dispatch_headless，认不出→resume_headed 并反馈，占位→note', () => {
    const { steps, feedback } = classifyNextSteps([
      '接着把 B 做完',
      { title: '对象未标 kind' },
      { kind: 'task', title: '旧值 task' },
      { kind: 'dispatch_headless', title: '无头派' },
      { kind: 'resume_headed', title: '有头续' },
      { kind: 'weird', title: '认不出' },
      { kind: 'done', title: '旧值 done' },
      '完成，无下一步',
    ], { headed: true });
    expect(steps.map((s) => s.kind)).toEqual([
      'resume_headed', 'resume_headed', 'dispatch_headless', 'dispatch_headless', 'resume_headed', 'resume_headed', 'note', 'note',
    ]);
    expect(feedback).toEqual([
      { index: 0, title: '接着把 B 做完', given_kind: null, kind: 'resume_headed', reason: 'unmarked' },
      { index: 1, title: '对象未标 kind', given_kind: null, kind: 'resume_headed', reason: 'unmarked' },
      { index: 2, title: '旧值 task', given_kind: 'task', kind: 'dispatch_headless', reason: 'alias' },
      { index: 5, title: '认不出', given_kind: 'weird', kind: 'resume_headed', reason: 'unrecognized' },
      { index: 6, title: '旧值 done', given_kind: 'done', kind: 'note', reason: 'alias' },
      { index: 7, title: '完成，无下一步', given_kind: null, kind: 'note', reason: 'placeholder' },
    ]);
  });
  it('无头：未标/认不出→note（不误派）', () => {
    const { steps, feedback } = classifyNextSteps(['随便写写', { kind: 'weird', title: 'x' }], { headed: false });
    expect(steps.map((s) => s.kind)).toEqual(['note', 'note']);
    expect(feedback.map((f) => f.reason)).toEqual(['unmarked', 'unrecognized']);
  });
  it('normalizeNextSteps 兼容旧签名（默认无头）', () => {
    expect(normalizeNextSteps(['a', { kind: 'task', title: 'b' }])).toEqual([
      { kind: 'note', title: 'a' },
      { kind: 'dispatch_headless', title: 'b' },
    ]);
  });
});

describe('prepareHandoffForWrite', () => {
  it('把 next_steps 规范成带 kind 的对象，并返回反馈（被当成什么）', () => {
    const { handoff, feedback } = prepareHandoffForWrite(headedTask, { title: 't', next_steps: ['续做', { kind: 'zzz', title: 'q' }] });
    expect(handoff.next_steps).toEqual([
      { kind: 'resume_headed', title: '续做' },
      { kind: 'resume_headed', title: 'q' },
    ]);
    expect(feedback.headed).toBe(true);
    expect(feedback.coerced.map((c) => [c.index, c.kind, c.reason])).toEqual([[0, 'resume_headed', 'unmarked'], [1, 'resume_headed', 'unrecognized']]);
    expect(feedback.unrecognized).toEqual([{ index: 1, title: 'q', given_kind: 'zzz', kind: 'resume_headed', reason: 'unrecognized' }]);
  });
  it('handoff 不是对象 → 原样返回，feedback=null', () => {
    expect(prepareHandoffForWrite(headedTask, null)).toEqual({ handoff: null, feedback: null });
  });
});

describe('materializeNextSteps — 有头续接', () => {
  it('有头任务：resume_headed 不派单、原任务挂 pending_resume；dispatch_headless 照建 queued 子任务', async () => {
    const created = [];
    const create = vi.fn(async (_p, req) => { created.push(req); return { task: { id: 'child-1', title: req.title } }; });
    const updates = [];
    const pool = { query: vi.fn(async (sql, params) => {
      if (/pending_resume/.test(sql) && /SELECT/.test(sql) && !/UPDATE/.test(sql)) return { rows: [{ pending_resume: null }] };
      if (/UPDATE tasks/.test(sql) && /pending_resume/.test(sql)) { updates.push(params); return { rowCount: 1, rows: [] }; }
      return { rows: [] };
    }) };
    const out = await materializeNextSteps(pool, headedTask, {
      created_at: '2026-10-11T00:00:00.000Z',
      next_steps: [{ kind: 'resume_headed', title: '有头接着做 X', detail: '上下文' }, { kind: 'dispatch_headless', title: '无头做 Y' }],
    }, { createRoutedTask: create });
    expect(created.map((c) => c.title)).toEqual(['无头做 Y']);
    expect(created[0].source_id).toBe(`handoff:${SELF}:1`);
    expect(out.tasks).toEqual([{ id: 'child-1', title: '无头做 Y', reused: false }]);
    expect(out.resume).toEqual([{ index: 0, title: '有头接着做 X' }]);
    expect(updates).toHaveLength(1);
    const marker = JSON.parse(updates[0][1]);
    expect(marker).toMatchObject({ status: 'pending', handoff_created_at: '2026-10-11T00:00:00.000Z', items: [{ index: 0, title: '有头接着做 X', detail: '上下文' }] });
    expect(updates[0][0]).toBe(SELF);
  });
  it('有头任务未标 kind 的字符串 → 默认 resume_headed（不派单）', async () => {
    const create = vi.fn();
    const pool = { query: vi.fn(async (sql) => (/SELECT/.test(sql) && !/UPDATE/.test(sql) ? { rows: [{ pending_resume: null }] } : { rowCount: 1, rows: [] })) };
    const out = await materializeNextSteps(pool, headedTask, { next_steps: ['下一步继续'] }, { createRoutedTask: create });
    expect(create).not.toHaveBeenCalled();
    expect(out.resume).toEqual([{ index: 0, title: '下一步继续' }]);
  });
  it('同一份 handoff 重放 → 已有 pending_resume（同 created_at）不覆盖（ack 状态不丢）', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (/SELECT/.test(sql) && !/UPDATE/.test(sql)) return { rows: [{ pending_resume: { status: 'resumed', handoff_created_at: 'T1' } }] };
      return { rowCount: 1, rows: [] };
    }) };
    await materializeNextSteps(pool, headedTask, { created_at: 'T1', next_steps: [{ kind: 'resume_headed', title: 'a' }] });
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
  });
  it('无头任务未标 kind 的字符串 → note，不派单不挂待续', async () => {
    const create = vi.fn();
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const out = await materializeNextSteps(pool, headlessTask, { next_steps: ['随手备注'] }, { createRoutedTask: create });
    expect(create).not.toHaveBeenCalled();
    expect(out.resume).toEqual([]);
    expect(out.skipped).toEqual([{ index: 0, kind: 'note', title: '随手备注', error: null }]);
  });
});
