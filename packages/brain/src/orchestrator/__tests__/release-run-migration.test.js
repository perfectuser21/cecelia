import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../migrations/374_kernel_release_runs.sql', import.meta.url),
  'utf8',
);

describe('migration 374 Kernel ReleaseRun', () => {
  const releaseLedgerTables = [
    'kernel_release_runs',
    'kernel_release_transitions',
    'kernel_release_effect_intents',
    'kernel_release_effect_receipts',
  ];
  const bootstrapLedgerTables = [
    'kernel_release_bootstrap_runs',
    'kernel_release_bootstrap_transitions',
    'kernel_release_bootstrap_effect_attempts',
    'kernel_release_bootstrap_effect_receipts',
  ];

  it.each([...releaseLedgerTables, ...bootstrapLedgerTables])(
    'creates append-only %s authority',
    (table) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
    expect(sql).toMatch(new RegExp(
      `CREATE TRIGGER[\\s\\S]+?BEFORE UPDATE OR DELETE ON ${table}`,
      'i',
    ));
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
    expect(sql).toMatch(/append_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE/i);
  });

  it('defines a one-time bootstrap identity bound to all approved release axes', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_runs[\s\S]+?singleton BOOLEAN NOT NULL UNIQUE/i,
    );
    for (const column of [
      'repository TEXT NOT NULL',
      'pr_number INTEGER NOT NULL',
      'source_head_sha TEXT NOT NULL',
      'merge_sha TEXT NOT NULL',
      'approved_by TEXT NOT NULL',
      'approval_key_id TEXT NOT NULL',
      'approval_digest TEXT NOT NULL',
    ]) {
      expect(sql).toMatch(new RegExp(column, 'i'));
    }
  });

  it('enforces the bootstrap staging-before-production transition sequence', () => {
    for (const state of [
      'approved',
      'staging_intent',
      'staging_passed',
      'production_intent',
      'production_verified',
    ]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toMatch(/kernel_release_bootstrap_transition_guard/i);
    expect(sql).toMatch(/previous_state IS NULL THEN 'approved'/i);
    expect(sql).toMatch(/previous_state = 'approved' THEN 'staging_intent'/i);
    expect(sql).toMatch(/previous_state = 'staging_intent' THEN 'staging_passed'/i);
    expect(sql).toMatch(/previous_state = 'staging_passed' THEN 'production_intent'/i);
    expect(sql).toMatch(/previous_state = 'production_intent' THEN 'production_verified'/i);
    expect(sql).toMatch(/UNIQUE \(bootstrap_run_id, state\)/i);
  });

  it('persists expiring generations and durable receipts for crash recovery', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_attempts[\s\S]+?generation INTEGER NOT NULL/i,
    );
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/idempotency_key UUID NOT NULL/i);
    expect(sql).toMatch(/UNIQUE \(bootstrap_run_id, effect_kind, generation\)/i);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_receipts[\s\S]+?effect_attempt_id[\s\S]+?REFERENCES kernel_release_bootstrap_effect_attempts\(id\)/i,
    );
  });

  it('registers migration 374', () => {
    expect(sql).toMatch(/VALUES \('374', 'Kernel ReleaseRun exact-SHA authority and receipts', NOW\(\)\)/i);
  });
});
