import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(
  new URL('../../migrations/373_kernel_post_diff_risk_policy.sql', import.meta.url),
  'utf8',
);

describe('migration 373 Kernel post-diff risk policy', () => {
  it('creates append-only production receipt and exact risk assessment ledgers', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_behavior_production_receipts/i);
    expect(sql).toMatch(/behavior_version TEXT NOT NULL/i);
    expect(sql).toMatch(/contract_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/path_class TEXT NOT NULL/i);
    expect(sql).toMatch(/production_head_sha TEXT NOT NULL/i);
    expect(sql).toMatch(/receipt_status TEXT NOT NULL[\s\S]*confirmed/i);
    expect(sql).toMatch(/expires_at TIMESTAMPTZ NOT NULL/i);

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_post_diff_risk_assessments/i);
    expect(sql).toMatch(/assessment_hop INTEGER NOT NULL/i);
    expect(sql).toMatch(/diff_hash TEXT NOT NULL/i);
    expect(sql).toMatch(/risk_level TEXT NOT NULL[\s\S]*low[\s\S]*medium[\s\S]*high/i);
    expect(sql).toMatch(/human_review_required BOOLEAN NOT NULL/i);
    expect(sql).toMatch(/auto_eligible BOOLEAN NOT NULL/i);
    expect(sql).toMatch(/policy_version TEXT NOT NULL/i);
    expect(sql).toMatch(/proof_expires_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*run_id,\s*head_sha,\s*diff_hash,\s*contract_digest,\s*policy_version\s*\)/i,
    );
  });

  it('links merge authorizations to the exact assessment and blocks ledger mutation', () => {
    expect(sql).toMatch(
      /ALTER TABLE kernel_merge_authorizations[\s\S]*ADD COLUMN IF NOT EXISTS risk_assessment_id UUID/i,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(risk_assessment_id\)[\s\S]*REFERENCES kernel_post_diff_risk_assessments\(id\)/i,
    );
    expect(sql).toMatch(/kernel_post_diff_risk_ledger_append_only/i);
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON kernel_behavior_production_receipts/i,
    );
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON kernel_post_diff_risk_assessments/i,
    );
    expect(sql).toMatch(
      /INSERT INTO schema_version \(version, description, applied_at\)[\s\S]*'373'/i,
    );
  });
});
