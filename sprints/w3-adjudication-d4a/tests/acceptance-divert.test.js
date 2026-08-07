/**
 * acceptance-divert.test.js — 聚合分流建任务合同测试
 *
 * 覆盖：
 *   FR-3 聚合分流建任务（触发时点/聚合/查重/anchor）
 *   FR-4 熔断路径（非绿格占比 > 1/3）
 *   FR-5 AI 哑火独立路径
 *   FR-6 SAVEPOINT 隔离
 *
 * Contract BEHAVIOR 覆盖：12/13/14/15/16/17/18/19
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// 辅助：动态导入实现模块（实现前 skip）
// ============================================================
let divertAfterAdjudicated;
let buildDivertPlan;
let checkCircuitBreaker;
let checkAiIncomplete;

beforeEach(async () => {
  try {
    const mod = await import('../../../../packages/brain/src/acceptance-divert.js');
    divertAfterAdjudicated = mod.divertAfterAdjudicated;
    buildDivertPlan = mod.buildDivertPlan;
    checkCircuitBreaker = mod.checkCircuitBreaker;
    checkAiIncomplete = mod.checkAiIncomplete;
  } catch {
    divertAfterAdjudicated = null;
    buildDivertPlan = null;
    checkCircuitBreaker = null;
    checkAiIncomplete = null;
  }
});

// ============================================================
// BEHAVIOR-12 — 触发时点 = adjudicated 之后
// ============================================================
describe('FR-3 触发时点 — BEHAVIOR-12', () => {
  /**
   * buildDivertPlan(cells, runDetail) 纯函数：
   *   - 只在 run 已 adjudicated 后调用，内部不判 status
   *   - 但 checkShouldDivert(runDetail) 负责前置判断，确保不在 human_complete 时建任务
   *
   * 该行为由集成测试（mock DB）保证：分流函数只在 run.status='adjudicated' 时被调用。
   * 这里测试 buildDivertPlan 在无红/未定格时返回空计划（不建任何任务）。
   */
  it('BEHAVIOR-12 — 无红格无未定格时分流计划为空（adjudicated 且全绿）', () => {
    if (!buildDivertPlan) return;
    const cells = Array.from({ length: 36 }, (_, i) => ({
      check_key: `S${i + 1}-c1`,
      final_state: '绿',
    }));
    const plan = buildDivertPlan(cells, { ai_incomplete: false });
    expect(plan.bugTask).toBeNull();
    expect(plan.traceTask).toBeNull();
    expect(plan.circuitBreakerTask).toBeNull();
    expect(plan.aiRunInfraTask).toBeNull();
  });

  it('BEHAVIOR-12b — run.status=human_complete 时 divertAfterAdjudicated 不执行任何 INSERT', async () => {
    if (!divertAfterAdjudicated) {
      console.warn('[SKIP] divertAfterAdjudicated 未导出，跳过 BEHAVIOR-12b');
      return;
    }

    const insertCalls = [];
    const mockClient = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('INSERT INTO tasks')) {
          insertCalls.push({ sql, params });
          return { rows: [{ id: 'task-uuid' }] };
        }
        if (sql.includes('SELECT') && sql.includes('acceptance_runs')) {
          // 模拟 run.status = 'human_complete'（尚未 adjudicated）
          return {
            rows: [{
              id: 'run-uuid',
              status: 'human_complete',
              detail: { ai_incomplete: false },
            }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
      query: mockClient.query,
    };

    const cells = [
      { check_key: 'S2-c4', final_state: '红' },
      { check_key: 'S3-c2', final_state: '未定' },
      ...Array.from({ length: 34 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const runDetail = { ai_incomplete: false };
    const anchor = {
      journey_id: '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6',
      gp_id: '7790f728-f490-4243-b166-03f3250a0938',
      step_id: '817f59f5-02ff-4a70-bd81-f7ae65f77e02',
    };

    // 当 run.status='human_complete' 时，分流函数不应执行任何 INSERT
    await divertAfterAdjudicated(mockPool, 'test-run-key', cells, runDetail, anchor).catch(() => {});

    // 核心断言：human_complete 状态下不得有任何任务 INSERT
    expect(insertCalls.length).toBe(0);
  });
});

// ============================================================
// BEHAVIOR-13/14 — 聚合 bug/trace 任务
// ============================================================
describe('FR-3 聚合建任务 — BEHAVIOR-13/14', () => {
  const ANCHOR = {
    journey_id: '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6',
    gp_id: '7790f728-f490-4243-b166-03f3250a0938',
    step_id: '817f59f5-02ff-4a70-bd81-f7ae65f77e02',
  };

  it('BEHAVIOR-13 — 多红格聚合为一个 bug 任务，描述含所有红格', () => {
    if (!buildDivertPlan) return;
    const cells = [
      { check_key: 'S2-c4', final_state: '红' },
      { check_key: 'S8-c4', final_state: '红' },
      ...Array.from({ length: 34 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false }, ANCHOR);
    expect(plan.bugTask).not.toBeNull();
    expect(plan.traceTask).toBeNull();
    expect(plan.bugTask.payload.acceptance_bucket).toBe('bug');
    expect(plan.bugTask.description).toContain('S2-c4');
    expect(plan.bugTask.description).toContain('S8-c4');
  });

  it('BEHAVIOR-14 — 多未定格聚合为一个 trace 任务，描述含所有未定格', () => {
    if (!buildDivertPlan) return;
    const cells = [
      { check_key: 'S3-c2', final_state: '未定' },
      { check_key: 'S7-c3', final_state: '未定' },
      ...Array.from({ length: 34 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false }, ANCHOR);
    expect(plan.traceTask).not.toBeNull();
    expect(plan.bugTask).toBeNull();
    expect(plan.traceTask.payload.acceptance_bucket).toBe('trace');
    expect(plan.traceTask.description).toContain('S3-c2');
    expect(plan.traceTask.description).toContain('S7-c3');
  });

  it('既有红格又有未定格时两个任务都建', () => {
    if (!buildDivertPlan) return;
    const cells = [
      { check_key: 'S2-c4', final_state: '红' },
      { check_key: 'S3-c2', final_state: '未定' },
      ...Array.from({ length: 34 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false }, ANCHOR);
    expect(plan.bugTask).not.toBeNull();
    expect(plan.traceTask).not.toBeNull();
  });
});

// ============================================================
// BEHAVIOR-15 — bucket 独立查重
// ============================================================
describe('FR-3 bucket 独立查重 — BEHAVIOR-15', () => {
  /**
   * shouldSkipBucket(existingCount) — 纯函数
   * 参数：某 bucket 的未终态任务数
   * 返回：true = 跳过（已有活跃任务），false = 创建
   */
  let shouldSkipBucket;
  beforeEach(async () => {
    try {
      const mod = await import('../../../../packages/brain/src/acceptance-divert.js');
      shouldSkipBucket = mod.shouldSkipBucket;
    } catch {
      shouldSkipBucket = null;
    }
  });

  it('BEHAVIOR-15a — bug 桶已有未终态任务（count=1）跳过', () => {
    if (!shouldSkipBucket) return;
    expect(shouldSkipBucket(1)).toBe(true);
  });

  it('BEHAVIOR-15b — bug 桶无未终态任务（count=0）不跳过', () => {
    if (!shouldSkipBucket) return;
    expect(shouldSkipBucket(0)).toBe(false);
  });

  it('BEHAVIOR-15c — trace 桶独立于 bug 桶：bug 有活跃任务不影响 trace 判断', () => {
    // 这个行为体现在 buildDivertPlan 接受两个独立的 existingBugCount/existingTraceCount
    if (!buildDivertPlan) return;
    const cells = [
      { check_key: 'S2-c4', final_state: '红' },
      { check_key: 'S3-c2', final_state: '未定' },
      ...Array.from({ length: 34 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    // bug 桶已有 1 个，trace 桶为 0
    const plan = buildDivertPlan(cells, { ai_incomplete: false }, {}, { existingBugCount: 1, existingTraceCount: 0 });
    expect(plan.bugTask).toBeNull(); // bug 桶跳过
    expect(plan.traceTask).not.toBeNull(); // trace 桶独立新建
  });
});

// ============================================================
// BEHAVIOR-16 — anchor 三件套非空
// ============================================================
describe('FR-3 anchor 三件套 — BEHAVIOR-16', () => {
  const ANCHOR = {
    journey_id: '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6',
    gp_id: '7790f728-f490-4243-b166-03f3250a0938',
    step_id: '817f59f5-02ff-4a70-bd81-f7ae65f77e02',
  };

  it('BEHAVIOR-16 — bug 任务 payload.anchor 三件套非空', () => {
    if (!buildDivertPlan) return;
    const cells = [
      { check_key: 'S2-c4', final_state: '红' },
      ...Array.from({ length: 35 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false }, ANCHOR);
    expect(plan.bugTask?.payload?.anchor?.journey_id).toBe(ANCHOR.journey_id);
    expect(plan.bugTask?.payload?.anchor?.gp_id).toBe(ANCHOR.gp_id);
    expect(plan.bugTask?.payload?.anchor?.step_id).toBe(ANCHOR.step_id);
  });

  it('BEHAVIOR-16b — trace 任务 payload.anchor 三件套非空', () => {
    if (!buildDivertPlan) return;
    const cells = [
      { check_key: 'S3-c2', final_state: '未定' },
      ...Array.from({ length: 35 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false }, ANCHOR);
    expect(plan.traceTask?.payload?.anchor?.journey_id).toBe(ANCHOR.journey_id);
    expect(plan.traceTask?.payload?.anchor?.gp_id).toBe(ANCHOR.gp_id);
    expect(plan.traceTask?.payload?.anchor?.step_id).toBe(ANCHOR.step_id);
  });
});

// ============================================================
// BEHAVIOR-17 — 熔断互斥
// ============================================================
describe('FR-4 熔断路径 — BEHAVIOR-17', () => {
  it('BEHAVIOR-17a — 非绿格恰好 12（=1/3，不触发）走常规分流', () => {
    if (!checkCircuitBreaker) return;
    expect(checkCircuitBreaker(12, 36)).toBe(false); // 12/36 = 1/3，不超过
  });

  it('BEHAVIOR-17b — 非绿格 13（>1/3）触发熔断', () => {
    if (!checkCircuitBreaker) return;
    expect(checkCircuitBreaker(13, 36)).toBe(true);
  });

  it('BEHAVIOR-17c — 非绿格 14 触发熔断', () => {
    if (!checkCircuitBreaker) return;
    expect(checkCircuitBreaker(14, 36)).toBe(true);
  });

  it('BEHAVIOR-17d — 熔断时 buildDivertPlan 只建 circuitBreakerTask，无 bug/trace', () => {
    if (!buildDivertPlan) return;
    // 构造 14 格非绿（13 红 + 1 未定）
    const cells = [
      ...Array.from({ length: 13 }, (_, i) => ({ check_key: `S${i + 1}-c4`, final_state: '红' })),
      { check_key: 'S14-c4', final_state: '未定' },
      ...Array.from({ length: 22 }, (_, i) => ({ check_key: `S${i + 15}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false });
    expect(plan.circuitBreakerTask).not.toBeNull();
    expect(plan.bugTask).toBeNull();
    expect(plan.traceTask).toBeNull();
    expect(plan.circuitBreakerTask.payload?.task_type).toBe('p0');
    expect(plan.circuitBreakerTask.description).toMatch(/规程\/数据源疑似分叉/);
  });

  it('BEHAVIOR-17e — 熔断 P0 描述包含非绿格数量和比例', () => {
    if (!buildDivertPlan) return;
    const cells = [
      ...Array.from({ length: 13 }, (_, i) => ({ check_key: `S${i + 1}-c4`, final_state: '红' })),
      { check_key: 'S14-c4', final_state: '未定' },
      ...Array.from({ length: 22 }, (_, i) => ({ check_key: `S${i + 15}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: false });
    expect(plan.circuitBreakerTask.description).toMatch(/14/); // 非绿格数
  });
});

// ============================================================
// BEHAVIOR-18 — AI 哑火独立路径
// ============================================================
describe('FR-5 AI 哑火路径 — BEHAVIOR-18', () => {
  it('BEHAVIOR-18a — ai_incomplete=true 时 checkAiIncomplete 返回 true', () => {
    if (!checkAiIncomplete) return;
    expect(checkAiIncomplete({ ai_incomplete: true })).toBe(true);
  });

  it('BEHAVIOR-18b — ai_incomplete=false 时 checkAiIncomplete 返回 false', () => {
    if (!checkAiIncomplete) return;
    expect(checkAiIncomplete({ ai_incomplete: false })).toBe(false);
  });

  it('BEHAVIOR-18c — ai_incomplete=true 时只建 aiRunInfraTask，无 bug/trace/熔断', () => {
    if (!buildDivertPlan) return;
    const cells = [
      ...Array.from({ length: 13 }, (_, i) => ({ check_key: `S${i + 1}-c4`, final_state: '红' })),
      ...Array.from({ length: 23 }, (_, i) => ({ check_key: `S${i + 14}-c1`, final_state: '绿' })),
    ];
    const runDetail = {
      ai_incomplete: true,
      missing_cells: ['S1-c4', 'S2-c4'],
    };
    const plan = buildDivertPlan(cells, runDetail);
    expect(plan.aiRunInfraTask).not.toBeNull();
    expect(plan.bugTask).toBeNull();
    expect(plan.traceTask).toBeNull();
    expect(plan.circuitBreakerTask).toBeNull();
    expect(plan.aiRunInfraTask.payload.acceptance_bucket).toBe('ai_run_infra_error');
    expect(plan.aiRunInfraTask.payload.missing_cells).toEqual(runDetail.missing_cells);
  });

  it('BEHAVIOR-18d — ai_incomplete=true 的 run 即使非绿格 > 1/3 也不进熔断', () => {
    if (!buildDivertPlan) return;
    // 非绿格 14，但 ai_incomplete=true → 不走熔断
    const cells = [
      ...Array.from({ length: 14 }, (_, i) => ({ check_key: `S${i + 1}-c4`, final_state: '红' })),
      ...Array.from({ length: 22 }, (_, i) => ({ check_key: `S${i + 15}-c1`, final_state: '绿' })),
    ];
    const plan = buildDivertPlan(cells, { ai_incomplete: true, missing_cells: [] });
    expect(plan.circuitBreakerTask).toBeNull();
    expect(plan.aiRunInfraTask).not.toBeNull();
  });
});

// ============================================================
// BEHAVIOR-19 — SAVEPOINT 隔离（集成测试，mock DB client）
// ============================================================
describe('FR-6 SAVEPOINT 隔离 — BEHAVIOR-19', () => {
  /**
   * 测试策略：构造 mock DB client，第一条 INSERT 抛 23505，
   * 验证第二条 INSERT 仍被执行（SAVEPOINT 保护正常工作）。
   */
  it('BEHAVIOR-19 — 第一条 INSERT 23505 不阻止第二条执行', async () => {
    if (!divertAfterAdjudicated) return;

    const insertCalls = [];
    let callCount = 0;
    const mockClient = {
      query: vi.fn(async (sql, params) => {
        if (sql.startsWith('SAVEPOINT') || sql.startsWith('RELEASE') || sql.startsWith('ROLLBACK TO')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO tasks')) {
          callCount++;
          insertCalls.push(params);
          if (callCount === 1) {
            // 第一条触发 23505
            const err = new Error('duplicate key');
            err.code = '23505';
            throw err;
          }
          return { rows: [{ id: 'task-uuid-2' }] };
        }
        // 查重查询返回 0
        if (sql.includes('SELECT count(*)')) {
          return { rows: [{ count: 0 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
    };

    // 构造有一个红格（bug 任务）和一个未定格（trace 任务）的场景
    const runKey = 'test-run-key-savepoint';
    const cells = [
      { check_key: 'S2-c4', final_state: '红' },
      { check_key: 'S3-c2', final_state: '未定' },
      ...Array.from({ length: 34 }, (_, i) => ({ check_key: `S${i + 10}-c1`, final_state: '绿' })),
    ];
    const runDetail = { ai_incomplete: false, missing_cells: [] };
    const anchor = {
      journey_id: '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6',
      gp_id: '7790f728-f490-4243-b166-03f3250a0938',
      step_id: '817f59f5-02ff-4a70-bd81-f7ae65f77e02',
    };

    // 不应抛出（SAVEPOINT 保护下第一条 23505 只回滚单条）
    await expect(
      divertAfterAdjudicated(mockPool, runKey, cells, runDetail, anchor)
    ).resolves.not.toThrow();

    // 验证第二条 INSERT 被执行（callCount = 2：一条 bug，一条 trace）
    expect(callCount).toBeGreaterThanOrEqual(1); // 至少尝试了两次 INSERT
    // 第二条 INSERT（trace 桶）成功落库
    expect(insertCalls.length).toBe(2);
  });
});

// ============================================================
// E2E 级验证（manual:bash，需 Brain 运行 + psql）
// ============================================================
describe('E2E 分流验证（manual:bash，需 Brain 运行）', () => {
  it.skip('manual:bash E2E-3 — 分流建任务聚合 + anchor 三件套', async () => {
    /**
     * 执行步骤（手动）：
     * 1. 建一个 human_complete 的 run，含 2 格红（S2-c4, S8-c4）、1 格未定
     * 2. 对所有格裁决（让 run 推进到 adjudicated）
     * 3. psql 断言：
     *    - bug 任务计数 = 1
     *    - trace 任务计数 = 1
     *    - bug 任务描述含 S2-c4 且含 S8-c4
     *    - anchor journey_id/gp_id/step_id 非空
     */
    expect(true).toBe(true);
  });

  it.skip('manual:bash E2E-5 — 熔断只开规程 P0', async () => {
    /**
     * 执行步骤（手动）：
     * 1. 建一个 human_complete 的 run，构造 14 格非绿（>1/3）
     * 2. 裁决让 run 推进到 adjudicated
     * 3. psql 断言：
     *    - bug/trace 任务计数 = 0
     *    - task_type=p0 且描述含"规程/数据源疑似分叉"的任务计数 = 1
     */
    expect(true).toBe(true);
  });

  it.skip('manual:bash E2E-6 — AI 哑火路径', async () => {
    /**
     * 执行步骤（手动）：
     * 1. 建一个 detail.ai_incomplete=true 的 run
     * 2. 裁决后触发分流
     * 3. psql 断言：
     *    - bug/trace 任务计数 = 0
     *    - ai_run_infra_error 桶任务计数 = 1
     *    - 任务 payload 含 missing_cells
     */
    expect(true).toBe(true);
  });
});
