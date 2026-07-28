/**
 * review 类任务 callback 不应触发 cecelia-run 熔断器
 *
 * 根因：arch_review / code_review / initiative_review 等走本机 Codex CLI（非 cecelia-run），
 * 失败时无条件调用 cbFailure('cecelia-run')，污染熔断器，反复 OPEN 致 brain degraded。
 * 修复：callback-processor.js 加 REVIEW_TASK_TYPES 豁免（SSOT: lib/review-task-types.js）。
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

function makePool(task_type) {
  const mockClient = {
    // This suite exercises circuit classification after a callback was
    // actually applied. Late/duplicate rowCount=0 behavior has its own tests.
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    release: vi.fn(),
  };
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ task_type, payload: {} }], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(mockClient),
  };
}

describe('review 类任务 callback 熔断隔离', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('coding_type=codex-review 失败不调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      run_id: 'run-001',
      status: 'AI Failed',
      result: { verdict: 'FAIL', summary: 'codex binary not found: spawn /opt/homebrew/bin/codex ENOENT' },
      coding_type: 'codex-review',
    }, makePool('arch_review')).catch(() => {});

    expect(circuitBreaker.recordFailure).not.toHaveBeenCalledWith('cecelia-run');
    expect(circuitBreaker.recordSuccess).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('task_type=arch_review 失败不调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000003',
      run_id: 'run-003',
      status: 'AI Failed',
      result: { error: 'arch_review codex CLI error' },
    }, makePool('arch_review')).catch(() => {});

    expect(circuitBreaker.recordFailure).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('task_type=code_review 失败不调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000004',
      run_id: 'run-004',
      status: 'AI Failed',
      result: { error: 'code_review failed' },
    }, makePool('code_review')).catch(() => {});

    expect(circuitBreaker.recordFailure).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('task_type=initiative_review 失败不调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000005',
      run_id: 'run-005',
      status: 'AI Failed',
      result: { error: 'initiative_review failed' },
    }, makePool('initiative_review')).catch(() => {});

    expect(circuitBreaker.recordFailure).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('task_type=dev（非 review）失败正常调用 cbFailure(cecelia-run)', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback({
      task_id: 'aaaaaaaa-0000-0000-0000-000000000002',
      run_id: 'run-002',
      status: 'AI Failed',
      result: { error: 'some dev task error' },
    }, makePool('dev')).catch(() => {});

    expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('cecelia-run');
  });
});
