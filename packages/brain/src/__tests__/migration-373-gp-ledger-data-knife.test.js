import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(here, '../../migrations/373_gp_ledger_data_knife.sql');

describe('migration 373 Golden Path ledger data knife contract', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('adds journey_step to constrained decision targets', () => {
    expect(sql).toMatch(/decisions_target_type_chk/);
    expect(sql).toMatch(/'journey_step'/);
  });

  it('seeds deterministic step-scoped NFR decisions', () => {
    expect(sql).toContain("category");
    expect(sql).toContain("'nfr'");
    expect(sql).toContain("'step'");
    expect(sql).toContain("'journey_step'");
    for (const step of ['s1', 's2', 's3', 's4']) {
      expect(sql).toContain(`gp-ledger-phase3:nfr:gp-b:${step}`);
    }
  });

  it('backfills real feature anchors and normalizes semantic refs', () => {
    expect(sql).toMatch(/unit_test_path/);
    expect(sql).toMatch(/workflow_ref/);
    expect(sql).toMatch(/guard_ref/);
    expect(sql).toContain('decision:');
  });

  it('does not create fake planned anchors and removes evidence-less positive states', () => {
    expect(sql).not.toContain('planned:');
    expect(sql).toMatch(/cell_status\s*=\s*'red'/);
    expect(sql).toMatch(/cell_status\s+IN\s*\(\s*'green'\s*,\s*'pending'\s*\)/);
  });
});
