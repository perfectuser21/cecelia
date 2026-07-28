import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../migrations/375_kernel_equivalence_runtime.sql', import.meta.url),
  'utf8',
);

describe('provisional migration 375 Kernel equivalence runtime', () => {
  it('documents the ReleaseRun integration dependency and provisional number', () => {
    expect(sql).toMatch(/provisional/i);
    expect(sql).toMatch(/depends on migration 374.*ReleaseRun/i);
    expect(sql).toMatch(/integration may renumber/i);
  });

  it('atomically deduplicates both grant and nonce identities', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_equivalence_execution_nonces/i);
    expect(sql).toMatch(/grant_id UUID PRIMARY KEY/i);
    expect(sql).toMatch(/nonce UUID NOT NULL UNIQUE/i);
    expect(sql).toMatch(/expires_at TIMESTAMPTZ NOT NULL/i);
  });

  it('stores allowlisted denial audits and immutable bundles', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_equivalence_denial_audits/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_equivalence_receipt_bundles/i);
    expect(sql).toMatch(/bundle JSONB NOT NULL/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON kernel_equivalence_execution_nonces/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON kernel_equivalence_denial_audits/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON kernel_equivalence_receipt_bundles/i);
    expect(sql).toMatch(/append-only/i);
  });

  it('keeps a dedicated CAS head and indexes exact violation predecessors', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_equivalence_bundle_chain_heads/i);
    expect(sql).toMatch(/revision BIGINT NOT NULL DEFAULT 0/i);
    expect(sql).toMatch(/genesis_hash TEXT/i);
    expect(sql).toMatch(/head_hash TEXT/i);
    expect(sql).toMatch(/idx_kernel_equivalence_predecessor/i);
    expect(sql).toMatch(/cell_id, run_id, attempt_id, artifact_sha/i);
  });

  it('is rerunnable and registers its provisional schema version', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/g);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/g);
    expect(sql).toMatch(/VALUES \('375'/i);
    expect(sql).toMatch(/ON CONFLICT \(version\) DO NOTHING/i);
  });
});
