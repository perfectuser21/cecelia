import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const MERGED_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const PR_URL_4327 = 'https://github.com/perfectuser21/cecelia/pull/4327';
const PR_URL_4317 = 'https://github.com/perfectuser21/cecelia/pull/4317';

async function loadAuthority() {
  return import(pathToFileURL(join(process.cwd(), 'packages/brain/src/delivery-terminal-authority.js')).href);
}

function mergedPrInput(overrides = {}) {
  return {
    run_id: RUN_ID,
    task_id: TASK_ID,
    pr_url: PR_URL_4327,
    pr_branch: 'cp-kernel-delivery-terminal-authority',
    merged_sha: MERGED_SHA,
    head_sha: MERGED_SHA,
    contract_manifest_digest: 'sha256:contract-manifest-digest',
    target_environment: 'local_api',
    base_repo: 'perfectuser21/cecelia',
    ...overrides,
  };
}

describe('Delivery Terminal Authority [BEHAVIOR]', () => {
  it('Merge 后 parent 进入 delivery/staging_pending 且 staging child 绑定 merge manifest', async () => {
    const { createDeliveryFromMerge } = await loadAuthority();

    const result = await createDeliveryFromMerge(mergedPrInput());

    expect(result.delivery).toMatchObject({
      run_id: RUN_ID,
      task_id: TASK_ID,
      pr_url: PR_URL_4327,
      merged_sha: MERGED_SHA,
      head_sha: MERGED_SHA,
      contract_manifest_digest: 'sha256:contract-manifest-digest',
      target_environment: 'local_api',
      status: 'staging_pending',
    });
    expect(result.parent_run_patch).toMatchObject({
      phase: 'delivery/staging_pending',
      completed_at: null,
    });
    expect(result.parent_task_patch.status).not.toBe('completed');
    expect(result.staging_task_payload).toMatchObject({
      delivery_id: result.delivery.id,
      run_id: RUN_ID,
      task_id: TASK_ID,
      pr_url: PR_URL_4327,
      merged_sha: MERGED_SHA,
      head_sha: MERGED_SHA,
      contract_manifest_digest: 'sha256:contract-manifest-digest',
      target_environment: 'local_api',
    });
  });

  it('staging SKIP(no_contract) 不得 success 且 parent 保持 blocked', async () => {
    const { applyStagingResult } = await loadAuthority();

    const result = await applyStagingResult({
      delivery: {
        id: DELIVERY_ID,
        run_id: RUN_ID,
        task_id: TASK_ID,
        merged_sha: MERGED_SHA,
        status: 'staging_pending',
      },
      staging_result: {
        verdict: 'SKIP',
        reason: 'no_contract',
        tested_sha: MERGED_SHA,
        executor_success: true,
      },
    });

    expect(result.may_promote).toBe(false);
    expect(result.delivery.status).toMatch(/staging_(blocked|failed)|failed/);
    expect(result.parent_task_patch.status).not.toBe('completed');
    expect(result.failure_reason).toMatch(/no_contract|skip/i);
  });

  it('tested_sha 缺失或不等于 merged_sha 必须 fail-closed', async () => {
    const { applyStagingResult } = await loadAuthority();

    for (const testedSha of [null, OTHER_SHA]) {
      const result = await applyStagingResult({
        delivery: {
          id: DELIVERY_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          merged_sha: MERGED_SHA,
          status: 'staging_pending',
        },
        staging_result: {
          verdict: 'PASS',
          reason: null,
          tested_sha: testedSha,
          executor_success: true,
        },
      });

      expect(result.may_promote).toBe(false);
      expect(result.delivery.status).toMatch(/staging_failed|failed/);
      expect(result.promote_status ?? '').not.toMatch(/promoted/);
      expect(result.failure_reason).toMatch(/tested_sha|sha/i);
    }
  });

  it('Internal production health/fingerprint/E2E 失败进入 rollback_required 且带 rollback anchor', async () => {
    const { applyProductionResult } = await loadAuthority();

    const result = await applyProductionResult({
      delivery: {
        id: DELIVERY_ID,
        run_id: RUN_ID,
        task_id: TASK_ID,
        line: 'internal',
        merged_sha: MERGED_SHA,
        tested_sha: MERGED_SHA,
        status: 'promote_pending',
      },
      production: {
        tested_sha: MERGED_SHA,
        health_ok: false,
        fingerprint_sha: MERGED_SHA,
        e2e_ok: true,
        rollback_anchor: 'prod-before-4327',
      },
    });

    expect(result.promoted).toBe(false);
    expect(result.delivery.status).toMatch(/rollback_required|failed/);
    expect(result.rollback_anchor).toBe('prod-before-4327');
    expect(result.events).toContainEqual(expect.objectContaining({
      event_type: 'production_verify_failed',
      detail: expect.objectContaining({ rollback_anchor: 'prod-before-4327' }),
    }));
  });

  it('customer confirm 无签名 attestation 不得 promoted', async () => {
    const { applyCustomerConfirmation, applyCustomerAttestation } = await loadAuthority();

    const confirmed = await applyCustomerConfirmation({
      delivery: {
        id: DELIVERY_ID,
        line: 'customer',
        merged_sha: MERGED_SHA,
        tested_sha: MERGED_SHA,
        status: 'promote_pending',
      },
      confirmed_by: 'owner-body-only',
    });

    expect(confirmed.delivery.status).toBe('external_ack_pending');
    expect(confirmed.promote_status).not.toBe('promoted');

    const rejected = await applyCustomerAttestation({
      delivery: confirmed.delivery,
      attestation: {
        repo: 'perfectuser21/zenithjoy-workspace',
        deployment_id: 'deploy-4327',
        deployed_sha: OTHER_SHA,
        verified_sha: OTHER_SHA,
        verification_url: 'https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/1',
        attestation_signature: 'invalid-signature',
      },
    });

    expect(rejected.promote_status).not.toBe('promoted');
    expect(rejected.attestation_status).toBe('rejected');
  });

  it('final report persisted 前 parent 不得 completed; persisted 后 atomically complete', async () => {
    const { completeAfterFinalReport } = await loadAuthority();

    const beforeReport = await completeAfterFinalReport({
      delivery: {
        id: DELIVERY_ID,
        run_id: RUN_ID,
        task_id: TASK_ID,
        status: 'report_pending',
        promote_status: 'promoted',
      },
      report: { persisted: false },
    });

    expect(beforeReport.parent_run_patch?.phase).not.toBe('done');
    expect(beforeReport.parent_task_patch?.status).not.toBe('completed');

    const afterReport = await completeAfterFinalReport({
      delivery: {
        id: DELIVERY_ID,
        run_id: RUN_ID,
        task_id: TASK_ID,
        status: 'report_pending',
        promote_status: 'promoted',
      },
      report: {
        persisted: true,
        report_id: 'report-4327',
        handoff_id: 'handoff-4327',
        learning_id: 'learning-4327',
        okr_commitment_map_id: 'okr-4327',
      },
    });

    expect(afterReport.delivery.status).toBe('completed');
    expect(afterReport.parent_run_patch).toMatchObject({ phase: 'done' });
    expect(afterReport.parent_task_patch).toMatchObject({ status: 'completed' });
    expect(afterReport.transactional_updates).toEqual([
      'harness_deliveries',
      'initiative_runs',
      'tasks',
    ]);
  });

  it('重放同一 staging/promote/report 事件不重复', async () => {
    const { replayDeliveryEvents } = await loadAuthority();

    const result = await replayDeliveryEvents({
      delivery_id: DELIVERY_ID,
      events: [
        { event_type: 'staging_pass', idempotency_key: 'staging-pass' },
        { event_type: 'staging_pass', idempotency_key: 'staging-pass' },
        { event_type: 'promote_pass', idempotency_key: 'promote-pass' },
        { event_type: 'promote_pass', idempotency_key: 'promote-pass' },
        { event_type: 'report_persisted', idempotency_key: 'report-pass' },
        { event_type: 'report_persisted', idempotency_key: 'report-pass' },
      ],
    });

    expect(result.events_inserted).toBe(3);
    expect(result.duplicates_suppressed).toBe(3);
    expect(result.event_counts_by_key).toEqual({
      'staging-pass': 1,
      'promote-pass': 1,
      'report-pass': 1,
    });
  });

  it('PR4327 PR4317 parent completed + staging queued fixture 在审计中 FAIL', async () => {
    const { auditLegacyCompletionFixture } = await loadAuthority();

    for (const fixture of [
      {
        label: 'PR4327',
        pr_url: PR_URL_4327,
        parent_task_status: 'completed',
        run_phase: 'done',
        staging_task_status: 'queued',
        staging_result: null,
      },
      {
        label: 'PR4317',
        pr_url: PR_URL_4317,
        parent_task_status: 'completed',
        run_phase: 'done',
        staging_task_status: 'queued',
        staging_result: null,
      },
    ]) {
      const result = await auditLegacyCompletionFixture(fixture);
      expect(result.verdict).toBe('FAIL');
      expect(result.reason).toMatch(/parent_completed_before_staging|staging queued/i);
      expect(result.may_rewrite_history).toBe(false);
    }
  });
});
