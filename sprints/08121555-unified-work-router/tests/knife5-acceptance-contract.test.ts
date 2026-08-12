import { describe, it, expect } from 'vitest';

describe('Knife 5 迁移、观测与 scratch 真实验收合同', () => {
  it('smoke receipt 明确证明三 coding、三对照、stale/resume 与审计', async () => {
    const s = await import('../../../packages/brain/src/unified-work-router-acceptance.js');
    const receipt = await s.readLatestScratchAcceptanceReceipt();
    expect(receipt.coding).toMatchObject({ total:3, with_routing_receipt:3, harness_initiative:3, correct_repo_map:3, active_impact_contract:3 });
    expect(receipt.controls).toMatchObject({ content:'content', research:'research', coding_review:'code_review', review_fix_child:'harness' });
    expect(receipt.stale_resume).toMatchObject({ blocked_before_provider:true, resumed_after_refresh:true, failure_audit_preserved:true });
    expect(receipt.generator).toMatchObject({ callback_token_visible:false, lease_credentials_visible:false, provider_push_succeeded:false, trusted_transport_published:true });
    expect(receipt.direct_coding_dev).toBe(0);
  });
});
