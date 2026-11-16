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

});
