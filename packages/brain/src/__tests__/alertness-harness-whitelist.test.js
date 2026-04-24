/**
 * alertness-harness-whitelist.test.js
 *
 * 回归测试：pauseLowPriorityTasks 的 task_type 白名单必须排除 harness_* 全家桶。
 *
 * 背景（2026-04-22 真机事故）：
 *   harness_task 子任务曾默认 priority='P2'，被 alertness 误 pause。
 *   主修复是把默认 priority 改成 'P0'（见 harness-dag-upsert-priority.test.js），
 *   此处在 task_type 层再加一道白名单，防止未来有人改回 P2 再次踩坑。
 *
 * 覆盖 task_type：
 *   harness_initiative / harness_task / harness_planner
 *   harness_contract_propose / harness_contract_review
 *   harness_generate / harness_evaluate / harness_fix
 *   harness_ci_watch / harness_deploy_watch / harness_report
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { connect: mockConnect },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn(),
}));

let executeResponse;

describe('pauseLowPriorityTasks — harness_* 全家桶白名单', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRelease.mockImplementation(() => {});
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });

    vi.resetModules();
    vi.mock('../db.js', () => ({ default: { connect: mockConnect } }));
    vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));

    const mod = await import('../alertness/escalation.js');
    executeResponse = mod.executeResponse;
  });

  it('UPDATE SQL 白名单含 harness_task', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });

    // 第一次 query 是 UPDATE tasks ...（pauseLowPriorityTasks），
    // 第二次及之后可能是 recordEscalation/updateEscalationActions
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
    expect(updateCall).toBeDefined();
    const [sql] = updateCall;
    expect(sql).toMatch(/'harness_task'/);
  });

  it('UPDATE SQL 白名单含 harness_initiative', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
    expect(updateCall[0]).toMatch(/'harness_initiative'/);
  });

  it('UPDATE SQL 白名单含 harness_planner / contract / generate / evaluate', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
    const sql = updateCall[0];
    expect(sql).toMatch(/'harness_planner'/);
    expect(sql).toMatch(/'harness_contract_propose'/);
    expect(sql).toMatch(/'harness_contract_review'/);
    expect(sql).toMatch(/'harness_generate'/);
    expect(sql).toMatch(/'harness_evaluate'/);
    expect(sql).toMatch(/'harness_fix'/);
  });

  it('UPDATE SQL 白名单含 harness_ci_watch / deploy_watch / report', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
    const sql = updateCall[0];
    expect(sql).toMatch(/'harness_ci_watch'/);
    expect(sql).toMatch(/'harness_deploy_watch'/);
    expect(sql).toMatch(/'harness_report'/);
  });

  it('UPDATE SQL 仍保留既有白名单（sprint_* / content-* 不被本次改动破坏）', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
    const sql = updateCall[0];
    expect(sql).toMatch(/'sprint_planner'/);
    expect(sql).toMatch(/'content-pipeline'/);
    expect(sql).toMatch(/'arch_review'/);
  });
});
