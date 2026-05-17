/**
 * quarantine-insight-task 单元测试
 *
 * 验证：quarantine_pattern 学习入库后强制绑定 dev task（Insight-to-Action 闭环）
 * 场景：任务 3+ 次失败 → 隔离 → LLM 分析 → 写入 quarantine_pattern learning → 创建 dev task
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── hoisted mocks ────────────────────────────────────────────────────────────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const mockCreateTask = vi.hoisted(() => vi.fn());
const mockUpsertLearning = vi.hoisted(() => vi.fn());
const mockEmit = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockHasActiveSignal = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../learning.js', () => ({ upsertLearning: mockUpsertLearning }));
vi.mock('../event-bus.js', () => ({ emit: mockEmit }));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../quarantine-active-signal.js', () => ({ hasActiveSignal: mockHasActiveSignal }));
vi.mock('../spawn/middleware/resource-tier.js', () => ({ resolveResourceTier: vi.fn().mockReturnValue('standard') }));
vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
  unblockTask: vi.fn(),
  unblockExpiredTasks: vi.fn(),
}));

let quarantineTask, QUARANTINE_REASONS, FAILURE_THRESHOLD;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../quarantine.js');
  quarantineTask = mod.quarantineTask;
  QUARANTINE_REASONS = mod.QUARANTINE_REASONS;
  FAILURE_THRESHOLD = mod.FAILURE_THRESHOLD;
});

beforeEach(() => {
  // resetAllMocks clears queued mockResolvedValueOnce values, preventing test pollution
  vi.resetAllMocks();
  // Re-set defaults for mocks that always need a return value
  mockEmit.mockResolvedValue(undefined);
  mockHasActiveSignal.mockResolvedValue(false);
});

// ── 辅助：基础隔离 DB 序列（仅 SELECT + UPDATE，共 2 次 pool.query）────────────

function mockBaseDbSequence(taskId, failureCount) {
  mockPool.query
    .mockResolvedValueOnce({
      rows: [{
        id: taskId,
        title: '重复失败的 dev 任务',
        status: 'in_progress',
        task_type: 'dev',
        description: '修复某个 bug',
        payload: { failure_count: failureCount },
      }],
    })
    .mockResolvedValueOnce({ rowCount: 1 });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('quarantine_pattern learning → dev task 强制绑定', () => {
  it('新 quarantine_pattern learning 入库后自动创建 dev task', async () => {
    const taskId = 'task-quarantine-001';
    const learningId = 'learning-uuid-001';

    // SELECT task + UPDATE quarantine
    mockBaseDbSequence(taskId, FAILURE_THRESHOLD);

    mockCallLLM.mockResolvedValueOnce({ text: '任务失败是因为外部 API 超时，需要增加重试机制' });
    mockUpsertLearning.mockResolvedValueOnce({ id: learningId, upserted: true });
    // dedup: 无重复 task
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'new-dev-task-001' } });
    // UPDATE learnings applied=true
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
      failure_count: FAILURE_THRESHOLD,
    });

    // 应调用 upsertLearning 写入 quarantine_pattern
    expect(mockUpsertLearning).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'quarantine_pattern',
        triggerEvent: 'quarantine',
      })
    );

    // 应创建 dev task，payload 含 insight_learning_id 和 quarantined_task_id
    expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      task_type: 'dev',
      trigger_source: 'quarantine',
      priority: 'P1',
      payload: expect.objectContaining({
        insight_learning_id: learningId,
        quarantined_task_id: taskId,
        event_type: 'quarantine_pattern',
      }),
    }));

    // 应标记 applied=true
    const appliedCall = mockPool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('applied = true')
    );
    expect(appliedCall).toBeDefined();
    expect(appliedCall[1]).toContain(learningId);
  });

  it('已有对应 task（去重）时不重复创建', async () => {
    const taskId = 'task-quarantine-002';
    const learningId = 'learning-uuid-002';

    mockBaseDbSequence(taskId, FAILURE_THRESHOLD);

    mockCallLLM.mockResolvedValueOnce({ text: '配置错误导致任务反复失败' });
    mockUpsertLearning.mockResolvedValueOnce({ id: learningId, upserted: true });
    // dedup: 已存在对应 task → 不应创建新 task
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task-id' }] });

    await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
      failure_count: FAILURE_THRESHOLD,
    });

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('learning 已存在（upserted=false）时不创建 task（仅递增频率计数）', async () => {
    const taskId = 'task-quarantine-003';
    const learningId = 'learning-uuid-003';

    mockBaseDbSequence(taskId, FAILURE_THRESHOLD);

    mockCallLLM.mockResolvedValueOnce({ text: '同类失败，已有记录' });
    // upserted=false: 已有同 title 的 learning，仅递增 frequency_count
    mockUpsertLearning.mockResolvedValueOnce({ id: learningId, upserted: false });

    await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
      failure_count: FAILURE_THRESHOLD,
    });

    // upserted=false → 不应查 dedup 也不应创建 task
    expect(mockCreateTask).not.toHaveBeenCalled();
    const dedupCall = mockPool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('insight_learning_id')
    );
    expect(dedupCall).toBeUndefined();
  });

  it('createTask 失败时不影响隔离主流程（非阻断）', async () => {
    const taskId = 'task-quarantine-004';
    const learningId = 'learning-uuid-004';

    mockBaseDbSequence(taskId, FAILURE_THRESHOLD);

    mockCallLLM.mockResolvedValueOnce({ text: '数据库连接超时导致失败' });
    mockUpsertLearning.mockResolvedValueOnce({ id: learningId, upserted: true });
    // dedup: 无重复
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // createTask 抛出异常
    mockCreateTask.mockRejectedValueOnce(new Error('DB connection lost'));

    // 不应抛出异常，隔离主流程应成功完成
    const result = await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
      failure_count: FAILURE_THRESHOLD,
    });

    expect(result.success).toBe(true);
  });

  it('LLM 分析无结果时不写入 learning 也不创建 task', async () => {
    const taskId = 'task-quarantine-005';

    mockBaseDbSequence(taskId, FAILURE_THRESHOLD);

    // LLM 返回空
    mockCallLLM.mockResolvedValueOnce({ text: null });

    await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
      failure_count: FAILURE_THRESHOLD,
    });

    expect(mockUpsertLearning).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('非 repeated_failure 原因隔离时不触发 LLM 分析和 task 创建', async () => {
    const taskId = 'task-quarantine-006';

    mockBaseDbSequence(taskId, 1);

    await quarantineTask(taskId, QUARANTINE_REASONS.SUSPICIOUS_INPUT, {
      failure_count: 1,
    });

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockUpsertLearning).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('failure_count 低于阈值时不触发 LLM 分析', async () => {
    const taskId = 'task-quarantine-007';

    // failure_count = FAILURE_THRESHOLD - 1 (低于阈值)
    mockBaseDbSequence(taskId, FAILURE_THRESHOLD - 1);

    await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
      failure_count: FAILURE_THRESHOLD - 1,
    });

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });
});
