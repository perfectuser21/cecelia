/**
 * runSubTaskNode sub-graph 失败诊断
 *
 * 背景：generator(sub-graph) invoke 抛错时，runSubTaskNode 的 catch 只设
 * `final = { status:'failed', error }`，既不 console.error、也不把 error 透到 sub_task
 * 返回 → sub_task 干净地 failed 但「零诊断」（实证 de4b2668：generator 没出 PR、ws_issues 空、
 * 日志查不到失败原因）。本测试要求：失败必须可观测（日志 + sub_task.evaluator_feedback）。
 *
 * SC: sub-graph invoke throw → sub_task.status=failed 且 evaluator_feedback 含错误信息 + console.error 记录
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { runSubTaskNode } from '../harness-initiative.graph.js';

const baseState = {
  initiativeId: 'init-diag',
  task: { id: 'ti-diag', payload: {} },
  sub_task: { id: 'ws1', title: 'T', description: 'D', payload: { dod: [], files: [] } },
  task_loop_fix_count: 0,
  final_e2e_fix_count: 0,
};

describe('runSubTaskNode sub-graph 失败诊断', () => {
  it('sub-graph invoke 抛错 → sub_task failed 且 evaluator_feedback 含错误（不再吞诊断）', async () => {
    const fakeCompiled = { invoke: async () => { throw new Error('boom-generator-spawn'); } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await runSubTaskNode(baseState, { compiledTaskGraph: fakeCompiled, waitMs: 0 });
    errSpy.mockRestore();
    const st = out.sub_tasks[0];
    expect(st.status).toBe('failed');
    expect(String(st.evaluator_feedback || '')).toContain('boom-generator-spawn');
  });

  it('console.error 记录 sub-graph 失败（含 message）', async () => {
    const fakeCompiled = { invoke: async () => { throw new Error('boom-xyz-diag'); } };
    const calls = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => calls.push(a.map(String).join(' ')));
    await runSubTaskNode(baseState, { compiledTaskGraph: fakeCompiled, waitMs: 0 });
    errSpy.mockRestore();
    expect(calls.some((c) => /sub.?graph|runSubTaskNode/i.test(c) && /boom-xyz-diag/.test(c))).toBe(true);
  });
});
