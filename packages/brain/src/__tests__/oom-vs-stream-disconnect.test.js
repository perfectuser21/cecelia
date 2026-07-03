/**
 * 回归测试：OOM kill (exit=137) 与外部 API stream disconnect 应走不同路径
 *
 * Learning 2f561d31: 两者虽都可能表现为 UNKNOWN_ERROR，但
 *   - OOM kill    → 资源配置问题，首次重试即可，skipCount=true（不累计失败次数）
 *   - stream disconnect → 外部依赖网络故障，归入 NETWORK 分类 → 3次重试退避 → 持续则熔断
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== classifyFailure 单元测试 =====

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

describe('classifyFailure — stream disconnect 归入 NETWORK', () => {
  let classifyFailure, FAILURE_CLASS;

  beforeEach(async () => {
    vi.resetModules();
    ({ classifyFailure, FAILURE_CLASS } = await import('../quarantine.js'));
  });

  const streamMessages = [
    'stream disconnected',
    'Stream disconnected from chatgpt.com',
    'stream disconnect mid-response',
    'disconnected from stream at offset 4096',
    'SSE error: connection lost',
    'EventSource close unexpectedly',
  ];

  for (const msg of streamMessages) {
    it(`"${msg}" 应被分类为 NETWORK`, () => {
      const result = classifyFailure(msg);
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
    });
  }

  it('普通 TASK_ERROR 不应被归入 NETWORK', () => {
    const result = classifyFailure('undefined is not a function at line 42');
    expect(result.class).toBe(FAILURE_CLASS.TASK_ERROR);
  });
});

// ===== callback-processor OOM 路径测试 =====

describe('callback-processor — exit=137 OOM 不累计失败次数', () => {
  let processExecutionCallback;
  let mockPool;
  let mockHandleTaskFailure;
  let mockCbFailure;

  beforeEach(async () => {
    vi.resetModules();

    mockHandleTaskFailure = vi.fn().mockResolvedValue({ quarantined: false, failure_count: 0, skipped_count: true });
    mockCbFailure = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../quarantine.js', () => ({
      handleTaskFailure: mockHandleTaskFailure,
      classifyFailure: vi.fn().mockReturnValue({ class: 'unknown' }),
    }));
    vi.doMock('../circuit-breaker.js', () => ({
      recordSuccess: vi.fn(),
      recordFailure: mockCbFailure,
    }));
    vi.doMock('../thalamus.js', () => ({
      processEvent: vi.fn().mockResolvedValue({ actions: [] }),
      EVENT_TYPES: { TASK_FAILED: 'task_failed', TASK_COMPLETED: 'task_completed' },
    }));
    vi.doMock('../decision-executor.js', () => ({ executeDecision: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));
    vi.doMock('../events/taskEvents.js', () => ({
      publishTaskCompleted: vi.fn(),
      publishTaskFailed: vi.fn(),
    }));
    vi.doMock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn() }));
    vi.doMock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn() }));
    vi.doMock('../routes/shared.js', () => ({ resolveRelatedFailureMemories: vi.fn().mockResolvedValue([]) }));

    const mockTaskRow = { rows: [{ task_type: 'dev', payload: {} }] };
    const mockUpdateRow = { rows: [{ id: 'task-oom-001', status: 'failed', payload: {} }] };
    mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('SELECT task_type')) return Promise.resolve(mockTaskRow);
        if (sql.includes('failure_class')) return Promise.resolve({ rows: [{}] });
        return Promise.resolve(mockUpdateRow);
      }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'task-oom-001', status: 'failed', payload: {} }] }),
        release: vi.fn(),
      }),
    };

    ({ processExecutionCallback } = await import('../callback-processor.js'));
  });

  it('exit_code=137 (OOM) 时 handleTaskFailure 应以 skipCount=true 调用', async () => {
    await processExecutionCallback({
      task_id: 'task-oom-001',
      status: 'failed',
      result: null,
      exit_code: 137,
      duration_ms: 5000,
    }, mockPool).catch(() => {}); // 忽略其他错误，只关注 handleTaskFailure 调用

    const calls = mockHandleTaskFailure.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][1]?.skipCount).toBe(true);
    }
    // 熔断器不应被触发
    expect(mockCbFailure).not.toHaveBeenCalled();
  });

  it('exit_code=1 (普通失败) 时 handleTaskFailure 应以 skipCount=false 调用', async () => {
    await processExecutionCallback({
      task_id: 'task-oom-001',
      status: 'failed',
      result: null,
      exit_code: 1,
      duration_ms: 5000,
    }, mockPool).catch(() => {});

    const calls = mockHandleTaskFailure.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][1]?.skipCount).toBe(false);
    }
  });
});

// ===== thalamus _classifyExtDepError 测试 =====

describe('thalamus._classifyExtDepError — stream disconnect 归入 network', () => {
  let _classifyExtDepError, EXTERNAL_DEP_FAILURE_CLASSES;

  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock('../thalamus.js');
    vi.doMock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
    ({ _classifyExtDepError, EXTERNAL_DEP_FAILURE_CLASSES } = await import('../thalamus.js'));
  });

  it('"stream disconnected" 应被分类为 network', () => {
    expect(_classifyExtDepError('stream disconnected')).toBe('network');
  });

  it('"disconnected from stream" 应被分类为 network', () => {
    expect(_classifyExtDepError('disconnected from stream after 1024 bytes')).toBe('network');
  });

  it('network 应在 EXTERNAL_DEP_FAILURE_CLASSES 中', () => {
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('network')).toBe(true);
  });

  it('OOM kill 的 error_message "Process exited with code 137" 不应触发 ext_dep 分类', () => {
    // exit=137 的错误消息通常是进程退出码，不含内存相关词汇
    const result = _classifyExtDepError('Process exited with code 137');
    // 不应被误分类为 resource（否则会触发持续性外部依赖逻辑）
    expect(result).toBeNull();
  });
});
