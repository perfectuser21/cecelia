// packages/brain/src/__tests__/integration/consciousness-graph.integration.test.js
/**
 * consciousness.graph.js — checkpoint/resume 集成测试
 *
 * 验证：
 *   1. 图可编译，4 个节点顺序执行，completed_steps.length === 4
 *   2. MemorySaver checkpoint/resume：第一次 invoke 存 checkpoint；
 *      第二次 invoke（模拟崩溃恢复，同 thread_id）→ LangGraph 从 checkpoint 读状态
 *
 * mock 策略：
 *   - MemorySaver 替代 PgCheckpointer（不需要真 DB 连接）
 *   - 所有 LLM 底层依赖 mock（thalamus/decision/rumination/planner/guidance/pool）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const {
  mockThalamusProcessEvent,
  mockGenerateDecision,
  mockRunRumination,
  mockPlanNextTask,
  mockSetGuidance,
  mockPool,
} = vi.hoisted(() => ({
  mockThalamusProcessEvent: vi.fn(),
  mockGenerateDecision: vi.fn(),
  mockRunRumination: vi.fn(),
  mockPlanNextTask: vi.fn(),
  mockSetGuidance: vi.fn(),
  mockPool: { query: vi.fn() },
}));

let sharedSaver;

vi.mock('../../thalamus.js', () => ({
  processEvent: (...a) => mockThalamusProcessEvent(...a),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../decision.js', () => ({ generateDecision: (...a) => mockGenerateDecision(...a) }));
vi.mock('../../rumination.js', () => ({ runRumination: (...a) => mockRunRumination(...a) }));
vi.mock('../../planner.js', () => ({ planNextTask: (...a) => mockPlanNextTask(...a) }));
vi.mock('../../guidance.js', () => ({ setGuidance: (...a) => mockSetGuidance(...a) }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => Promise.resolve(sharedSaver),
}));

const {
  buildConsciousnessGraph,
  getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests,
} = await import('../../workflows/consciousness.graph.js');

describe('consciousness-graph integration — checkpoint/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedSaver = new MemorySaver();
    _resetCompiledGraphForTests();

    mockThalamusProcessEvent.mockResolvedValue({ actions: [] });
    mockGenerateDecision.mockResolvedValue({ actions: [] });
    mockRunRumination.mockResolvedValue(undefined);
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it('完整 invoke：completed_steps 顺序正确，长度为 4', async () => {
    const graph = await getCompiledConsciousnessGraph();
    const result = await graph.invoke(
      { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
      { configurable: { thread_id: 'integration:1' } }
    );
    expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
    expect(result.errors).toHaveLength(0);
  });

  it('checkpoint 存在（MemorySaver）：同 thread_id 第二次 invoke (null input) 仍返回最终 state', async () => {
    const graph = await getCompiledConsciousnessGraph();
    const threadConfig = { configurable: { thread_id: 'integration:resume-test' } };

    // 第一次：fresh start
    await graph.invoke(
      { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
      threadConfig
    );

    // 验证 checkpoint 存在
    const checkpointState = await sharedSaver.get(threadConfig);
    expect(checkpointState).not.toBeNull();

    // 第二次：null input → LangGraph 用 checkpoint state
    const result2 = await graph.invoke(null, threadConfig);
    expect(result2.completed_steps).toHaveLength(4);
  });

  it('getState()：checkpoint 包含 completed_steps', async () => {
    const graph = await getCompiledConsciousnessGraph();
    const threadConfig = { configurable: { thread_id: 'integration:getstate' } };
    await graph.invoke(
      { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
      threadConfig
    );
    const state = await graph.getState(threadConfig);
    expect(state.values.completed_steps).toHaveLength(4);
  });
});
