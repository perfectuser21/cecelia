import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const {
  mockThalamusProcessEvent,
  mockGenerateDecision,
  mockRunRumination,
  mockSetGuidance,
  mockPool,
} = vi.hoisted(() => ({
  mockThalamusProcessEvent: vi.fn(),
  mockGenerateDecision: vi.fn(),
  mockRunRumination: vi.fn(),
  mockSetGuidance: vi.fn(),
  mockPool: { query: vi.fn() },
}));

let mockSaver;

vi.mock('../../thalamus.js', () => ({
  processEvent: (...args) => mockThalamusProcessEvent(...args),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../decision.js', () => ({
  generateDecision: (...args) => mockGenerateDecision(...args),
}));
vi.mock('../../rumination.js', () => ({
  runRumination: (...args) => mockRunRumination(...args),
}));

vi.mock('../../guidance.js', () => ({
  setGuidance: (...args) => mockSetGuidance(...args),
}));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => Promise.resolve(mockSaver),
}));

const {
  getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests,
} = await import('../consciousness.graph.js');

describe('consciousness.graph.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaver = new MemorySaver();
    _resetCompiledGraphForTests();

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

    it('恢复分析照常执行，不输出新增目标的战略guidance', async () => {
      mockGenerateDecision.mockResolvedValue({
        decision_id: 'dec-1',
        actions: [{ type: 'focus', target: 'KR-42' }],
      });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-guidance:1' } }
      );
      expect(mockGenerateDecision).toHaveBeenCalledWith({ trigger: 'consciousness_loop' });
      expect(mockSetGuidance).not.toHaveBeenCalled();
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
      mockRunRumination.mockImplementation(() => new Promise(() => {}));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-rumination-ff:1' } }
      );
      expect(result.completed_steps).toContain('rumination');
      expect(mockRunRumination).toHaveBeenCalled();
    });
  });

  describe('全图正常执行', () => {
    it('completed_steps 顺序：thalamus → decision → rumination', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-full-run:1' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination']);
      expect(result.errors).toHaveLength(0);
    });

    it('单个步骤失败不影响其余步骤', async () => {
      mockThalamusProcessEvent.mockRejectedValue(new Error('boom'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-partial-fail:1' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination']);
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
