import { describe, expect, it, vi } from 'vitest';

import { resolvePlannerRecoveryRunAuthority } from '../planner-recovery-run-authority.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RECEIPT_ID = '22222222-2222-4222-8222-222222222222';
const PREDECESSOR_ID = '33333333-3333-4333-8333-333333333333';
const ROUTE_ID = '44444444-4444-4444-8444-444444444444';
const INITIATIVE_ID = '55555555-5555-4555-8555-555555555555';

function authorityRow() {
  return {
    receipt_id: RECEIPT_ID,
    predecessor_run_id: PREDECESSOR_ID,
    source_task_id: '66666666-6666-4666-8666-666666666666',
    successor_task_id: TASK_ID,
    routing_receipt_id: ROUTE_ID,
    initiative_id: INITIATIVE_ID,
    predecessor_task_id: '66666666-6666-4666-8666-666666666666',
    predecessor_phase: 'failed',
    orchestrator_version: 'v2',
    record_trust_status: 'trusted',
    source_task_status: 'failed',
  };
}

describe('Planner recovery run authority', () => {
  it('cannot downgrade a consumed successor by deleting its mutable payload binding', async () => {
    const client = { query: vi.fn(async () => ({ rows: [authorityRow()] })) };

    await expect(resolvePlannerRecoveryRunAuthority(client, {
      task: { id: TASK_ID, payload: {} },
      input: { initiativeId: INITIATIVE_ID, createdSource: 'kernel_dispatch' },
    })).rejects.toMatchObject({ code: 'planner_recovery_run_authority_invalid' });
    expect(client.query).toHaveBeenCalledOnce();
  });

  it('leaves an ordinary task ordinary only when no immutable consumption exists', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };

    await expect(resolvePlannerRecoveryRunAuthority(client, {
      task: { id: TASK_ID, payload: {} },
      input: { initiativeId: INITIATIVE_ID, createdSource: 'kernel_dispatch' },
    })).resolves.toBeNull();
  });
});
