/**
 * project-brief-apply.js 单测（mock pool/client + 协作方）。
 * 真库集成场景（handoff → relayOnComplete → projects.brief 全链）见
 * __tests__/integration/project-brief-apply.pg.integration.test.js。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createRoutedTaskMock = vi.fn();
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: (...args) => createRoutedTaskMock(...args) }));

const enqueueDangerousActionMock = vi.fn();
vi.mock('../../decision-executor.js', () => ({ enqueueDangerousAction: (...args) => enqueueDangerousActionMock(...args) }));

const sendBarkMock = vi.fn(async () => true);
vi.mock('../../notifier.js', () => ({ sendBark: (...args) => sendBarkMock(...args) }));

import { applyProjectBriefDelta, applyHandoffBriefDelta, applyApprovedBriefEscalation, ESCALATE_CANCEL_THRESHOLD } from '../project-brief-apply.js';

const PROJECT_ID = '66666666-6666-4666-8666-666666666666';
const TASK_ID = '33333333-3333-4333-8333-333333333333';

/** 造一个假 pool：connect() 返回一个记录了所有 query 调用的 client。 */
function fakePool({ projectRow = { id: PROJECT_ID, name: '获客链', brief: {} }, extraHandlers = [] } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push([sql, params]);
      for (const h of extraHandlers) {
        const r = h(sql, params);
        if (r !== undefined) return r;
      }
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql.trim())) return { rows: [] };
      if (/SELECT id, name, brief FROM projects/.test(sql)) {
        return projectRow ? { rows: [projectRow] } : { rows: [] };
      }
      if (/UPDATE projects SET brief/.test(sql)) return { rows: [] };
      if (/UPDATE tasks SET status = 'cancelled'/.test(sql)) return { rows: [] };
      if (/UPDATE tasks SET sequence_no/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (/COALESCE\(MAX\(sequence_no\), 0\)/.test(sql)) return { rows: [{ n: 2 }] };
      return { rows: [] };
    }),
  };
  return { pool, client, calls };
}

beforeEach(() => {
  createRoutedTaskMock.mockReset();
  createRoutedTaskMock.mockImplementation(async (_pool, req) => ({ task: { id: `t-${req.title}`, title: req.title } }));
  enqueueDangerousActionMock.mockReset();
  enqueueDangerousActionMock.mockImplementation(async () => ({ success: true, pending_approval: true, pending_action_id: 'pa-1' }));
  sendBarkMock.mockClear();
});

describe('applyProjectBriefDelta — 输入判定', () => {
  it('delta 清洗后为空 → null，不碰库', async () => {
    const { pool } = fakePool();
    const out = await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: {} });
    expect(out).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('projectId 查无此行 → null', async () => {
    const { pool } = fakePool({ projectRow: null });
    const out = await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { status: 'x' } });
    expect(out).toBeNull();
  });
});

describe('applyProjectBriefDelta — C 档直接生效', () => {
  it('status/add_facts 直接写回 brief，不升档', async () => {
    const { pool, client } = fakePool({ projectRow: { id: PROJECT_ID, name: '获客链', brief: { goal: '', status: '', facts: [], open_questions: [], changelog: [] } } });
    const out = await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { status: '新现状', add_facts: ['f1'] }, taskId: TASK_ID });
    expect(out.applied).toBe(true);
    expect(out.escalated).toBe(false);
    expect(out.pending_action_id).toBeNull();
    expect(out.brief.status).toBe('新现状');
    expect(out.brief.facts).toEqual(['f1']);
    expect(enqueueDangerousActionMock).not.toHaveBeenCalled();
    const updateCall = client.query.mock.calls.find(([sql]) => /UPDATE projects SET brief/.test(sql));
    expect(updateCall).toBeTruthy();
  });

  it('cancel_steps < 阈值 → 直接砍（UPDATE status=cancelled，只影响 queued）', async () => {
    const { pool, client } = fakePool();
    const out = await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { cancel_steps: ['task-a', 'task-b'] }, taskId: TASK_ID });
    expect(out.escalated).toBe(false);
    const cancelCall = client.query.mock.calls.find(([sql]) => /UPDATE tasks SET status = 'cancelled'/.test(sql));
    expect(cancelCall).toBeTruthy();
    expect(cancelCall[1]).toEqual([PROJECT_ID, ['task-a', 'task-b']]);
  });

  it('add_steps → createRoutedTask 建单，继承 project_id + sequence_no=max+1 递增', async () => {
    const { pool } = fakePool();
    await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { add_steps: [{ title: 'S1' }, { title: 'S2' }] }, taskId: TASK_ID });
    expect(createRoutedTaskMock).toHaveBeenCalledTimes(2);
    expect(createRoutedTaskMock.mock.calls[0][1]).toMatchObject({ task: { project_id: PROJECT_ID, sequence_no: 3 } });
    expect(createRoutedTaskMock.mock.calls[1][1]).toMatchObject({ task: { project_id: PROJECT_ID, sequence_no: 4 } });
  });

  it('reorder → 只更新 UPDATE tasks SET sequence_no', async () => {
    const { pool, client } = fakePool();
    await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { reorder: ['task-a', 'task-b'] }, taskId: TASK_ID });
    const reorderCalls = client.query.mock.calls.filter(([sql]) => /UPDATE tasks SET sequence_no/.test(sql));
    expect(reorderCalls).toHaveLength(2);
  });
});

describe('applyProjectBriefDelta — A 档升级（决策 105a5868）', () => {
  it('改 goal → 不直接生效，升档写 pending_action + Bark', async () => {
    const { pool, client } = fakePool({ projectRow: { id: PROJECT_ID, name: '获客链', brief: { goal: '旧目标', status: '', facts: [], open_questions: [], changelog: [] } } });
    const out = await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { goal: '新目标', status: '顺带改的现状' }, taskId: TASK_ID });
    expect(out.escalated).toBe(true);
    expect(out.pending_action_id).toBe('pa-1');
    expect(out.brief.goal).toBe('旧目标'); // 没变
    expect(out.brief.status).toBe('顺带改的现状'); // 非升档字段照常生效
    expect(enqueueDangerousActionMock).toHaveBeenCalledTimes(1);
    const [action, context] = enqueueDangerousActionMock.mock.calls[0];
    expect(action.type).toBe('project_brief_decision');
    expect(action.params.escalated).toEqual({ goal: '新目标' });
    expect(context.waiting_on).toBe('human');
    expect(context.options.length).toBeGreaterThanOrEqual(2);
    expect(sendBarkMock).toHaveBeenCalledTimes(1);
  });

  it(`cancel_steps ≥ ${ESCALATE_CANCEL_THRESHOLD} 条 → 整批升档，不直接砍`, async () => {
    const { pool, client } = fakePool();
    const ids = ['t1', 't2', 't3'];
    const out = await applyProjectBriefDelta(pool, { projectId: PROJECT_ID, rawDelta: { cancel_steps: ids }, taskId: TASK_ID });
    expect(out.escalated).toBe(true);
    const cancelCall = client.query.mock.calls.find(([sql]) => /UPDATE tasks SET status = 'cancelled'/.test(sql));
    expect(cancelCall).toBeUndefined();
    expect(enqueueDangerousActionMock).toHaveBeenCalledTimes(1);
    expect(enqueueDangerousActionMock.mock.calls[0][0].params.escalated.cancel_steps).toEqual(ids);
  });

  it('force:true（批准回调）→ 跳过升档，goal 直接生效', async () => {
    const { pool } = fakePool({ projectRow: { id: PROJECT_ID, name: '获客链', brief: { goal: '旧目标', status: '', facts: [], open_questions: [], changelog: [] } } });
    const out = await applyApprovedBriefEscalation(pool, { projectId: PROJECT_ID, escalated: { goal: '新目标' }, taskId: TASK_ID });
    expect(out.escalated).toBe(false);
    expect(out.brief.goal).toBe('新目标');
    expect(enqueueDangerousActionMock).not.toHaveBeenCalled();
  });
});

describe('applyHandoffBriefDelta', () => {
  it('task 无 project_id → 不查库，返回 null', async () => {
    const { pool } = fakePool();
    const out = await applyHandoffBriefDelta(pool, { id: TASK_ID, project_id: null }, { brief_delta: { status: 'x' } });
    expect(out).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('handoff 无 brief_delta → 不查库，返回 null', async () => {
    const { pool } = fakePool();
    const out = await applyHandoffBriefDelta(pool, { id: TASK_ID, project_id: PROJECT_ID }, { done: ['x'] });
    expect(out).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('task 有 project_id 且 handoff 带 brief_delta → 应用', async () => {
    const { pool } = fakePool();
    const out = await applyHandoffBriefDelta(pool, { id: TASK_ID, project_id: PROJECT_ID }, { brief_delta: { status: '来自 handoff' } });
    expect(out.applied).toBe(true);
    expect(out.brief.status).toBe('来自 handoff');
  });
});
