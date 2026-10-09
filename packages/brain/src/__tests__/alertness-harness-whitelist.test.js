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
 *
 * Task 4 改造（qiumi_task PR1 地基）：白名单不再手抄进 SQL 字符串，改注册表派生
 * ESCALATION_EXEMPT_TASK_TYPES 作为运行时参数 $4 绑定（见 alertness/escalation.js
 * buildPauseLowPriorityQuery）。静态文本断言只能证明 SQL 长得像
 * `AND NOT (task_type = ANY($4::text[]))`，证明不了绑的是哪个数组——同
 * device-job-foundation.test.js 闸2 的手法，改断言真实绑定的 params[3]。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ESCALATION_EXEMPT_TASK_TYPES } from '../lib/task-type-registry.js';

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

  // 第一次 query 是 UPDATE tasks ...（pauseLowPriorityTasks），
  // 第二次及之后可能是 recordEscalation/updateEscalationActions
  function findUpdateCall() {
    return mockQuery.mock.calls.find(
      ([sql]) => /UPDATE\s+tasks/i.test(sql) && /status\s*=\s*'paused'/i.test(sql)
    );
  }

  it('UPDATE SQL 含运行时排除闸 AND NOT (task_type = ANY($4::text[]))，绑定值严格等于 ESCALATION_EXEMPT_TASK_TYPES', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });

    const updateCall = findUpdateCall();
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall;
    expect(sql).toMatch(/AND NOT \(task_type = ANY\(\$4::text\[\]\)\)/);
    expect(params[3]).toEqual(ESCALATION_EXEMPT_TASK_TYPES);
  });

  it('白名单含 harness_task / harness_initiative（真机事故本体）', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const [, params] = findUpdateCall();
    expect(params[3]).toContain('harness_task');
    expect(params[3]).toContain('harness_initiative');
  });

  it('白名单含 harness_planner / contract / generate / evaluate / fix', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const [, params] = findUpdateCall();
    expect(params[3]).toContain('harness_planner');
    expect(params[3]).toContain('harness_contract_propose');
    expect(params[3]).toContain('harness_contract_review');
    expect(params[3]).toContain('harness_generate');
    expect(params[3]).toContain('harness_evaluate');
    expect(params[3]).toContain('harness_fix');
  });

  it('白名单含 harness_ci_watch / deploy_watch / report', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const [, params] = findUpdateCall();
    expect(params[3]).toContain('harness_ci_watch');
    expect(params[3]).toContain('harness_deploy_watch');
    expect(params[3]).toContain('harness_report');
  });

  it('仍保留既有白名单（sprint_* / content-* 不被本次改动破坏）', async () => {
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }],
    });
    const [, params] = findUpdateCall();
    expect(params[3]).toContain('sprint_planner');
    expect(params[3]).toContain('content-pipeline');
    expect(params[3]).toContain('arch_review');
  });
});
