import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../migrations/384_decisions_nfr_category.sql', import.meta.url),
  'utf8',
);

describe('migration 384 decisions_nfr_category', () => {
  it('drops and re-adds the category CHECK constraint (idempotent)', () => {
    expect(sql).toMatch(/ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_category_chk/);
    expect(sql).toMatch(/ALTER TABLE decisions ADD CONSTRAINT decisions_category_chk/);
  });

  it('CHECK constraint allows NULL category', () => {
    expect(sql).toMatch(/category IS NULL/);
  });

  it('CHECK constraint includes all expected categories', () => {
    const required = [
      'architecture',
      'bug-fix',
      'decision',
      'deployment',
      'feature',
      'governance',
      'infra',
      'invariant',
      'judgment',
      'nfr',
      'small-change',
      'technical',
      'testing',
    ];
    for (const cat of required) {
      expect(sql).toContain(`'${cat}'`);
    }
  });

  it('nfr category is explicitly listed (definition of done)', () => {
    expect(sql).toMatch(/'nfr'/);
  });

  it('records schema_version 384 (ON CONFLICT DO NOTHING)', () => {
    expect(sql).toMatch(/INSERT INTO schema_version/);
    expect(sql).toMatch(/'384'/);
    expect(sql).toMatch(/ON CONFLICT.*DO NOTHING/);
  });

  it('adds COMMENT explaining nfr semantics and no-manual-fill rule', () => {
    expect(sql).toMatch(/COMMENT ON COLUMN decisions\.category/);
    expect(sql).toMatch(/nfr/);
    expect(sql).toMatch(/assertion_ref/);
  });
});
