import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../migrations/374_kernel_release_runs.sql', import.meta.url),
  'utf8',
);

describe('migration 374 Kernel ReleaseRun', () => {
  it.each([
    'kernel_release_runs',
    'kernel_release_transitions',
    'kernel_release_effect_intents',
    'kernel_release_effect_receipts',
  ])('creates append-only %s authority', (table) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
  });

  it('freezes one release identity per Kernel run and exact merge SHA', () => {
    expect(sql).toMatch(/run_id UUID NOT NULL UNIQUE REFERENCES initiative_runs\(id\)/i);
    expect(sql).toMatch(/merge_sha TEXT NOT NULL/i);
    expect(sql).toMatch(/source_head_sha TEXT NOT NULL/i);
    expect(sql.match(/char_length\((?:merge_sha|source_head_sha|expected_merge_sha|observed_merge_sha)\) = 40/gi)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/artifact_versions JSONB NOT NULL/i);
    expect(sql).toMatch(/policy_version TEXT NOT NULL/i);
  });

  it('accepts only the exact six-state sequence', () => {
    for (const state of [
      'merged',
      'staging_queued',
      'staging_running',
      'staging_passed',
      'production_deploying',
      'production_verified',
    ]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toMatch(/kernel_release_transition_guard/i);
    expect(sql).toMatch(/invalid kernel release transition/i);
    expect(sql).toMatch(/UNIQUE \(release_run_id, state\)/i);
  });

  it('permits only staging and production effects and one confirmed receipt', () => {
    expect(sql).toMatch(/effect_kind IN \('staging', 'production'\)/i);
    expect(sql).toMatch(/UNIQUE \(release_run_id, effect_kind\)/i);
    expect(sql).toMatch(/receipt_status IN \('confirmed', 'failed', 'observed_unconfirmed'\)/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_release_effect_confirmed/i);
    expect(sql).toMatch(/WHERE receipt_status = 'confirmed'/i);
  });

  it('makes every ledger table immutable', () => {
    expect(sql).toMatch(/kernel_release_ledger_append_only/i);
    expect(sql.match(/BEFORE UPDATE OR DELETE/gi)).toHaveLength(4);
  });

  it('registers migration 374', () => {
    expect(sql).toMatch(/VALUES \('374', 'Kernel ReleaseRun exact-SHA authority and receipts', NOW\(\)\)/i);
  });
});
