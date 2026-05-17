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
  getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests,
} = await import('../workflows/consciousness.graph.js');

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
        { configurable: { thread_id: 'test-thalamus-ok:2' } }
      );
      expect(result.completed_steps).toContain('thalamus');
      expect(result.errors.filter(e => e.startsWith('thalamus'))).toHaveLength(0);
    });

    it('异常路径：thalamusProcessEvent 抛错 → errors 含 thalamus 错误', async () => {
      mockThalamusProcessEvent.mockRejectedValue(new Error('thalamus boom'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-err:2' } }
      );
      expect(result.completed_steps).toContain('thalamus');
      expect(result.errors.some(e => e.startsWith('thalamus:'))).toBe(true);
    });
  });

  describe('全图正常执行', () => {
    it('completed_steps 顺序：thalamus → decision → rumination → plan', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-full-run:2' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
      expect(result.errors).toHaveLength(0);
    });
  });
});
