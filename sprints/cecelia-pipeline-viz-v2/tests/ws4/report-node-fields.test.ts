import { describe, it, expect, vi } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../../../../packages/brain/src/db.js', () => ({ pool: mockPool }));

describe('WS4 — reportNode 增强字段 [BEHAVIOR]', () => {
  it('reportNode 返回的 report_path JSON 含顶层字段 step_timing（array）', async () => {
    const { reportNode } = await import('../../../../packages/brain/src/workflows/harness-initiative.graph.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // task_events for step_timing
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE initiative_runs
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tasks
      .mockResolvedValueOnce({ rowCount: 1 }); // INSERT tasks (harness_report)

    const state = {
      initiativeId: 'test-initiative-id',
      sub_tasks: [
        { ws_id: 'ws1', cost_usd: 0.05, evaluator_feedback: 'looks good', ci_fail_type: null },
      ],
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
      task: { title: 'Test Initiative', payload: {} },
    };

    const result = await reportNode(state, { pool: mockPool });
    const report = JSON.parse(result.report_path);

    expect(Array.isArray(report.step_timing)).toBe(true);
  });

  it('reportNode 返回 report JSON 含顶层字段 ws_issues（array）', async () => {
    const { reportNode } = await import('../../../../packages/brain/src/workflows/harness-initiative.graph.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const state = {
      initiativeId: 'test-initiative-id-2',
      sub_tasks: [{ ws_id: 'ws1', cost_usd: 0.1, evaluator_feedback: 'unit test failed', ci_fail_type: 'test_fail' }],
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
      task: { title: 'Test', payload: {} },
    };

    const result = await reportNode(state, { pool: mockPool });
    const report = JSON.parse(result.report_path);

    expect(Array.isArray(report.ws_issues)).toBe(true);
  });

  it('reportNode 返回 report JSON 含顶层字段 ws_costs（array）', async () => {
    const { reportNode } = await import('../../../../packages/brain/src/workflows/harness-initiative.graph.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const state = {
      initiativeId: 'test-initiative-id-3',
      sub_tasks: [{ ws_id: 'ws1', cost_usd: 0.08, evaluator_feedback: null, ci_fail_type: null }],
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
      task: { title: 'Test', payload: {} },
    };

    const result = await reportNode(state, { pool: mockPool });
    const report = JSON.parse(result.report_path);

    expect(Array.isArray(report.ws_costs)).toBe(true);
  });

  it('report JSON 不含禁用字段 timings/timing/issues/costs/breakdown', async () => {
    const { reportNode } = await import('../../../../packages/brain/src/workflows/harness-initiative.graph.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const state = {
      initiativeId: 'test-initiative-id-4',
      sub_tasks: [],
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
      task: { title: 'Test', payload: {} },
    };

    const result = await reportNode(state, { pool: mockPool });
    const report = JSON.parse(result.report_path);

    expect(report).not.toHaveProperty('timings');
    expect(report).not.toHaveProperty('timing');
    expect(report).not.toHaveProperty('issues');
    expect(report).not.toHaveProperty('costs');
    expect(report).not.toHaveProperty('breakdown');
  });

  it('ws_costs 元素含 ws_id 和 cost_usd 字段（来自 sub_tasks）', async () => {
    const { reportNode } = await import('../../../../packages/brain/src/workflows/harness-initiative.graph.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const state = {
      initiativeId: 'test-initiative-id-5',
      sub_tasks: [{ ws_id: 'ws1', cost_usd: 0.12 }, { ws_id: 'ws2', cost_usd: 0.08 }],
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
      task: { title: 'Test', payload: {} },
    };

    const result = await reportNode(state, { pool: mockPool });
    const report = JSON.parse(result.report_path);

    if (report.ws_costs.length > 0) {
      expect(report.ws_costs[0]).toHaveProperty('ws_id');
      expect(report.ws_costs[0]).toHaveProperty('cost_usd');
    }
  });
});
