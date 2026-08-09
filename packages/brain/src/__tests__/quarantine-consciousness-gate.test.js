/**
 * quarantine-consciousness-gate 单元测试
 * 验证 quarantineTask 的失败归因 LLM 调用（rumination）受 isConsciousnessEnabled() 门禁
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── mock 区（顺序与 quarantine-block.test.js 保持一致的写法）──────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const mockEmit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../event-bus.js', () => ({ emit: mockEmit }));

const mockUpsertLearning = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../learning.js', () => ({ upsertLearning: mockUpsertLearning }));

const mockCallLLM = vi.hoisted(() => vi.fn().mockResolvedValue({ text: 'mock分析结果' }));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));

const mockIsConsciousnessEnabled = vi.hoisted(() => vi.fn());
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: mockIsConsciousnessEnabled,
}));

// ── 导入被测模块 ──────────────────────────────────────────
let quarantineTask, QUARANTINE_REASONS;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../quarantine.js');
  quarantineTask = mod.quarantineTask;
  QUARANTINE_REASONS = mod.QUARANTINE_REASONS;
});

// ── 辅助函数 ────────────────────────────────────────────

function mockTaskRow(taskId, failureCount) {
  return {
    id: taskId,
    title: '测试任务',
    status: 'in_progress',
    task_type: 'dev',
    description: '测试描述',
    payload: { failure_count: failureCount },
  };
}

describe('quarantineTask 的 rumination 归因调用受 consciousness.enabled 门禁', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockEmit.mockClear();
    mockUpsertLearning.mockClear();
    mockCallLLM.mockClear();
    mockIsConsciousnessEnabled.mockReset();
  });

  it('consciousness disabled 时不应调用 callLLM 或 upsertLearning，但隔离主流程仍成功', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(false);

    const taskId = 'task-disabled-001';
    mockPool.query
      .mockResolvedValueOnce({ rows: [mockTaskRow(taskId, 3)] }) // SELECT task
      .mockResolvedValueOnce({ rows: [] }); // UPDATE tasks SET status='quarantined'

    const result = await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {});

    expect(result.success).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith('task_quarantined', 'quarantine', expect.objectContaining({ task_id: taskId }));
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockUpsertLearning).not.toHaveBeenCalled();
  });

  it('consciousness enabled 时应正常调用 callLLM 做失败归因分析', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(true);

    const taskId = 'task-enabled-001';
    mockPool.query
      .mockResolvedValueOnce({ rows: [mockTaskRow(taskId, 3)] }) // SELECT task
      .mockResolvedValueOnce({ rows: [] }); // UPDATE tasks SET status='quarantined'

    const result = await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {});

    expect(result.success).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).toHaveBeenCalledWith('rumination', expect.stringContaining('测试任务'), expect.objectContaining({ maxTokens: 150 }));
    expect(mockUpsertLearning).toHaveBeenCalledTimes(1);
  });

  it('LLM 失败日志使用静态首参数，任务 ID 不能成为格式串', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockCallLLM.mockRejectedValueOnce(new Error('provider failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const taskId = 'task-%s-%d';
    mockPool.query
      .mockResolvedValueOnce({ rows: [mockTaskRow(taskId, 3)] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {});

    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      '[quarantine] LLM analysis failed',
      expect.objectContaining({ task_id: taskId, error: 'provider failed' }),
    );
    warnSpy.mockRestore();
  });
});
