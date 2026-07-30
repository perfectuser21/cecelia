import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../migrations/376_kernel_run_trust.sql',
  import.meta.url,
);

describe('migration 376 Kernel run trust and recovery lineage', () => {
  it('adds a closed trust enum and non-destructive recovery lineage', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS record_trust_status TEXT NOT NULL DEFAULT 'untrusted'/i,
    );
    expect(sql).toMatch(/record_trust_status IN \('trusted', 'reconstructed', 'untrusted'\)/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS record_trust_reason TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS predecessor_run_id UUID/i);
    expect(sql).toMatch(
      /FOREIGN KEY\s*\(predecessor_run_id\)[\s\S]+REFERENCES initiative_runs\s*\(id\)[\s\S]+NOT VALID/i,
    );
    expect(sql).toMatch(/CREATE INDEX[\s\S]+predecessor_run_id/i);
    expect(sql).not.toMatch(/UPDATE\s+initiative_runs/i);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  });
});
