// packages/brain/src/__tests__/consciousness-graph.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

// hoisted mocks
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

let mockSaver;

vi.mock('../thalamus.js', () => ({
  processEvent: (...args) => mockThalamusProcessEvent(...args),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../decision.js', () => ({
  generateDecision: (...args) => mockGenerateDecision(...args),
}));
vi.mock('../rumination.js', () => ({
  runRumination: (...args) => mockRunRumination(...args),
}));
vi.mock('../planner.js', () => ({
  planNextTask: (...args) => mockPlanNextTask(...args),
}));
vi.mock('../guidance.js', () => ({
  setGuidance: (...args) => mockSetGuidance(...args),
}));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => Promise.resolve(mockSaver),
}));

const {
  buildConsciousnessGraph,
  getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests,
} = await import('../workflows/consciousness.graph.js');

describe('consciousness.graph.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaver = new MemorySaver();
    _resetCompiledGraphForTests();

    // default happy-path mocks
    mockThalamusProcessEvent.mockResolvedValue({ actions: [] });
    mockGenerateDecision.mockResolvedValue({ actions: [] });
    mockRunRumination.mockResolvedValue(undefined);
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  describe('thalamusNode', () => {
    it('正常路径：completed_steps 包含 thalamus，无 errors', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-ok:1' } }
      );
      expect(result.completed_steps).toContain('thalamus');
      expect(result.errors.filter(e => e.startsWith('thalamus'))).toHaveLength(0);
    });

    it('异常路径：thalamusProcessEvent 抛错 → errors 含 thalamus 错误，仍含 thalamus 步骤', async () => {
      mockThalamusProcessEvent.mockRejectedValue(new Error('thalamus boom'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-err:1' } }
      );
      expect(result.completed_steps).toContain('thalamus');
      expect(result.errors.some(e => e.startsWith('thalamus:'))).toBe(true);
    });

    it('有 dispatch_task action 时调用 setGuidance', async () => {
      mockThalamusProcessEvent.mockResolvedValue({
        actions: [{ type: 'dispatch_task', task_id: 'uuid-123', level: 'P1' }],
        level: 'P1',
      });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-guidance:1' } }
      );
      expect(mockSetGuidance).toHaveBeenCalledWith(
        'routing:uuid-123',
        expect.objectContaining({ source: 'thalamus' }),
        'thalamus',
        3600_000
      );
    });
  });

  describe('decisionNode', () => {
    it('正常路径：completed_steps 包含 decision', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-ok:1' } }
      );
      expect(result.completed_steps).toContain('decision');
    });

    it('generateDecision 有 actions 时调用 setGuidance strategy:global', async () => {
      mockGenerateDecision.mockResolvedValue({
        decision_id: 'dec-1',
        actions: [{ type: 'focus', target: 'KR-42' }],
      });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-guidance:1' } }
      );
      expect(mockSetGuidance).toHaveBeenCalledWith(
        'strategy:global',
        expect.objectContaining({ decision_id: 'dec-1' }),
        'cortex',
        24 * 3600_000
      );
    });

    it('异常路径：generateDecision 抛错 → errors 含 decision 错误', async () => {
      mockGenerateDecision.mockRejectedValue(new Error('decision fail'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-err:1' } }
      );
      expect(result.completed_steps).toContain('decision');
      expect(result.errors.some(e => e.startsWith('decision:'))).toBe(true);
    });
  });

  describe('ruminationNode', () => {
    it('fire-and-forget：立即返回 rumination 步骤，不等待 runRumination 完成', async () => {
      mockRunRumination.mockImplementation(() => new Promise(() => {})); // never resolves
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-rumination-ff:1' } }
      );
      // If rumination was awaited, this invoke would never complete (test timeout)
      expect(result.completed_steps).toContain('rumination');
      expect(result.completed_steps).toContain('plan'); // plan executed after rumination node
      expect(mockRunRumination).toHaveBeenCalled(); // was "fired"
    });
  });

  describe('planNextTaskNode', () => {
    it('有 KR 时调用 planNextTask', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'kr-1' }, { id: 'kr-2' }] });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-plan-kr:1' } }
      );
      expect(mockPlanNextTask).toHaveBeenCalledWith(['kr-1', 'kr-2']);
    });

    it('无 KR 时不调用 planNextTask', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-plan-no-kr:1' } }
      );
      expect(mockPlanNextTask).not.toHaveBeenCalled();
    });

    it('异常路径：planNextTask 抛错 → errors 含 plan 错误', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'kr-1' }] });
      mockPlanNextTask.mockRejectedValue(new Error('plan fail'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-plan-err:1' } }
      );
      expect(result.completed_steps).toContain('plan');
      expect(result.errors.some(e => e.startsWith('plan:'))).toBe(true);
    });
  });

  describe('全图正常执行', () => {
    it('completed_steps 顺序：thalamus → decision → rumination → plan', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-full-run:1' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
      expect(result.errors).toHaveLength(0);
    });

    it('单个步骤失败不影响其余步骤', async () => {
      mockThalamusProcessEvent.mockRejectedValue(new Error('boom'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-partial-fail:1' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('getCompiledConsciousnessGraph 单例', () => {
    it('多次调用返回同一实例', async () => {
      const g1 = await getCompiledConsciousnessGraph();
      const g2 = await getCompiledConsciousnessGraph();
      expect(g1).toBe(g2);
    });

    it('_resetCompiledGraphForTests 后返回新实例', async () => {
      const g1 = await getCompiledConsciousnessGraph();
      _resetCompiledGraphForTests();
      const g2 = await getCompiledConsciousnessGraph();
      expect(g1).not.toBe(g2);
    });
  });
});
