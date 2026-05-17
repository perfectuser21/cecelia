/**
 * Harness Pipelines 列表 API 单元测试
 *
 * 覆盖 summarizeLangGraphEvents + buildPipelineRecord 的纯函数逻辑：
 *   - LangGraph 模式：按 langgraph_step 事件聚合 current_node / verdict / rounds / pr_url
 *   - Legacy 模式：langgraph 事件为空时 fallback 到 sprint_dir 子 task
 */
import { describe, it, expect, vi } from 'vitest';

// db.js 在 status.js 顶层 import，测 pure 函数时用 mock 避免副作用
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn(),
}));
vi.mock('../tick.js', () => ({ getTickStatus: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('./shared.js', () => ({
  getActivePolicy: vi.fn(), getWorkingMemory: vi.fn(), getTopTasks: vi.fn(),
  getRecentDecisions: vi.fn(), IDEMPOTENCY_TTL: 0, ALLOWED_ACTIONS: [],
}));
vi.mock('../nightly-orchestrator.js', () => ({ getNightlyOrchestratorStatus: vi.fn() }));
vi.mock('../websocket.js', () => ({ default: {} }));

const { summarizeLangGraphEvents, buildPipelineRecord } = await import('../routes/status.js');

describe('summarizeLangGraphEvents', () => {
  it('空数组返回 null', () => {
    expect(summarizeLangGraphEvents([])).toBeNull();
    expect(summarizeLangGraphEvents(null)).toBeNull();
  });

  it('单个 planner 事件 → current_node=planner, verdict=null', () => {
    const out = summarizeLangGraphEvents([
      { payload: { node: 'planner', step_index: 1 }, created_at: '2026-04-19T01:00:00Z' },
    ]);
    expect(out.current_node).toBe('planner');
    expect(out.current_node_label).toBe('Planner');
    expect(out.last_verdict).toBeNull();
    expect(out.total_steps).toBe(1);
  });

  it('GAN 2 轮 + Fix 4 轮真实数据 → 正确聚合', () => {
    const events = [
      { payload: { node: 'planner', step_index: 1 }, created_at: '2026-04-19T01:03:35Z' },
      { payload: { node: 'proposer', step_index: 2, review_round: 1 }, created_at: '2026-04-19T01:05:43Z' },
      { payload: { node: 'reviewer', step_index: 3, review_verdict: 'REVISION' }, created_at: '2026-04-19T01:08:45Z' },
      { payload: { node: 'proposer', step_index: 4, review_round: 2 }, created_at: '2026-04-19T01:12:18Z' },
      { payload: { node: 'reviewer', step_index: 5, review_verdict: 'APPROVED' }, created_at: '2026-04-19T01:14:32Z' },
      { payload: { node: 'generator', step_index: 6, pr_url: 'null`。' }, created_at: '2026-04-19T01:18:10Z' },
      { payload: { node: 'evaluator', step_index: 7, eval_round: 1, evaluator_verdict: 'FAIL' }, created_at: '2026-04-19T01:21:30Z' },
      { payload: { node: 'generator', step_index: 8 }, created_at: '2026-04-19T01:25:06Z' },
      { payload: { node: 'evaluator', step_index: 9, eval_round: 2, evaluator_verdict: 'FAIL' }, created_at: '2026-04-19T01:28:56Z' },
      { payload: { node: 'generator', step_index: 10 }, created_at: '2026-04-19T01:30:24Z' },
      { payload: { node: 'evaluator', step_index: 11, eval_round: 3, evaluator_verdict: 'FAIL' }, created_at: '2026-04-19T01:35:09Z' },
      { payload: { node: 'generator', step_index: 12 }, created_at: '2026-04-19T01:37:06Z' },
      { payload: { node: 'evaluator', step_index: 13, eval_round: 4, evaluator_verdict: 'PASS' }, created_at: '2026-04-19T01:43:16Z' },
      { payload: { node: 'report', step_index: 14 }, created_at: '2026-04-19T01:43:54Z' },
    ];
    const out = summarizeLangGraphEvents(events);
    expect(out.current_node).toBe('report');
    expect(out.current_node_label).toBe('Report');
    expect(out.gan_rounds).toBe(2);
    expect(out.fix_rounds).toBe(4);
    expect(out.review_round).toBe(2);
    expect(out.eval_round).toBe(4);
    expect(out.last_verdict).toBe('PASS');
    expect(out.total_steps).toBe(14);
    expect(out.pr_url).toBeNull(); // 所有 pr_url 都是 'null`。'，被过滤掉
  });

  it('有效 pr_url 正确提取', () => {
    const out = summarizeLangGraphEvents([
      { payload: { node: 'generator', pr_url: 'https://github.com/foo/bar/pull/123' }, created_at: '2026-04-19T01:00:00Z' },
    ]);
    expect(out.pr_url).toBe('https://github.com/foo/bar/pull/123');
  });
});

describe('buildPipelineRecord', () => {
  const baseTask = {
    id: '8b4a13eb-4f2c-4317-98ba-2d08a64c31c0',
    title: '[E2E-v5] Dashboard 可视化',
    description: '测试描述',
    status: 'in_progress',
    priority: 'P1',
    sprint_dir: 'sprints/test',
    created_at: '2026-04-19T01:00:00Z',
    started_at: '2026-04-19T01:00:00Z',
    completed_at: null,
    payload: {},
    pr_url: null,
    result: null,
  };

  it('LangGraph 模式：报告 langgraph 字段 + 当前步骤 = 节点 label', () => {
    const events = [
      { payload: { node: 'planner', step_index: 1 }, created_at: '2026-04-19T01:03:35Z' },
      { payload: { node: 'evaluator', step_index: 7, eval_round: 1, evaluator_verdict: 'FAIL' }, created_at: '2026-04-19T01:21:30Z' },
    ];
    const rec = buildPipelineRecord(baseTask, events, null);
    expect(rec.pipeline_id).toBe(baseTask.id);
    expect(rec.planner_task_id).toBe(baseTask.id);
    expect(rec.langgraph).toBeTruthy();
    expect(rec.langgraph.current_node).toBe('evaluator');
    expect(rec.current_step).toBe('Evaluator');
    expect(rec.title).toBe(baseTask.title);
  });

  it('LangGraph completed：passed verdict + stages 全 completed', () => {
    const events = [
      { payload: { node: 'planner' }, created_at: '2026-04-19T01:00:00Z' },
      { payload: { node: 'proposer' }, created_at: '2026-04-19T01:05:00Z' },
      { payload: { node: 'reviewer' }, created_at: '2026-04-19T01:10:00Z' },
      { payload: { node: 'generator' }, created_at: '2026-04-19T01:15:00Z' },
      { payload: { node: 'evaluator' }, created_at: '2026-04-19T01:20:00Z' },
      { payload: { node: 'report' }, created_at: '2026-04-19T01:25:00Z' },
    ];
    const rec = buildPipelineRecord({ ...baseTask, status: 'completed', completed_at: '2026-04-19T01:25:00Z' }, events, null);
    expect(rec.verdict).toBe('passed');
    expect(rec.stages.every(s => s.status === 'completed')).toBe(true);
  });

  it('Legacy 模式（无 langgraph 事件）：fallback 到 stages 聚合', () => {
    // 注：harness_planner stage 已退役（PR retire-harness-planner），
    // 此处用 harness_contract_propose / harness_generate 作为 legacy stage 样例。
    const legacy = {
      harness_contract_propose: { task_type: 'harness_contract_propose', label: 'Propose', status: 'completed',
                                  created_at: '2026-04-01T00:00:00Z' },
      harness_generate: { task_type: 'harness_generate', label: 'Generate', status: 'in_progress',
                          created_at: '2026-04-01T00:10:00Z' },
    };
    const rec = buildPipelineRecord(baseTask, [], legacy);
    expect(rec.langgraph).toBeNull();
    const proposeStage = rec.stages.find(s => s.task_type === 'harness_contract_propose');
    expect(proposeStage.status).toBe('completed');
    const genStage = rec.stages.find(s => s.task_type === 'harness_generate');
    expect(genStage.status).toBe('in_progress');
  });

  it('verdict 状态映射：failed/cancelled/quarantined → failed', () => {
    expect(buildPipelineRecord({ ...baseTask, status: 'failed' }, [], null).verdict).toBe('failed');
    expect(buildPipelineRecord({ ...baseTask, status: 'cancelled' }, [], null).verdict).toBe('failed');
    expect(buildPipelineRecord({ ...baseTask, status: 'quarantined' }, [], null).verdict).toBe('failed');
  });

  it('pr_url 优先级：task.pr_url > result.pr_url > langgraph.pr_url', () => {
    const rec1 = buildPipelineRecord({ ...baseTask, pr_url: 'A' }, [], null);
    expect(rec1.pr_url).toBe('A');
    const rec2 = buildPipelineRecord({ ...baseTask, result: { pr_url: 'B' } }, [], null);
    expect(rec2.pr_url).toBe('B');
    const rec3 = buildPipelineRecord(baseTask, [
      { payload: { node: 'generator', pr_url: 'https://example.com/pr/1' }, created_at: '2026-04-19T01:00:00Z' },
    ], null);
    expect(rec3.pr_url).toBe('https://example.com/pr/1');
  });
});
