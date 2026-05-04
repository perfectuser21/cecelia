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
  getGuidance: vi.fn().mockResolvedValue(null),
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

  // 测试 2: 单次运行超过 5 分钟被中断，不影响主进程
  it('单次运行设有 5 分钟超时保护', async () => {
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
  it('thalamus 结果写入 guidance routing key', async () => {
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

  // 测试 4: loop 崩溃后 tick-scheduler 继续正常派发（loop 独立，不影响调度层）
  it('_runConsciousnessOnce 内部异常不向外抛出', async () => {
    mockThalamusProcessEvent.mockRejectedValue(new Error('LLM 崩了'));
    const result = await _runConsciousnessOnce();
    // 不抛异常，返回 error 字段
    expect(result.error).toBeDefined();
    expect(result.completed).toBe(false);
  });
});
