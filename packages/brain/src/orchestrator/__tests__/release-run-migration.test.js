import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const published374Sql = readFileSync(
  new URL('../../../migrations/374_kernel_release_runs.sql', import.meta.url),
  'utf8',
);
const closureSql = readFileSync(
  new URL('../../../migrations/375_kernel_release_run_closure.sql', import.meta.url),
  'utf8',
);
const sql = `${published374Sql}\n${closureSql}`;

describe('migration 374 Kernel ReleaseRun', () => {
  const releaseLedgerTables = [
    'kernel_release_runs',
    'kernel_release_transitions',
    'kernel_release_effect_intents',
    'kernel_release_effect_receipts',
    'kernel_release_e2e_manifests',
    'kernel_release_rollback_intents',
    'kernel_release_rollback_receipts',
    'kernel_release_rollback_artifact_intents',
    'kernel_release_rollback_artifact_receipts',
    'kernel_release_blocked_escalations',
  ];
  const bootstrapLedgerTables = [
    'kernel_release_bootstrap_runs',
    'kernel_release_bootstrap_transitions',
    'kernel_release_bootstrap_effect_attempts',
    'kernel_release_bootstrap_effect_attempt_renewals',
    'kernel_release_bootstrap_effect_receipts',
    'kernel_release_bootstrap_e2e_manifests',
    'kernel_release_bootstrap_rollback_artifact_intents',
    'kernel_release_bootstrap_rollback_artifact_receipts',
  ];

  it('keeps the published migration byte-for-byte immutable', () => {
    expect(createHash('sha256').update(published374Sql).digest('hex'))
      .toBe('d6580a018fde6dbd87b4d3845e46aafb3c18ab3eaed25b5e3bd7319a1538ba48');
  });

  it.each([...releaseLedgerTables, ...bootstrapLedgerTables])(
    'creates append-only %s authority',
    (table) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
    expect(sql).toMatch(new RegExp(
      `CREATE TRIGGER[\\s\\S]+?BEFORE UPDATE OR DELETE ON ${table}`,
      'i',
    ));
    expect(sql).toMatch(new RegExp(
      `CREATE TRIGGER[\\s\\S]+?BEFORE TRUNCATE ON ${table}`,
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
    expect(sql).toMatch(/kernel_release_run_identity_guard/i);
    expect(sql).toMatch(/receipt\.id = NEW\.merge_receipt_id/i);
    expect(sql).toMatch(/intent\.id = NEW\.merge_intent_id/i);
    expect(sql).toMatch(/receipt\.evidence->>'merge_commit_sha' = NEW\.merge_sha/i);
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

  it('requires exact confirmed receipts before success transitions', () => {
    expect(sql).toMatch(/kernel_release_effect_receipt_guard/i);
    expect(sql).toMatch(/confirmed release receipt requires exact merge SHA/i);
    expect(sql).toMatch(/confirmed release receipt requires exact artifact versions/i);
    expect(sql).toMatch(/confirmed staging receipt requires pass verification/i);
    expect(sql).toMatch(/confirmed production receipt requires health and E2E verification/i);
    expect(sql).toMatch(/staging_passed requires confirmed staging effect receipt/i);
    expect(sql).toMatch(/production_verified requires confirmed production effect receipt/i);
    expect(sql).toMatch(/NEW\.evidence->>'effect_receipt_id' = receipt\.id::text/i);
    expect(sql).toMatch(/NEW\.evidence->>'e2e_manifest_digest' = receipt\.e2e_manifest_digest/i);
  });

  it('persists exact rollback intent before production and receipt before success', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_rollback_intents/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_rollback_receipts/i);
    expect(sql).toMatch(/rollback intent requires exact ReleaseRun identity/i);
    expect(sql).toMatch(/rollback receipt requires exact confirmed production readback/i);
    expect(sql).toMatch(/production_verified requires exact durable rollback receipt/i);
    expect(sql).toMatch(/NEW\.evidence->>'rollback_receipt_id' = rollback_receipt\.id::text/i);
  });

  it('persists a unique P0 escalation for every ReleaseRun BLOCKED condition', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_blocked_escalations/i);
    expect(sql).toMatch(/severity TEXT NOT NULL CHECK \(severity = 'P0'\)/i);
    expect(sql).toMatch(/dedup_key TEXT NOT NULL UNIQUE/i);
  });

  it('freezes one non-empty contract E2E manifest per exact release authority', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_e2e_manifests[\s\S]+?release_run_id UUID NOT NULL UNIQUE REFERENCES kernel_release_runs\(id\)/i,
    );
    expect(sql).toMatch(/contract_id UUID NOT NULL REFERENCES initiative_contracts\(id\)/i);
    expect(sql).toMatch(/run_id UUID NOT NULL REFERENCES initiative_runs\(id\)/i);
    expect(sql).toMatch(/repository TEXT NOT NULL/i);
    expect(sql).toMatch(/artifact_versions JSONB NOT NULL/i);
    expect(sql).toMatch(/artifact_set_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/contract_version INTEGER NOT NULL/i);
    expect(sql).toMatch(/contract_approved_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/contract_content TEXT NOT NULL/i);
    expect(sql).toMatch(/contract_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/e2e_acceptance_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/policy_version TEXT NOT NULL CHECK \(policy_version = 'kernel-release-e2e\/v1'\)/i);
    expect(sql).toMatch(/manifest_digest TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/scenarios_total INTEGER NOT NULL CHECK \([\s\S]+?scenarios_total > 0/i);
    expect(sql).toMatch(/e2e_manifest_id UUID[\s\S]+?REFERENCES kernel_release_e2e_manifests\(id\)/i);
    expect(sql).toMatch(/confirmed release receipt requires exact E2E manifest/i);
    expect(sql).toMatch(/kernel_release_contract_immutability_guard/i);
    expect(sql).toMatch(/referenced approved contract is immutable/i);
  });

  it('types exact environment and per-scenario E2E receipt evidence', () => {
    expect(sql).toMatch(/e2e_environment TEXT CHECK[\s\S]+?'staging', 'production'/i);
    expect(sql).toMatch(/e2e_scenario_results JSONB/i);
    expect(sql).toMatch(/e2e_started_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/e2e_finished_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/jsonb_array_length\(NEW\.e2e_scenario_results\)/i);
    expect(sql).toMatch(/result->>'status' IS DISTINCT FROM 'pass'/i);
    expect(sql).toMatch(/result->>'log_digest'/i);
    expect(sql).toMatch(/count\(\*\)[\s\S]+?FROM jsonb_object_keys\(/i);
    expect(sql).toMatch(/result->>'name'[\s\S]+?manifest\.e2e_acceptance->'scenarios'/i);
  });

  it('fences confirmed receipts to the latest live observed dispatch generation', () => {
    expect(sql).toMatch(/kernel_release_effect_dispatch_renewals/i);
    expect(sql).toMatch(/dispatch_claim_id BIGINT[\s\S]+?REFERENCES kernel_release_effect_dispatch_claims\(id\)/i);
    expect(sql).toMatch(/dispatch_generation INTEGER/i);
    expect(sql).toMatch(/generation = NEW\.dispatch_generation/i);
    expect(sql).toMatch(/claim\.claim_mode IS DISTINCT FROM 'verification'/i);
    expect(sql).toMatch(/outcome\.outcome IS DISTINCT FROM 'observed'/i);
    expect(sql).toMatch(/effective_lease_expires_at <= clock_timestamp\(\)/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_release_dispatch_outcome_claim[\s\S]+?dispatch_claim_id/i,
    );
  });

  it('makes every ledger table immutable', () => {
    expect(sql).toMatch(/kernel_release_ledger_append_only/i);
    expect(sql).toMatch(/append_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE/i);
    expect(sql).toMatch(/BEFORE TRUNCATE ON kernel_release_effect_receipts/i);
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

  it('binds bootstrap to a frozen approved contract E2E manifest', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_e2e_manifests[\s\S]+?bootstrap_run_id UUID NOT NULL UNIQUE REFERENCES kernel_release_bootstrap_runs\(id\)/i,
    );
    expect(sql).toMatch(/contract_id UUID NOT NULL REFERENCES initiative_contracts\(id\)/i);
    expect(sql).toMatch(/artifact_versions JSONB NOT NULL/i);
    expect(sql).toMatch(/artifact_set_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/contract_version INTEGER NOT NULL/i);
    expect(sql).toMatch(/contract_approved_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/contract_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/e2e_acceptance_digest TEXT NOT NULL/i);
    expect(sql).toMatch(/merge_sha TEXT NOT NULL CHECK/i);
    expect(sql).toMatch(/manifest_digest TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/scenarios_total INTEGER NOT NULL CHECK \([\s\S]+?scenarios_total > 0/i);
    expect(sql).toMatch(/e2e_manifest_digest TEXT CHECK/i);
    expect(sql).toMatch(/confirmed bootstrap receipt requires exact E2E manifest/i);
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
    expect(sql).toMatch(/staging_passed requires confirmed staging effect receipt/i);
    expect(sql).toMatch(/production_verified requires confirmed production effect receipt/i);
    expect(sql).toMatch(/bootstrap transition requires exact merge SHA evidence/i);
    expect(sql).toMatch(/NEW\.evidence->>'effect_receipt_id' = r\.id::text/i);
    expect(sql).toMatch(/NEW\.evidence->>'e2e_manifest_digest' = r\.e2e_manifest_digest/i);
  });

  it('persists expiring generations and durable receipts for crash recovery', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_attempts[\s\S]+?generation INTEGER NOT NULL/i,
    );
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/kernel_release_bootstrap_effect_attempt_renewals/i);
    expect(sql).toMatch(/effective_lease_expires_at/i);
    expect(sql).toMatch(/idempotency_key UUID NOT NULL/i);
    expect(sql).toMatch(/UNIQUE \(bootstrap_run_id, effect_kind, generation\)/i);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_effect_receipts[\s\S]+?effect_attempt_id[\s\S]+?REFERENCES kernel_release_bootstrap_effect_attempts\(id\)/i,
    );
    expect(sql).not.toMatch(/effect_attempt_id BIGINT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/uq_kernel_release_bootstrap_attempt_confirmed/i);
    expect(sql).toMatch(
      /ON kernel_release_bootstrap_effect_receipts \(effect_attempt_id\)[\s\S]+?WHERE receipt_status = 'confirmed'/i,
    );
    expect(sql).toMatch(/confirmed bootstrap receipt requires latest live attempt generation/i);
  });

  it('registers migration 374', () => {
    expect(published374Sql).toMatch(/VALUES \('374', 'Kernel ReleaseRun exact-SHA authority and receipts', NOW\(\)\)/i);
  });
});

describe('migration 375 installed-v374 reconciliation', () => {
  it('is additive over the published v374 tables instead of republishing them', () => {
    for (const table of [
      'kernel_release_runs',
      'kernel_release_transitions',
      'kernel_release_effect_intents',
      'kernel_release_effect_receipts',
      'kernel_release_effect_dispatch_claims',
      'kernel_release_effect_dispatch_outcomes',
      'kernel_release_bootstrap_runs',
      'kernel_release_bootstrap_transitions',
      'kernel_release_bootstrap_effect_attempts',
      'kernel_release_bootstrap_effect_receipts',
    ]) {
      expect(closureSql).not.toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
    expect(closureSql).not.toContain("VALUES ('374'");
  });

  it('adds every field that did not exist in the shipped v374 schema', () => {
    expect(closureSql).toMatch(
      /ALTER TABLE kernel_release_effect_dispatch_claims[\s\S]+?ADD COLUMN IF NOT EXISTS claim_mode/i,
    );
    expect(closureSql).toMatch(
      /ALTER TABLE kernel_release_effect_receipts[\s\S]+?ADD COLUMN IF NOT EXISTS dispatch_claim_id/i,
    );
    expect(closureSql).toMatch(
      /ALTER TABLE kernel_release_effect_receipts[\s\S]+?ADD COLUMN IF NOT EXISTS e2e_manifest_id/i,
    );
    expect(closureSql).toMatch(
      /ALTER TABLE kernel_release_bootstrap_effect_receipts[\s\S]+?ADD COLUMN IF NOT EXISTS observed_merge_sha/i,
    );
    expect(closureSql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_effect_dispatch_renewals/i);
    expect(closureSql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_e2e_manifests/i);
    expect(closureSql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_e2e_manifests/i);
    expect(closureSql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_rollback_intents/i);
    expect(closureSql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_release_blocked_escalations/i);
  });

  it('stores rollback authority and receipts per exact artifact for normal and bootstrap runs', () => {
    for (const table of [
      'kernel_release_rollback_artifact_intents',
      'kernel_release_rollback_artifact_receipts',
      'kernel_release_bootstrap_rollback_artifact_intents',
      'kernel_release_bootstrap_rollback_artifact_receipts',
    ]) {
      expect(closureSql).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
    expect(closureSql).toMatch(/UNIQUE \(rollback_intent_id, artifact_name\)/i);
    expect(closureSql).toMatch(/UNIQUE \(bootstrap_run_id, artifact_name\)/i);
    expect(closureSql).toMatch(/expected_previous_version TEXT NOT NULL/i);
    expect(closureSql).toMatch(/expected_previous_digest TEXT NOT NULL/i);
  });

  it('replaces the guards and registers migration 375', () => {
    expect(closureSql).toMatch(/kernel_release_run_identity_guard/i);
    expect(closureSql).toMatch(
      /confirmed release receipt requires latest live observed dispatch generation/i,
    );
    expect(closureSql).toMatch(/confirmed bootstrap receipt requires latest live attempt generation/i);
    expect(closureSql).toMatch(/BEFORE TRUNCATE ON kernel_release_effect_receipts/i);
    expect(closureSql).toMatch(
      /VALUES \('375', 'Fence and close Kernel ReleaseRun authority and receipts', NOW\(\)\)/i,
    );
  });
});
