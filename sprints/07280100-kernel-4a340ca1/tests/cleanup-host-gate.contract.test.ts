import { describe, expect, it, vi } from 'vitest';

import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';

describe('Kernel cleanup lifecycle and host gate contract', () => {
  it('cleanup 覆盖八条终态并要求无残留 capability', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/kernel-test-environment-controller.js'
    ).catch(() => null);

    expect(
      mod?.KERNEL_ENVIRONMENT_TERMINAL_PATHS,
      '当前主干没有八终态 cleanup contract 常量',
    ).toEqual([
      'completed',
      'completed_with_concerns',
      'failed_callback',
      'cancelled',
      'timeout',
      'lease_expiry',
      'process_or_worker_death',
      'callback_auth_or_validation_rejection',
    ]);
  });

  it('report 在 exact Draft PR head host receipt 与 owner review 缺失时必须阻断', async () => {
    const promote = vi.fn();
    const saveHandoff = vi.fn();
    const syncOkr = vi.fn();
    const spawnStaging = vi.fn();
    const cleanup = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async () => ({})),
        release: vi.fn(),
      })),
    };

    const handlers = createKernelHandlers({
      pool,
      execCmd: vi.fn(),
      attemptStore: {},
      promptDir: '/tmp',
      judgeGate: vi.fn(),
      allocatePort: vi.fn(),
      spawnReviewPreview: vi.fn(),
      notifyReview: vi.fn(),
      promote,
      buildHandoff: vi.fn(() => ({ ok: true })),
      saveHandoff,
      syncOkr,
      spawnStaging,
      cleanup,
    });

    const result = await handlers.report({
      taskId: '66666666-6666-4666-8666-666666666666',
      runId: '77777777-7777-4777-8777-777777777777',
      observed: {
        pr: {
          url: 'https://github.com/perfectuser21/cecelia/pull/1234',
          head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
        run: { initiative_id: '88888888-8888-4888-8888-888888888888' },
        task: {
          title: 'Kernel Test Environment Controller Recovery 4',
          payload: {
            review_required: true,
            sprint_dir: 'sprints/07280100-kernel-4a340ca1',
            pr_branch: 'draft/pr-1234',
            journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
          },
        },
      },
    } as any);

    expect(result).toMatchObject({ status: 'BLOCKED' });
    expect(promote).not.toHaveBeenCalled();
    expect(saveHandoff).not.toHaveBeenCalled();
  });
});
