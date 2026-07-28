import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../migrations/377_kernel_equivalence_production_cases.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('migration 377 Kernel equivalence production cases', () => {
  it('is additive after ReleaseRun 374/375 and trusted runtime 376', () => {
    expect(sql).toMatch(/ReleaseRun owns migrations 374 and 375/i);
    expect(sql).toMatch(/trusted runtime owns migration 376/i);
    expect(sql).toMatch(/does not overwrite/i);
  });

  it('pins every case to the complete signed execution boundary', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_production_cases/i,
    );
    for (const column of [
      'case_id UUID PRIMARY KEY',
      'cell_id TEXT NOT NULL',
      'behavior_id TEXT NOT NULL',
      'provider TEXT NOT NULL',
      'scenario TEXT NOT NULL',
      'seam_id TEXT NOT NULL',
      'adapter_id TEXT NOT NULL',
      'run_id UUID NOT NULL REFERENCES initiative_runs\\(id\\)',
      'attempt_id UUID NOT NULL REFERENCES harness_attempts\\(id\\)',
      'artifact_sha TEXT NOT NULL',
      'brain_version TEXT NOT NULL',
      'engine_version TEXT NOT NULL',
      'resource_type TEXT NOT NULL',
      'resource_prefix TEXT NOT NULL',
      'resource_id TEXT NOT NULL',
      'resource_ref TEXT NOT NULL',
      'expires_at TIMESTAMPTZ NOT NULL',
    ]) {
      expect(sql).toMatch(new RegExp(column, 'i'));
    }
    expect(sql).toMatch(/UNIQUE \(cell_id, run_id, attempt_id, resource_id\)/i);
    expect(sql).toMatch(/UNIQUE \(resource_ref\)/i);
    expect(sql).toMatch(/kernel_equivalence_production_case_run_guard/i);
  });

  it('allowlists the eleven seams, providers, scenarios, and resource classes', () => {
    for (const seam of [
      'kernel.workspace.protected_ref_guard',
      'kernel.credential.attempt_lease',
      'kernel.github.mutation_broker',
      'kernel.merge.effect_executor',
      'kernel.evaluation.independent_judge',
      'kernel.merge.human_review_authority',
      'kernel.release.staging_promotion',
      'kernel.liveness.orphan_recovery',
      'kernel.quality.devgate',
      'kernel.controller.attempt_ownership',
      'kernel.closure.report_learning',
    ]) {
      expect(sql).toContain(`'${seam}'`);
    }
    expect(sql).toMatch(/provider IN \('claude', 'codex', 'grok'\)/i);
    expect(sql).toMatch(/scenario IN \('normal', 'violation', 'recovery'\)/i);
    for (const resourceType of [
      'ephemeral_branch',
      'ephemeral_credential_lease',
      'ephemeral_database_record',
      'ephemeral_run',
      'ephemeral_staging',
      'ephemeral_workspace',
    ]) {
      expect(sql).toContain(`'${resourceType}'`);
    }
    expect(sql).toMatch(
      /resource_prefix\s+~\s+'\^\(\?:refs\/heads\/\)\?equivalence-drill\//i,
    );
    expect(sql).toMatch(
      /cell_id\s*=\s*behavior_id\s*\|\|\s*'::'\s*\|\|\s*provider\s*\|\|\s*'::'\s*\|\|\s*scenario/i,
    );
    for (const [behaviorId, seamId, adapterId, resourceType] of [
      ['KERNEL-P0-01-BRANCH-PROTECTION',
        'kernel.workspace.protected_ref_guard',
        'kernel.drill.branch_protection.v1', 'ephemeral_branch'],
      ['KERNEL-P0-02-CREDENTIAL-GUARD',
        'kernel.credential.attempt_lease',
        'kernel.drill.credential_guard.v1',
        'ephemeral_credential_lease'],
      ['KERNEL-P0-03-BRANCH-PUSH-GUARD',
        'kernel.github.mutation_broker',
        'kernel.drill.branch_push_guard.v1', 'ephemeral_branch'],
      ['KERNEL-P0-04-CI-MERGE-AUTHORITY',
        'kernel.merge.effect_executor',
        'kernel.drill.ci_merge_authority.v1', 'ephemeral_branch'],
      ['KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE',
        'kernel.evaluation.independent_judge',
        'kernel.drill.independent_evaluator_judge.v1', 'ephemeral_run'],
      ['KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY',
        'kernel.merge.human_review_authority',
        'kernel.drill.human_review_authority.v1', 'ephemeral_run'],
      ['KERNEL-P0-07-RELEASE-PROMOTION',
        'kernel.release.staging_promotion',
        'kernel.drill.release_promotion.v1', 'ephemeral_staging'],
      ['KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
        'kernel.liveness.orphan_recovery',
        'kernel.drill.stop_orphan_liveness.v1', 'ephemeral_run'],
      ['KERNEL-P1-09-DEVGATE-TDD-DOD',
        'kernel.quality.devgate',
        'kernel.drill.devgate_tdd_dod.v1', 'ephemeral_workspace'],
      ['KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
        'kernel.controller.attempt_ownership',
        'kernel.drill.controller_session_isolation.v1', 'ephemeral_run'],
      ['KERNEL-P1-11-REPORT-LEARNING-CLOSURE',
        'kernel.closure.report_learning',
        'kernel.drill.report_learning_closure.v1',
        'ephemeral_database_record'],
    ]) {
      expect(sql).toContain(`('${behaviorId}'`);
      expect(sql).toContain(`'${seamId}'`);
      expect(sql).toContain(`'${adapterId}'`);
      expect(sql).toContain(`'${resourceType}'`);
    }
  });

  it('keeps identity and lifecycle evidence append-only', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_production_case_events/i,
    );
    expect(sql).toMatch(/event_id UUID PRIMARY KEY/i);
    expect(sql).toMatch(/case_id UUID NOT NULL REFERENCES kernel_equivalence_production_cases\(case_id\)/i);
    expect(sql).toMatch(/generation BIGINT NOT NULL/i);
    expect(sql).toMatch(/event_type TEXT NOT NULL CHECK/i);
    expect(sql).toMatch(/status TEXT NOT NULL CHECK/i);
    expect(sql).toMatch(/evidence_ref TEXT NOT NULL/i);
    expect(sql).toMatch(/before_hash TEXT/i);
    expect(sql).toMatch(/after_hash TEXT/i);
    expect(sql).toMatch(/late_effect_risk BOOLEAN NOT NULL/i);
    expect(sql).toMatch(
      /evidence_ref\s*=\s*'db:kernel-equivalence-production-cases\/'\s*\|\|\s*case_id::text/i,
    );
    expect(sql).toMatch(/kernel_equivalence_case_event_guard/i);
    expect(sql).toMatch(
      /BEFORE INSERT ON kernel_equivalence_production_case_events/i,
    );
    expect(sql).not.toMatch(/\bevidence\s+JSONB/i);
    for (const table of [
      'kernel_equivalence_production_cases',
      'kernel_equivalence_production_case_events',
    ]) {
      expect(sql).toMatch(new RegExp(
        `BEFORE UPDATE OR DELETE ON ${table}`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(`BEFORE TRUNCATE ON ${table}`, 'i'));
    }
  });

  it('uses a generation-fenced lease with a database absolute deadline', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_production_case_leases/i,
    );
    expect(sql).toMatch(/case_id UUID PRIMARY KEY/i);
    expect(sql).toMatch(/owner_id TEXT NOT NULL/i);
    expect(sql).toMatch(/generation BIGINT NOT NULL DEFAULT 1/i);
    expect(sql).toMatch(/state TEXT NOT NULL CHECK/i);
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/kernel_equivalence_case_lease_advance_guard/i);
    expect(sql).toMatch(/NEW\.generation\s*<>\s*OLD\.generation\s*\+\s*1/i);
    expect(sql).toMatch(/NEW\.owner_id\s*<>\s*OLD\.owner_id/i);
    expect(sql).toMatch(/NEW\.lease_expires_at\s*<=\s*clock_timestamp\(\)/i);
    expect(sql).toMatch(/BEFORE UPDATE ON kernel_equivalence_production_case_leases/i);
    expect(sql).toMatch(
      /BEFORE INSERT ON kernel_equivalence_production_case_leases/i,
    );
    expect(sql).toMatch(
      /owner_id\s*<>\s*'brain[.]kernel_equivalence[.]production_cases'/i,
    );
    expect(sql).toMatch(/NEW[.]generation\s*<>\s*1/i);
    expect(sql).toMatch(/NEW[.]state\s*<>\s*'prepared'/i);
    expect(sql).toMatch(/NEW[.]lease_expires_at\s*>\s*case_expires_at/i);
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER trg_kernel_equivalence_case_requires_lifecycle/i,
    );
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER trg_kernel_equivalence_lease_requires_event/i,
    );
    expect(sql).toMatch(/DEFERRABLE INITIALLY DEFERRED/gi);
    expect(sql).toMatch(/BEFORE DELETE ON kernel_equivalence_production_case_leases/i);
    expect(sql).toMatch(/BEFORE TRUNCATE ON kernel_equivalence_production_case_leases/i);
  });

  it('is rerunnable and registers schema version 377', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/g);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/g);
    expect(sql).toMatch(/VALUES \('377'/i);
    expect(sql).toMatch(/ON CONFLICT \(version\) DO NOTHING/i);
  });
});
