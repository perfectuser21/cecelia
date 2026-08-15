import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const upUrl = new URL('../../migrations/427_direct_profile_frozen_contract.sql', import.meta.url);
const downUrl = new URL(
  '../../migrations/rollback/427_direct_profile_frozen_contract.down.sql',
  import.meta.url,
);

describe('migration 427 direct-profile frozen contract authority', () => {
  it('adds nullable immutable seed/provenance and enforces new direct receipts without backfill', async () => {
    const sql = await readFile(upUrl, 'utf8');

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS direct_contract_seed jsonb/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS approval_provenance jsonb/i);
    expect(sql).toMatch(/work_routing_receipts_direct_contract_seed_check/i);
    expect(sql).toMatch(/NOT VALID/i);
    expect(sql).toMatch(/hotfix-v1[\s\S]*parameter-only-v1/i);
    expect(sql).toMatch(/direct-profile-contract-seed\/v1/i);
    expect(sql).toMatch(/OCTET_LENGTH\(direct_contract_seed->>'title'\)/i);
    expect(sql).toMatch(/OCTET_LENGTH\(direct_contract_seed->>'objective'\)/i);
    expect(sql).toMatch(/reject_direct_contract_authority_mutation/i);
    expect(sql).not.toMatch(/UPDATE\s+work_routing_receipts[\s\S]+direct_contract_seed/i);
  });

  it('has a replay-safe rollback that refuses to erase born direct authority', async () => {
    const sql = await readFile(downUrl, 'utf8');

    expect(sql).toMatch(/direct_contract_seed IS NOT NULL/i);
    expect(sql).toMatch(/approval_provenance IS NOT NULL/i);
    expect(sql).toMatch(/RAISE EXCEPTION 'direct_profile_contract_authority_exists'/i);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS work_routing_receipts_direct_contract_seed_check/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS direct_contract_seed/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS approval_provenance/i);
    expect(sql).toMatch(/DELETE FROM schema_version WHERE version = '427'/i);
  });
});
