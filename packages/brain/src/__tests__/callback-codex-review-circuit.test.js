/**
 * codex-review callback 不应触发 cecelia-run 熔断器
 *
 * 根因：triggerCodexReview 在 Docker 里找不到 codex binary（ENOENT），
 * 发回 coding_type='codex-review' 的失败 callback，但原代码无条件调用
 * cbFailure('cecelia-run')，导致 8 次后熔断，阻塞所有 dev 任务派发。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(() => ({ class: 'task_error' })),
  handleTaskFailure: vi.fn(() => ({ quarantined: false })),
}));
vi.mock('../alerting.js', () => ({ raise: vi.fn(() => Promise.resolve()) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../thalamus.js', () => ({ thalamusProcessEvent: vi.fn(), ACTION_WHITELIST: {} }));
vi.mock('../guidance.js', () => ({ setGuidance: vi.fn(), getGuidance: vi.fn() }));
vi.mock('../notifier.js', () => ({ publishTaskFailed: vi.fn(), publishTaskCompleted: vi.fn() }));
vi.mock('../code-review-trigger.js', () => ({ checkAndCreateCodeReviewTrigger: vi.fn() }));
vi.mock('../auto-learning.js', () => ({ recordExpectedReward: vi.fn(), recordActualReward: vi.fn() }));
vi.mock('../dev-failure-classifier.js', () => ({ classifyDevFailure: vi.fn() }));

import * as circuitBreaker from '../circuit-breaker.js';

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [{ task_type: 'arch_review', payload: {} }], rowCount: 1 }),
  connect: vi.fn().mockResolvedValue(mockClient),
};

describe('codex-review callback 熔断隔离', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [{ task_type: 'arch_review', payload: {} }], rowCount: 1 });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('coding_type=codex-review 失败不调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      run_id: 'run-001',
      status: 'AI Failed',
      result: { verdict: 'FAIL', summary: 'codex binary not found: spawn /opt/homebrew/bin/codex ENOENT' },
      coding_type: 'codex-review',
    }, mockPool).catch(() => {});

    expect(circuitBreaker.recordFailure).not.toHaveBeenCalledWith('cecelia-run');
    // codex-review 失败也不应记录 cecelia-run 成功
    expect(circuitBreaker.recordSuccess).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('coding_type 未设置（普通 dev 任务）正常调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000002',
      run_id: 'run-002',
      status: 'AI Failed',
      result: { error: 'some dev task error' },
    }, mockPool).catch(() => {});

    expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('cecelia-run');
  });
});
