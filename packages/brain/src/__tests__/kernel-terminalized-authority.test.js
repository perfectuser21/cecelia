import { describe, expect, it, vi } from 'vitest';

import { reconcileTerminalizedKernelAuthority } from '../executor.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

describe('reconcileTerminalizedKernelAuthority', () => {
  it('只接受与 task identity 精确匹配的 terminal v2 run authority', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: RUN_ID, phase: 'failed' }] }),
    };

    const result = await reconcileTerminalizedKernelAuthority(db, {
      taskId: TASK_ID,
      runId: RUN_ID,
      error: new Error('kernel launch failed'),
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/id = \$1[\s\S]*current_task_id = \$2[\s\S]*orchestrator_version = 'v2'/),
      [RUN_ID, TASK_ID],
    );
    expect(result).toMatchObject({
      success: false,
      taskId: TASK_ID,
      runId: RUN_ID,
      runPhase: 'failed',
      authorityExists: true,
      kernelAuthority: 'terminal',
      terminal: true,
      reason: 'kernel_terminal_authority',
    });
  });

  it('run 尚未终态或 identity 不匹配时不得相信 terminalized 自报', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const result = await reconcileTerminalizedKernelAuthority(db, {
      taskId: TASK_ID,
      runId: RUN_ID,
      error: new Error('kernel launch failed'),
    });

    expect(result).toMatchObject({
      success: false,
      taskId: TASK_ID,
      runId: RUN_ID,
      authorityUnknown: true,
      reason: 'kernel_authority_reconciliation_unavailable',
    });
    expect(result.kernelAuthority).toBeUndefined();
  });
});
