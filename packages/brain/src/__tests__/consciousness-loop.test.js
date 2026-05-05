// packages/brain/src/__tests__/consciousness-loop.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 所有 LLM 依赖
const mockThalamusProcessEvent = vi.fn();
const mockGenerateDecision = vi.fn();
const mockRunRumination = vi.fn();
const mockPlanNextTask = vi.fn();
const mockSetGuidance = vi.fn();
const mockIsConsciousnessEnabled = vi.fn();
const mockQuery = vi.fn();
const mockGetCompiledConsciousnessGraph = vi.fn();
const mockGraphInvoke = vi.fn();
const mockGetGuidanceForThread = vi.fn();

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
  getGuidance: (...args) => mockGetGuidanceForThread(...args),
}));

vi.mock('../workflows/consciousness.graph.js', () => ({
  getCompiledConsciousnessGraph: (...args) => mockGetCompiledConsciousnessGraph(...args),
}));

vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: () => mockIsConsciousnessEnabled(),
}));

vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// 文件未创建时 fail — TDD 起点
import { startConsciousnessLoop, _runConsciousnessOnce, stopConsciousnessLoop } from '../consciousness-loop.js';

describe('consciousness-loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockThalamusProcessEvent.mockResolvedValue({ actions: [], level: 'normal' });
    mockGenerateDecision.mockResolvedValue({ confidence: 0.5, actions: [], decision_id: 'dec-1' });
    mockRunRumination.mockResolvedValue({ processed: 1 });
    mockPlanNextTask.mockResolvedValue({ task_id: 'task-1' });
    mockSetGuidance.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    stopConsciousnessLoop();
  });

  // 测试 1: CONSCIOUSNESS_ENABLED=false 时 loop 不启动
  it('CONSCIOUSNESS_ENABLED=false 时 startConsciousnessLoop 不建立定时器', () => {
    mockIsConsciousnessEnabled.mockReturnValue(false);
    const result = startConsciousnessLoop();
    expect(result).toBe(false);
    expect(mockThalamusProcessEvent).not.toHaveBeenCalled();
  });

  // 测试 2: 单次运行超过超时被中断，不影响主进程
  it('单次运行设有超时保护', async () => {
    // 模拟 thalamus 永不 resolve
    mockThalamusProcessEvent.mockReturnValue(
      new Promise(() => {}) // 永远 pending
    );
    const resultPromise = _runConsciousnessOnce({ timeoutMs: 100 }); // 测试用 100ms
    const result = await resultPromise;
    expect(result.timedOut).toBe(true);
    expect(result.error).toBeUndefined(); // 不抛异常
  });

  // 测试 3: thalamus 结果正确写入 guidance: routing:{task_id}
  it('thalamus dispatch_task 结果写入 guidance routing key', async () => {
    mockThalamusProcessEvent.mockResolvedValue({
      actions: [{ type: 'dispatch_task', task_id: 'task-abc' }],
      level: 'normal',
    });
    await _runConsciousnessOnce();
    expect(mockSetGuidance).toHaveBeenCalledWith(
      'routing:task-abc',
      expect.objectContaining({ executor_type: expect.any(String) }),
      'thalamus',
      3600_000
    );
  });

  // 测试 4: loop 崩溃后不向外抛出（tick-scheduler 继续正常派发）
  it('_runConsciousnessOnce 内部异常不向外抛出', async () => {
    mockThalamusProcessEvent.mockRejectedValue(new Error('LLM 崩了'));
    const result = await _runConsciousnessOnce();
    // 不抛异常，返回 error 字段
    expect(result.error).toBeDefined();
    expect(result.completed).toBe(false);
  });

  // ─────────────────────────────────────────────
  // Graph 行为测试（验证 _runConsciousnessOnce 使用 StateGraph）
  // ─────────────────────────────────────────────
  describe('graph-based _runConsciousnessOnce', () => {
    beforeEach(() => {
      mockIsConsciousnessEnabled.mockReturnValue(true);
      mockGetCompiledConsciousnessGraph.mockResolvedValue({ invoke: mockGraphInvoke });
      mockGraphInvoke.mockResolvedValue({
        completed_steps: ['thalamus', 'decision', 'rumination', 'plan'],
        errors: [],
      });
      // 无 active thread → fresh start
      mockGetGuidanceForThread.mockResolvedValue(null);
      mockQuery.mockResolvedValue({ rowCount: 1 });
    });

    it('调用 getCompiledConsciousnessGraph 并 invoke', async () => {
      const result = await _runConsciousnessOnce();
      expect(mockGetCompiledConsciousnessGraph).toHaveBeenCalled();
      expect(mockGraphInvoke).toHaveBeenCalled();
      expect(result.completed).toBe(true);
    });

    it('thread_id 格式为 consciousness:{数字}', async () => {
      await _runConsciousnessOnce();
      const [_input, config] = mockGraphInvoke.mock.calls[0];
      expect(config.configurable.thread_id).toMatch(/^consciousness:\d+$/);
    });

    it('invoke 前将 thread_id 写入 brain_guidance', async () => {
      await _runConsciousnessOnce();
      expect(mockSetGuidance).toHaveBeenCalledWith(
        'consciousness:active_thread',
        expect.objectContaining({ thread_id: expect.stringMatching(/^consciousness:\d+$/) }),
        'consciousness-loop',
        expect.any(Number)
      );
      // 验证 setGuidance 在 invoke 之前调用（时序保证）
      const setOrder = mockSetGuidance.mock.invocationCallOrder[0];
      const invokeOrder = mockGraphInvoke.mock.invocationCallOrder[0];
      expect(setOrder).toBeLessThan(invokeOrder);
    });

    it('完成后清除 brain_guidance active thread', async () => {
      await _runConsciousnessOnce();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['consciousness:active_thread'])
      );
    });

    it('已有 active thread 时 resume（input=null）', async () => {
      mockGetGuidanceForThread.mockResolvedValue({ thread_id: 'consciousness:111111' });
      await _runConsciousnessOnce();
      const [input, config] = mockGraphInvoke.mock.calls[0];
      expect(config.configurable.thread_id).toBe('consciousness:111111');
      expect(input).toBeNull();
    });

    it('_isRunning 锁防并发：第二次调用立即返回', async () => {
      let resolveInvoke;
      mockGraphInvoke.mockImplementation(
        () => new Promise(res => { resolveInvoke = res; })
      );
      const p1 = _runConsciousnessOnce();
      const result2 = await _runConsciousnessOnce();
      expect(result2.completed).toBe(false);
      expect(result2.reason).toBe('already_running');
      resolveInvoke({ completed_steps: ['thalamus', 'decision', 'rumination', 'plan'], errors: [] });
      await p1;
    });

    it('invoke 异常时 completed=false，error 含错误信息', async () => {
      mockGraphInvoke.mockRejectedValue(new Error('graph exploded'));
      const result = await _runConsciousnessOnce();
      expect(result.completed).toBe(false);
      expect(result.error).toContain('graph exploded');
    });
  });
});
