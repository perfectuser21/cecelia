import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../migrations/371_kernel_merge_effect_receipts.sql', import.meta.url),
  'utf8',
);

describe('migration 371 kernel merge effect receipts', () => {
  it.each([
    'kernel_pr_ownership',
    'kernel_pr_head_observations',
    'kernel_merge_authorizations',
    'kernel_merge_effect_intents',
    'kernel_merge_effect_receipts',
  ])('creates %s', (table) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
  });

  it('fences one PR owner per run and one effect intent per authorization', () => {
    expect(sql).toMatch(/UNIQUE\s*\(run_id\)/i);
    expect(sql).toMatch(/authorization_id UUID NOT NULL UNIQUE/i);
    expect(sql).toMatch(/UNIQUE\s*\(ownership_id,\s*head_sha,\s*policy_version\)/i);
  });

  it('keeps every merge authority row append-only', () => {
    expect(sql).toMatch(/kernel_merge_ledger_append_only/i);
    expect(sql.match(/BEFORE UPDATE OR DELETE/gi)).toHaveLength(5);
  });

  it('allows only one confirmed receipt per effect intent', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_merge_receipt_confirmed/i);
    expect(sql).toMatch(/WHERE receipt_status = 'confirmed'/i);
  });

  it('anchors all mutable PR evidence to exact 40-character SHAs', () => {
    expect(sql.match(/char_length\(head_sha\) = 40/gi)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/observed_head_sha TEXT NOT NULL/i);
  });
});
