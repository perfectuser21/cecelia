import { describe, it, expect } from 'vitest';

describe('Knife 4 有头无头动作闸与 Generator 信任边界', () => {
  it('validation API 强制 internal Bearer 认证并导出完整稳定 reason code 合同', async () => {
    const route = await import('../../../packages/brain/src/routes/work-routing.js');
    expect(route.RECEIPT_VALIDATION_SUCCESS_KEYS).toEqual([
      'base_sha', 'branch', 'repo', 'routing_receipt_id', 'run_id', 'task_id', 'valid',
    ]);
    expect(route.RECEIPT_VALIDATION_REASON_CODES).toEqual(expect.arrayContaining([
      'auth_required', 'auth_invalid', 'receipt_not_found', 'receipt_expired',
      'receipt_superseded', 'task_mismatch', 'run_mismatch', 'repo_mismatch',
      'branch_mismatch', 'base_sha_mismatch', 'brain_unavailable',
    ]));
  });

  it('receipt 无效时动作前 fail closed，Generator 无 push/callback/lease 能力', async () => {
    const g = await import('../../../packages/brain/src/work-routing-guard.js');
    for (const reason of ['missing','expired','superseded','brain_unreachable','repo_mismatch','branch_mismatch','base_sha_mismatch']) {
      expect(await g.validateMutationReceipt({ mutationCapable:true, receiptState:reason })).toMatchObject({ allowed:false, exit_code:2 });
    }
    expect(await g.validateMutationReceipt({ mutationCapable:false, receiptState:'missing' })).toMatchObject({ allowed:true });
    expect(g.generatorTrustBoundary()).toMatchObject({ blocked_pushurl:true, non_privileged_uid:true, capabilities:[], callback_token:false, lease_credentials:false, frozen_baseline:true });
  });
});
