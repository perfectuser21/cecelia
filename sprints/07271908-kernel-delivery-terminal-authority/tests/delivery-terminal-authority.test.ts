import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

const DB_URL = process.env.DB_URL || process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia';
const MERGED_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const PR_URL_4327 = 'https://github.com/perfectuser21/cecelia/pull/4327';
const PR_URL_4317 = 'https://github.com/perfectuser21/cecelia/pull/4317';

async function loadAuthority() {
  return import(pathToFileURL(join(process.cwd(), 'packages/brain/src/delivery-terminal-authority.js')).href);
}

async function makeHarnessApp() {
  const { default: harnessRouter } = await import(pathToFileURL(join(process.cwd(), 'packages/brain/src/routes/harness.js')).href);
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', harnessRouter);
  return app;
}

function sql(value: unknown) {
  return String(value).replace(/'/g, "''");
}

function psql(command: string) {
  return execFileSync('psql', [DB_URL, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function psqlJson<T = Record<string, unknown>>(query: string): T {
  const out = psql(`SELECT row_to_json(q)::text FROM (${query}) q`);
  expect(out).not.toBe('');
  return JSON.parse(out) as T;
}

function makeCtx(label: string) {
  return {
    label,
    initiativeId: randomUUID(),
    runId: randomUUID(),
    taskId: randomUUID(),
    prUrl: label === 'PR4317' ? PR_URL_4317 : PR_URL_4327,
    prBranch: `cp-delivery-authority-${label.toLowerCase()}`,
    digest: `sha256:${label}-contract-manifest-digest`,
  };
}

function seedParent(ctx: ReturnType<typeof makeCtx>) {
  psql(`
    INSERT INTO tasks (id, title, description, task_type, status, payload)
    VALUES ('${ctx.taskId}', '${ctx.label} parent', 'delivery authority test fixture', 'harness_initiative', 'in_progress', '{}'::jsonb);
    INSERT INTO initiative_runs (id, initiative_id, phase, current_task_id)
    VALUES ('${ctx.runId}', '${ctx.initiativeId}', 'B_task_loop', '${ctx.taskId}');
  `);
}

function cleanup(ctxs: Array<ReturnType<typeof makeCtx> | { initiativeId?: string; runId?: string; taskId?: string; deliveryId?: string }>) {
  const initiativeIds = ctxs.map((x) => x.initiativeId).filter(Boolean);
  const runIds = ctxs.map((x) => x.runId).filter(Boolean);
  const taskIds = ctxs.map((x) => x.taskId).filter(Boolean);
  const deliveryIds = ctxs.map((x) => x.deliveryId).filter(Boolean);
  const quotedInitiatives = initiativeIds.map((x) => `'${sql(x)}'`).join(',');
  const quotedRuns = runIds.map((x) => `'${sql(x)}'`).join(',');
  const quotedTasks = taskIds.map((x) => `'${sql(x)}'`).join(',');
  try {
    if (quotedRuns || quotedTasks) {
      const found = psql(`
        SELECT id::text
          FROM harness_deliveries
         WHERE ${quotedRuns ? `run_id IN (${quotedRuns})` : 'FALSE'}
            OR ${quotedTasks ? `task_id IN (${quotedTasks})` : 'FALSE'}
      `).split('\n').filter(Boolean);
      deliveryIds.push(...found);
    }
  } catch { /* ignore */ }
  const quotedDeliveries = [...new Set(deliveryIds)].map((x) => `'${sql(x)}'`).join(',');
  try { if (quotedDeliveries) psql(`DELETE FROM harness_delivery_events WHERE delivery_id IN (${quotedDeliveries});`); } catch { /* ignore */ }
  try { if (quotedDeliveries) psql(`DELETE FROM harness_deliveries WHERE id IN (${quotedDeliveries});`); } catch { /* ignore */ }
  try {
    if (quotedTasks || quotedInitiatives) {
      psql(`DELETE FROM staging_e2e_results WHERE ${quotedTasks ? `task_id IN (${quotedTasks})` : 'FALSE'} OR ${quotedInitiatives ? `initiative_id IN (${quotedInitiatives})` : 'FALSE'};`);
    }
  } catch { /* ignore */ }
  try { if (quotedRuns) psql(`DELETE FROM initiative_runs WHERE id IN (${quotedRuns});`); } catch { /* ignore */ }
  try { if (quotedTasks) psql(`DELETE FROM tasks WHERE id IN (${quotedTasks});`); } catch { /* ignore */ }
}

function mergeInput(ctx: ReturnType<typeof makeCtx>) {
  return {
    dbUrl: DB_URL,
    run_id: ctx.runId,
    task_id: ctx.taskId,
    pr_url: ctx.prUrl,
    pr_branch: ctx.prBranch,
    merged_sha: MERGED_SHA,
    head_sha: MERGED_SHA,
    contract_manifest_digest: ctx.digest,
    target_environment: 'local_api',
    base_repo: 'perfectuser21/cecelia',
  };
}

function deliveryIdFrom(result: any) {
  const id = result?.delivery_id || result?.delivery?.id || result?.id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  return id;
}

describe('Delivery Terminal Authority [BEHAVIOR]', () => {
  it('Merge 后 parent 进入 delivery/staging_pending 且 staging child 绑定 merge manifest', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('PR4327');
    seedParent(ctx);
    let deliveryId: string | undefined;
    try {
      const created = await authority.createDeliveryFromMerge(mergeInput(ctx));
      deliveryId = deliveryIdFrom(created);
      const row = psqlJson<{
        run_phase: string;
        task_status: string;
        delivery_status: string;
        merged_sha: string;
        target_environment: string;
        contract_manifest_digest: string;
        staging_payload: Record<string, string> | null;
      }>(`
        SELECT r.phase AS run_phase,
               t.status AS task_status,
               d.status AS delivery_status,
               d.merged_sha,
               d.target_environment,
               d.contract_manifest_digest,
               child.payload AS staging_payload
          FROM harness_deliveries d
          JOIN initiative_runs r ON r.id = d.run_id
          JOIN tasks t ON t.id = d.task_id
          LEFT JOIN LATERAL (
            SELECT payload
              FROM tasks
             WHERE task_type = 'staging_e2e'
               AND payload->>'delivery_id' = d.id::text
             ORDER BY created_at DESC
             LIMIT 1
          ) child ON TRUE
         WHERE d.id = '${deliveryId}'
      `);

      expect(row.run_phase).toBe('delivery/staging_pending');
      expect(row.task_status).not.toBe('completed');
      expect(row.delivery_status).toBe('staging_pending');
      expect(row.merged_sha).toBe(MERGED_SHA);
      expect(row.target_environment).toBe('local_api');
      expect(row.contract_manifest_digest).toBe(ctx.digest);
      expect(row.staging_payload).toMatchObject({
        delivery_id: deliveryId,
        run_id: ctx.runId,
        task_id: ctx.taskId,
        pr_url: ctx.prUrl,
        merged_sha: MERGED_SHA,
        head_sha: MERGED_SHA,
        contract_manifest_digest: ctx.digest,
        target_environment: 'local_api',
      });
    } finally {
      cleanup([{ ...ctx, deliveryId }]);
    }
  });

  it('delivery status endpoint schema keys 完整且禁用字段不存在', async () => {
    const authority = await loadAuthority();
    const app = await makeHarnessApp();
    const ctx = makeCtx('status-schema');
    seedParent(ctx);
    let deliveryId: string | undefined;
    try {
      deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      const res = await request(app).get(`/api/brain/harness/delivery/${deliveryId}/status`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'contract_manifest_digest',
        'delivery_id',
        'external_attestation',
        'head_sha',
        'merged_sha',
        'parent',
        'pr_url',
        'promote_status',
        'report',
        'run_id',
        'staging_child_payload',
        'status',
        'target_environment',
        'task_id',
        'tested_sha',
      ].sort());
      for (const forbidden of ['ok_only', 'promoted_by_only', 'executor_success', 'child_completed_success']) {
        expect(Object.prototype.hasOwnProperty.call(res.body, forbidden)).toBe(false);
      }
      expect(res.body).toMatchObject({
        delivery_id: deliveryId,
        run_id: ctx.runId,
        task_id: ctx.taskId,
        pr_url: ctx.prUrl,
        merged_sha: MERGED_SHA,
        target_environment: 'local_api',
      });
    } finally {
      cleanup([{ ...ctx, deliveryId }]);
    }
  });

  it('delivery status invalid id error path 返回 400 + error 字段', async () => {
    const app = await makeHarnessApp();
    const res = await request(app).get('/api/brain/harness/delivery/not-a-uuid/status');

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('staging PASS 且 tested_sha 等于 merged_sha 后才可 promote', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('staging-pass');
    seedParent(ctx);
    let deliveryId: string | undefined;
    try {
      deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'PASS',
        reason: null,
        tested_sha: MERGED_SHA,
        executor_success: true,
        idempotency_key: 'staging-pass',
      });
      const row = psqlJson<{ status: string; verdict: string; tested_sha: string; merged_sha: string }>(`
        SELECT d.status, s.verdict, s.tested_sha, d.merged_sha
          FROM harness_deliveries d
          JOIN staging_e2e_results s ON s.id = d.staging_result_id
         WHERE d.id = '${deliveryId}'
      `);
      expect(row).toMatchObject({
        status: 'promote_pending',
        verdict: 'PASS',
        tested_sha: MERGED_SHA,
        merged_sha: MERGED_SHA,
      });
    } finally {
      cleanup([{ ...ctx, deliveryId }]);
    }
  });

  it('staging SKIP(no_contract) 不得 success 且 parent 保持 blocked', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('skip');
    seedParent(ctx);
    try {
      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'SKIP',
        reason: 'no_contract',
        tested_sha: MERGED_SHA,
        executor_success: true,
        idempotency_key: 'staging-skip-no-contract',
      });
      const row = psqlJson<{ delivery_status: string; task_status: string; failure_reason: string }>(`
        SELECT d.status AS delivery_status, t.status AS task_status, COALESCE(d.failure_reason, '') AS failure_reason
          FROM harness_deliveries d
          JOIN tasks t ON t.id = d.task_id
         WHERE d.id = '${deliveryId}'
      `);
      expect(row.delivery_status).toMatch(/staging_(blocked|failed)|failed/);
      expect(row.task_status).not.toBe('completed');
      expect(row.failure_reason).toMatch(/no_contract|skip/i);
    } finally {
      cleanup([ctx]);
    }
  });

  it('tested_sha 缺失或不等于 merged_sha 必须 fail-closed', async () => {
    const authority = await loadAuthority();
    const ctxs = [makeCtx('missing-sha'), makeCtx('mismatch-sha')];
    try {
      for (const [idx, ctx] of ctxs.entries()) {
        seedParent(ctx);
        const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
        await authority.applyStagingResult({
          dbUrl: DB_URL,
          delivery_id: deliveryId,
          verdict: 'PASS',
          reason: null,
          tested_sha: idx === 0 ? null : OTHER_SHA,
          executor_success: true,
          idempotency_key: `staging-sha-${idx}`,
        });
        const row = psqlJson<{ status: string; promote_status: string; failure_reason: string }>(`
          SELECT d.status, COALESCE(d.promote_status, '') AS promote_status, COALESCE(d.failure_reason, '') AS failure_reason
            FROM harness_deliveries d
           WHERE d.id = '${deliveryId}'
        `);
        expect(row.status).toMatch(/staging_failed|failed/);
        expect(row.promote_status).not.toMatch(/promoted|auto_promoted/);
        expect(row.failure_reason).toMatch(/tested_sha|sha/i);
        ctxs[idx] = { ...ctx, deliveryId };
      }
    } finally {
      cleanup(ctxs);
    }
  });

  it('staging child completed+executor success 不得替代 PASS', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('executor-success-not-pass');
    seedParent(ctx);
    try {
      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'FAIL',
        reason: 'scenario_failed',
        tested_sha: MERGED_SHA,
        executor_success: true,
        child_task_status: 'completed',
        idempotency_key: 'staging-fail-executor-success',
      });
      const row = psqlJson<{ status: string; task_status: string; promote_status: string }>(`
        SELECT d.status, t.status AS task_status, COALESCE(d.promote_status, '') AS promote_status
          FROM harness_deliveries d
          JOIN tasks t ON t.id = d.task_id
         WHERE d.id = '${deliveryId}'
      `);
      expect(row.status).toMatch(/staging_failed|failed/);
      expect(row.task_status).not.toBe('completed');
      expect(row.promote_status).not.toMatch(/promoted|auto_promoted/);
    } finally {
      cleanup([ctx]);
    }
  });

  it('Internal production health/fingerprint/E2E 失败进入 rollback_required 且带 rollback anchor', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('rollback');
    seedParent(ctx);
    try {
      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'PASS',
        tested_sha: MERGED_SHA,
        idempotency_key: 'staging-pass',
      });
      await authority.applyProductionResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        line: 'internal',
        tested_sha: MERGED_SHA,
        health_ok: false,
        fingerprint_sha: MERGED_SHA,
        e2e_ok: true,
        rollback_anchor: 'prod-before-4327',
        idempotency_key: 'promote-fail-health',
      });
      const row = psqlJson<{ status: string; promote_status: string; rollback_events: number }>(`
        SELECT d.status,
               COALESCE(d.promote_status, '') AS promote_status,
               (SELECT count(*)::int
                  FROM harness_delivery_events e
                 WHERE e.delivery_id = d.id
                   AND e.event_type = 'production_verify_failed'
                   AND e.detail ? 'rollback_anchor') AS rollback_events
          FROM harness_deliveries d
         WHERE d.id = '${deliveryId}'
      `);
      expect(row.status).toMatch(/rollback_required|failed/);
      expect(row.promote_status).not.toMatch(/promoted|auto_promoted/);
      expect(row.rollback_events).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup([ctx]);
    }
  });

  it('Promote API 必须认证 approver，body.promoted_by 不可冒充', async () => {
    const app = await makeHarnessApp();
    const resultId = randomUUID();
    const initiativeId = randomUUID();
    const prUrl = `https://github.com/perfectuser21/cecelia/pull/promote-auth-${resultId}`;
    try {
      psql(`
        INSERT INTO staging_e2e_results
          (id, initiative_id, pr_url, verdict, promote_status, scenarios_total, scenarios_passed, failed_scenarios)
        VALUES
          ('${resultId}', '${initiativeId}', '${prUrl}', 'PASS', 'pending_promote', 1, 1, '[]'::jsonb);
      `);
      const before = psql(`
        SELECT count(*)
          FROM staging_e2e_results
         WHERE id='${resultId}' AND promoted_at IS NOT NULL
      `);
      const res = await request(app)
        .post(`/api/brain/harness/promote/${resultId}`)
        .send({ base_repo: 'perfectuser21/cecelia', promoted_by: 'body-only' });
      const after = psql(`
        SELECT count(*)
          FROM staging_e2e_results
         WHERE id='${resultId}' AND promoted_at IS NOT NULL
      `);

      expect([401, 503]).toContain(res.status);
      expect(after).toBe(before);
    } finally {
      try { psql(`DELETE FROM staging_e2e_results WHERE id='${resultId}' OR initiative_id='${initiativeId}';`); } catch { /* ignore */ }
    }
  });

  it('customer confirm 无签名 attestation 不得 promoted', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('customer');
    seedParent(ctx);
    try {
      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge({ ...mergeInput(ctx), base_repo: 'perfectuser21/zenithjoy-workspace' }));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'PASS',
        tested_sha: MERGED_SHA,
        idempotency_key: 'staging-pass',
      });
      await authority.applyCustomerConfirmation({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        confirmed_by: 'body-only-owner',
        idempotency_key: 'customer-confirm',
      });
      let row = psqlJson<{ status: string; promote_status: string }>(`
        SELECT status, COALESCE(promote_status, '') AS promote_status
          FROM harness_deliveries
         WHERE id = '${deliveryId}'
      `);
      expect(row.status).toBe('external_ack_pending');
      expect(row.promote_status).not.toBe('promoted');

      await authority.applyCustomerAttestation({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        repo: 'perfectuser21/zenithjoy-workspace',
        deployment_id: 'deploy-4327',
        deployed_sha: OTHER_SHA,
        verified_sha: OTHER_SHA,
        verification_url: 'https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/1',
        attestation_signature: 'invalid-signature',
        idempotency_key: 'customer-attestation-rejected',
      });
      row = psqlJson<{ status: string; promote_status: string }>(`
        SELECT status, COALESCE(promote_status, '') AS promote_status
          FROM harness_deliveries
         WHERE id = '${deliveryId}'
      `);
      expect(row.promote_status).not.toBe('promoted');
    } finally {
      cleanup([ctx]);
    }
  });

  it('customer repo 签名 deployment attestation verified 后才 promoted', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('customer-signed');
    const previousPublicKey = process.env.HARNESS_CUSTOMER_ATTESTATION_PUBLIC_KEY;
    seedParent(ctx);
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      process.env.HARNESS_CUSTOMER_ATTESTATION_PUBLIC_KEY = publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString();

      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge({ ...mergeInput(ctx), base_repo: 'perfectuser21/zenithjoy-workspace' }));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'PASS',
        tested_sha: MERGED_SHA,
        idempotency_key: 'staging-pass',
      });
      await authority.applyCustomerConfirmation({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        confirmed_by: 'cecelia-operator',
        idempotency_key: 'customer-confirm',
      });

      const attestation = {
        repo: 'perfectuser21/zenithjoy-workspace',
        deployment_id: 'deploy-verified-4327',
        deployed_sha: MERGED_SHA,
        verified_sha: MERGED_SHA,
        verification_url: 'https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/verified',
      };
      const signedPayload = JSON.stringify(attestation);
      const attestationSignature = sign(null, Buffer.from(signedPayload, 'utf8'), privateKey).toString('base64');
      await authority.applyCustomerAttestation({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        ...attestation,
        attestation_signature: attestationSignature,
        idempotency_key: 'customer-attestation-verified',
      });

      const row = psqlJson<{ status: string; promote_status: string; verified_sha: string; event_count: number }>(`
        SELECT d.status,
               COALESCE(d.promote_status, '') AS promote_status,
               (
                 SELECT e.detail->>'verified_sha'
                   FROM harness_delivery_events e
                  WHERE e.delivery_id = d.id
                    AND e.event_type = 'external_attestation_verified'
                  ORDER BY e.created_at DESC
                  LIMIT 1
               ) AS verified_sha,
               (
                 SELECT count(*)::int
                   FROM harness_delivery_events e
                  WHERE e.delivery_id = d.id
                    AND e.event_type = 'external_attestation_verified'
               ) AS event_count
          FROM harness_deliveries d
         WHERE d.id = '${deliveryId}'
      `);
      expect(row.status).toBe('promoted');
      expect(row.promote_status).toBe('promoted');
      expect(row.verified_sha).toBe(MERGED_SHA);
      expect(row.event_count).toBe(1);
    } finally {
      if (previousPublicKey === undefined) delete process.env.HARNESS_CUSTOMER_ATTESTATION_PUBLIC_KEY;
      else process.env.HARNESS_CUSTOMER_ATTESTATION_PUBLIC_KEY = previousPublicKey;
      cleanup([ctx]);
    }
  });

  it('report dispatch失败不得 parent complete; persisted 后 atomically complete', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('report-gate');
    seedParent(ctx);
    try {
      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      await authority.applyStagingResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        verdict: 'PASS',
        tested_sha: MERGED_SHA,
        idempotency_key: 'staging-pass',
      });
      await authority.applyProductionResult({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        line: 'internal',
        tested_sha: MERGED_SHA,
        health_ok: true,
        fingerprint_sha: MERGED_SHA,
        e2e_ok: true,
        rollback_anchor: 'prod-before-report-gate',
        idempotency_key: 'promote-pass',
      });
      await authority.persistFinalReportAndComplete({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        dispatch_error: 'report dispatch failed',
        idempotency_key: 'report-fail',
      });
      let row = psqlJson<{ status: string; run_phase: string; task_status: string }>(`
        SELECT d.status, r.phase AS run_phase, t.status AS task_status
          FROM harness_deliveries d
          JOIN initiative_runs r ON r.id = d.run_id
          JOIN tasks t ON t.id = d.task_id
         WHERE d.id = '${deliveryId}'
      `);
      expect(row.status).toMatch(/report_pending|report_failed/);
      expect(row.run_phase).not.toBe('done');
      expect(row.task_status).not.toBe('completed');

      await authority.persistFinalReportAndComplete({
        dbUrl: DB_URL,
        delivery_id: deliveryId,
        report_id: 'report-4327',
        handoff_id: 'handoff-4327',
        learning_id: 'learning-4327',
        okr_commitment_map_id: 'okr-4327',
        idempotency_key: 'report-pass',
      });
      row = psqlJson<{ status: string; run_phase: string; task_status: string }>(`
        SELECT d.status, r.phase AS run_phase, t.status AS task_status
          FROM harness_deliveries d
          JOIN initiative_runs r ON r.id = d.run_id
          JOIN tasks t ON t.id = d.task_id
         WHERE d.id = '${deliveryId}'
      `);
      expect(row).toMatchObject({ status: 'completed', run_phase: 'done', task_status: 'completed' });
    } finally {
      cleanup([ctx]);
    }
  });

  it('重放同一 staging/promote/report 事件不重复', async () => {
    const authority = await loadAuthority();
    const ctx = makeCtx('replay');
    seedParent(ctx);
    try {
      const deliveryId = deliveryIdFrom(await authority.createDeliveryFromMerge(mergeInput(ctx)));
      for (const event of [
        ['staging_pass', 'staging-pass'],
        ['staging_pass', 'staging-pass'],
        ['promote_pass', 'promote-pass'],
        ['promote_pass', 'promote-pass'],
        ['report_persisted', 'report-pass'],
        ['report_persisted', 'report-pass'],
      ] as const) {
        await authority.replayDeliveryEvent({
          dbUrl: DB_URL,
          delivery_id: deliveryId,
          event_type: event[0],
          idempotency_key: event[1],
          detail: { source: 'replay-test' },
        });
      }
      const dupCount = Number(psql(`
        SELECT count(*)
          FROM (
            SELECT idempotency_key
              FROM harness_delivery_events
             WHERE delivery_id = '${deliveryId}'
               AND idempotency_key IN ('staging-pass','promote-pass','report-pass')
             GROUP BY idempotency_key
            HAVING count(*) > 1
          ) dup
      `));
      expect(dupCount).toBe(0);
    } finally {
      cleanup([ctx]);
    }
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
