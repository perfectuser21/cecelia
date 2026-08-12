import { describe, expect, it, vi } from 'vitest';

import { resolveCompletedRepairGaps } from '../gap-resolution.js';

const REPAIR_TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const GAP_ID = '33333333-3333-4333-8333-333333333333';
const RECEIPT_ID = '44444444-4444-4444-8444-444444444444';
const REVISION = 'a'.repeat(40);

describe('completed repair gap resolution', () => {
  it('只用当前 repair run 的可信 receipt 自动关闭 verifying gap', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{
      gap_id: GAP_ID,
      receipt_id: RECEIPT_ID,
      assertion_id: 'assert-brain',
      current_revision: REVISION,
    }] })) };
    const transitionGap = vi.fn().mockResolvedValue({ gap: { status: 'resolved' } });

    const result = await resolveCompletedRepairGaps(db, {
      repairTaskId: REPAIR_TASK_ID,
      runId: RUN_ID,
      transitionGap,
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('verification_run.current_task_id = gap.repair_task_id');
    expect(sql).toContain("gap.status = 'verifying'");
    expect(sql).toContain("assertion.value->'source_bindings'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('missing_binding');
    expect(params).toEqual([REPAIR_TASK_ID, RUN_ID]);
    expect(transitionGap).toHaveBeenCalledWith(db, GAP_ID, 'resolved', {
      actor: 'cecelia-brain',
      idempotencyKey: `auto-resolved:${GAP_ID}:${RECEIPT_ID}`,
      detail: { repair_task_id: REPAIR_TASK_ID, run_id: RUN_ID },
      resolutionEvidence: {
        assertion_id: 'assert-brain',
        receipt_id: RECEIPT_ID,
        revision: REVISION,
      },
    });
    expect(result).toEqual({ resolved: 1, gapIds: [GAP_ID] });
  });

  it('没有当前 run 的回执时保持 fail-closed', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const transitionGap = vi.fn();

    await expect(resolveCompletedRepairGaps(db, {
      repairTaskId: REPAIR_TASK_ID,
      runId: RUN_ID,
      transitionGap,
    })).resolves.toEqual({ resolved: 0, gapIds: [] });
    expect(transitionGap).not.toHaveBeenCalled();
  });
});
