import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../migrations/381_kernel_equivalence_production_controller.sql',
  import.meta.url,
);

describe('migration 381 Kernel equivalence production controller', () => {
  it('binds every executable case to authoritative Attempt and result receipt facts', () => {
    const sql = readFileSync(migrationUrl, 'utf8');

    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_production_case_bindings/i,
    );
    expect(sql).toMatch(
      /result_receipt_id UUID NOT NULL\s+REFERENCES harness_result_receipts\(receipt_id\)/i,
    );
    expect(sql).not.toMatch(/result_receipt_id UUID NOT NULL UNIQUE/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_case_binding_receipt\s+ON kernel_equivalence_production_case_bindings \(result_receipt_id\)/i,
    );
    expect(sql).toMatch(/provider_session_id TEXT NOT NULL/i);
    expect(sql).toMatch(/actual_machine_id TEXT NOT NULL/i);
    expect(sql).toMatch(
      /execution_transport TEXT NOT NULL CHECK \(execution_transport = 'fleet-worker'\)/i,
    );
    expect(sql).toMatch(/task_bundle_sha256 TEXT NOT NULL/i);
    expect(sql).toMatch(/artifact_sha TEXT NOT NULL/i);

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_case_binding_guard\(\)/i,
    );
    expect(sql).toMatch(/JOIN harness_attempts attempts/i);
    expect(sql).toMatch(/JOIN harness_result_receipts receipts/i);
    expect(sql).toMatch(
      /JOIN kernel_equivalence_production_case_leases leases[\s\S]*leases\.owner_id[\s\S]*brain\.kernel_equivalence\.production_cases[\s\S]*leases\.state = 'prepared'[\s\S]*leases\.lease_expires_at > clock_timestamp\(\)/i,
    );
    expect(sql).toMatch(/attempts\.provider = cases\.provider/i);
    expect(sql).toMatch(/receipts\.provider = cases\.provider/i);
    expect(sql).toMatch(/receipts\.requested_provider = cases\.provider/i);
    expect(sql).toMatch(
      /receipts\.provider_session_id = attempts\.provider_session_id/i,
    );
    expect(sql).toMatch(
      /attempts\.actual_machine_id = NEW\.actual_machine_id/i,
    );
    expect(sql).toMatch(
      /attempts\.machine_attestation_status = 'verified'/i,
    );
    expect(sql).toMatch(
      /attempts\.task_bundle\s+#>> '\{inputs,workspace_spec,expected_head_sha\}' = cases\.artifact_sha/i,
    );
    expect(sql).toMatch(/cases\.resource_type = 'ephemeral_run'/i);
    expect(sql).toMatch(/cases\.resource_id = attempts\.id::text/i);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_bound_attempt_immutable\(\)/i,
    );
    expect(sql).toMatch(
      /OLD\.provider IS DISTINCT FROM NEW\.provider/i,
    );
    expect(sql).toMatch(
      /OLD\.provider_session_id IS DISTINCT FROM NEW\.provider_session_id/i,
    );
    expect(sql).toMatch(
      /OLD\.actual_machine_id IS DISTINCT FROM NEW\.actual_machine_id/i,
    );
    expect(sql).toMatch(
      /OLD\.task_bundle IS DISTINCT FROM NEW\.task_bundle/i,
    );
    expect(sql).toMatch(
      /OLD\.status IS DISTINCT FROM NEW\.status/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_kernel_equivalence_bound_attempt_immutable\s+BEFORE UPDATE ON harness_attempts/is,
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_production_execution_fences/i,
    );
    expect(sql).toMatch(
      /kernel equivalence production execution claim authority unavailable/i,
    );
    expect(sql).toMatch(
      /active production execution blocks lease transition/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_kernel_equivalence_execution_fence_update_guard\s+BEFORE UPDATE ON kernel_equivalence_production_execution_fences/is,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_kernel_equivalence_execution_fences_no_delete\s+BEFORE DELETE ON kernel_equivalence_production_execution_fences/is,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_kernel_equivalence_execution_fences_no_truncate\s+BEFORE TRUNCATE ON kernel_equivalence_production_execution_fences/is,
    );
  });

  it('persists append-only controller settlement events for startup reconciliation', () => {
    const sql = readFileSync(migrationUrl, 'utf8');

    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_production_execution_events/i,
    );
    expect(sql).toMatch(
      /state TEXT NOT NULL CHECK \(state IN \(\s*'claimed',\s*'grant_issued',\s*'executing',\s*'reconciling',\s*'succeeded',\s*'blocked',\s*'settlement_unknown'/is,
    );
    expect(sql).toMatch(/controller_lease_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(
      /UNIQUE \(case_id, generation\)/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_execution_event_guard\(\)/i,
    );
    expect(sql).toMatch(
      /NEW\.state = 'reconciling'[\s\S]*previous_lease_expires_at <= clock_timestamp\(\)/i,
    );
    expect(sql).toMatch(
      /previous_state IN \(\s*'claimed',\s*'grant_issued',\s*'executing',\s*'reconciling'\s*\)/is,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_kernel_equivalence_execution_events_append_only/i,
    );
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON kernel_equivalence_production_execution_events/i,
    );
    expect(sql).toMatch(
      /BEFORE TRUNCATE ON kernel_equivalence_production_execution_events/i,
    );
    expect(sql).toMatch(
      /VALUES \('381', 'kernel_equivalence_production_controller'\)/i,
    );
  });
});
