import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  RESULT_CHANNEL_CONTAINER_FILE,
  RESULT_CHANNEL_MAX_BYTES,
  cleanupAttemptResultChannel,
  consumeAttemptResultChannel,
  createAttemptResultChannel,
} from '../../../packages/brain/src/orchestrator/result-channel.js';
import {
  buildFeedbackLineage,
  validateReviewerResultBinding,
} from '../../../packages/brain/src/orchestrator/feedback-lineage.js';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { parseHarnessResult } from '../../../packages/brain/src/orchestrator/execution-contract.js';
import callbackRouter from '../../../packages/brain/src/routes/harness-callback.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const CONTRACT_SHA = 'a'.repeat(40);
const CALLBACK_TOKEN = 'result-feedback-lineage-callback-token';
const LEASE_OWNER = 'result-feedback-lineage-test:1';
const BRAIN_ROOT = fileURLToPath(
  new URL('../../../packages/brain/', import.meta.url),
);
const { Pool } = pg;
const scratch: string[] = [];
let adminPool: pg.Pool;
let testPool: pg.Pool;
let databaseName: string;

function reviewerResult(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: '审查完成',
    artifacts: [],
    checks: [],
    decision: {
      outcome: 'NEEDS_REVISION',
      reason: '缺少跨 run 隔离证明',
      binding: {
        run_id: RUN_ID,
        round: 1,
        contract_sha: CONTRACT_SHA,
      },
      feedback: [{
        id: 'FB-001',
        severity: 'blocker',
        requirement: '补充跨 run 隔离',
        evidence: '当前合同没有并发 run 证明',
        resolution_criteria: '两个 run 的反馈不能互读',
      }],
      rubric: [{
        dimension: 'feedback_lineage',
        score: 3,
        max_score: 10,
        reason: '血缘未接线',
      }],
    },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'fresh-reviewer-r1' },
    ...overrides,
  };
}

function newRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'kernel-result-lineage-'));
  scratch.push(root);
  return root;
}

function quotedDatabase(value: string) {
  if (!/^kernel_feedback_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe database name: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `kernel_feedback_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedDatabase(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quotedDatabase(databaseName)} WITH (FORCE)`,
    );
  }
  if (adminPool) await adminPool.end();
}, 30_000);

afterEach(() => {
  for (const root of scratch.splice(0)) {
    cleanupAttemptResultChannel({ rootDir: root, ignoreMissing: true });
  }
});

describe('Kernel reviewer result channel 与 feedback lineage [BEHAVIOR]', () => {
  it('read-only callback 持久化完整 reviewer 结果', async () => {
    const rootDir = newRoot();
    const channel = createAttemptResultChannel({
      rootDir,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
    });
    expect(channel.containerFile).toBe(RESULT_CHANNEL_CONTAINER_FILE);
    writeFileSync(channel.hostFile, JSON.stringify(reviewerResult()), { mode: 0o600 });

    const consumed = await consumeAttemptResultChannel({
      channel,
      expected: {
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        role: 'reviewer',
        round: 1,
        contractSha: CONTRACT_SHA,
      },
    });

    expect(consumed.result.decision.feedback[0].id).toBe('FB-001');
    expect(consumed.result.decision.rubric[0].dimension).toBe('feedback_lineage');
    expect(consumed.byteLength).toBeLessThanOrEqual(RESULT_CHANNEL_MAX_BYTES);
    expect(consumed.sha256).toBe(
      createHash('sha256').update(consumed.canonicalJson).digest('hex'),
    );

    const taskId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks
         (id, title, status, priority, task_type, trigger_source, payload)
       VALUES ($1, 'feedback-lineage-test', 'in_progress', 'P0',
               'harness_initiative', 'test', $2::jsonb)`,
      [taskId, JSON.stringify({
        harness_runtime: 'kernel-v1',
        review_required: true,
        target_environment: 'local_api',
      })],
    );
    await testPool.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, phase, current_task_id, orchestrator_version, deadline_at)
       VALUES ($1, $2, 'gan', $2, 'v2', NOW() + INTERVAL '10 minutes')`,
      [RUN_ID, taskId],
    );
    await testPool.query(
      `INSERT INTO harness_attempts
         (id, run_id, hop, phase, role, provider, task_bundle,
          callback_secret_hash, status, lease_owner, execution_transport,
          requested_machine_id, actual_machine_id, machine_attestation_status)
       VALUES ($1, $2, 1, 'gan', 'reviewer', 'codex', $3::jsonb,
               $4, 'running', $5, 'local-docker', 'test-host', 'test-host', 'local')`,
      [
        ATTEMPT_ID,
        RUN_ID,
        JSON.stringify({
          expected_output: 'harness-result/reviewer-v1',
          inputs: { contract_round: 1, contract_sha: CONTRACT_SHA },
          constraints: { result_channel: { version: 'attempt-result/v1' } },
        }),
        createHash('sha256').update(CALLBACK_TOKEN).digest('hex'),
        LEASE_OWNER,
      ],
    );

    const app = express();
    app.set('pool', testPool);
    app.use(express.json({ limit: '300kb' }));
    app.use('/api/brain', callbackRouter);
    const callback = await request(app)
      .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
      .set('Authorization', `Bearer ${CALLBACK_TOKEN}`)
      .set('X-Harness-Lease-Owner', LEASE_OWNER)
      .send(consumed.result);

    expect(callback.status).toBe(200);
    expect(Object.keys(callback.body).sort()).toEqual(['attemptId', 'deduped', 'ok']);
    const persisted = await testPool.query(
      `SELECT result
         FROM harness_attempts
        WHERE id=$1
          AND completed_at > NOW() - INTERVAL '5 minutes'`,
      [ATTEMPT_ID],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].result.decision.feedback[0].id).toBe('FB-001');
    expect(persisted.rows[0].result._authority).toMatchObject({
      source: 'attempt-result-channel',
      channel_version: 'attempt-result/v1',
      sha256: consumed.sha256,
      byte_length: consumed.byteLength,
    });
    const verdict = await testPool.query(
      `SELECT detail
         FROM orchestrator_decision_log
        WHERE run_id=$1
          AND action='verdict:reviewer'
          AND created_at > NOW() - INTERVAL '5 minutes'`,
      [RUN_ID],
    );
    expect(verdict.rows).toHaveLength(1);
    expect(verdict.rows[0].detail).toMatchObject({
      attempt_id: ATTEMPT_ID,
      rn: 1,
      contract_sha: CONTRACT_SHA,
    });
  });

  it('路径逃逸、软链接、跨 attempt 与 secret fail-closed', async () => {
    const rootDir = newRoot();
    const first = createAttemptResultChannel({
      rootDir,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
    });
    const second = createAttemptResultChannel({
      rootDir,
      runId: RUN_ID,
      attemptId: OTHER_ATTEMPT_ID,
    });
    writeFileSync(first.hostFile, JSON.stringify(reviewerResult()), { mode: 0o600 });
    symlinkSync(first.hostFile, second.hostFile);

    await expect(consumeAttemptResultChannel({
      channel: second,
      expected: {
        runId: RUN_ID,
        attemptId: OTHER_ATTEMPT_ID,
        role: 'reviewer',
        round: 1,
        contractSha: CONTRACT_SHA,
      },
    })).rejects.toThrow(/symlink|channel|attempt/i);

    writeFileSync(first.hostFile, JSON.stringify({
      ...reviewerResult(),
      transcript: '禁止入账',
      token: 'sk-secret-must-not-persist',
    }), { mode: 0o600 });
    await expect(consumeAttemptResultChannel({
      channel: first,
      expected: {
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        role: 'reviewer',
        round: 1,
        contractSha: CONTRACT_SHA,
      },
    })).rejects.toThrow(/secret|transcript|forbidden/i);
  });

  it('fresh-session round 2 精确收到绑定反馈与 resolution map', () => {
    const review = validateReviewerResultBinding(reviewerResult(), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    const lineage = buildFeedbackLineage({
      runId: RUN_ID,
      nextRound: 2,
      priorReview: review,
      proposerResolution: {
        source_review_attempt_id: ATTEMPT_ID,
        source_contract_sha: CONTRACT_SHA,
        items: [{
          feedback_id: 'FB-001',
          status: 'resolved',
          evidence: 'integration test: concurrent run isolation',
        }],
      },
    });

    expect(lineage.proposerInputs.prior_review.feedback[0].id).toBe('FB-001');
    expect(lineage.reviewerInputs.prior_review.binding.contract_sha).toBe(CONTRACT_SHA);
    expect(lineage.reviewerInputs.resolution_map.items[0]).toMatchObject({
      feedback_id: 'FB-001',
      status: 'resolved',
    });
  });

  it('并发 run、recovery、resume 与 callback 重放隔离幂等', () => {
    const first = validateReviewerResultBinding(reviewerResult(), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    const replay = validateReviewerResultBinding(reviewerResult(), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    expect(replay.result_sha256).toBe(first.result_sha256);

    expect(() => validateReviewerResultBinding(reviewerResult(), {
      runId: OTHER_RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    })).toThrow(/run_id|binding/i);
  });

  it('stale SHA、wrong run/round、缺结果文件拒绝', async () => {
    expect(() => validateReviewerResultBinding(reviewerResult(), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 2,
      contractSha: CONTRACT_SHA,
    })).toThrow(/round|binding/i);
    expect(() => validateReviewerResultBinding(reviewerResult(), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: 'b'.repeat(40),
    })).toThrow(/sha|binding/i);

    const rootDir = newRoot();
    const channel = createAttemptResultChannel({
      rootDir,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
    });
    await expect(consumeAttemptResultChannel({
      channel,
      expected: {
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        role: 'reviewer',
        round: 1,
        contractSha: CONTRACT_SHA,
      },
    })).rejects.toThrow(/missing|ENOENT|result/i);
  });

  it('APPROVED 走同一 authority 链', () => {
    const parsed = parseHarnessResult(reviewerResult({
      decision: {
        ...reviewerResult().decision,
        outcome: 'APPROVED',
        reason: '全部反馈已解决',
        feedback: [],
      },
    }), 'reviewer', 'harness-result/reviewer-v1');
    const bound = validateReviewerResultBinding(parsed, {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    expect(bound.decision.outcome).toBe('APPROVED');
    expect(bound.authority).toBe('server_attempt_result');
  });

  it('legacy rollout 只产生显式 no-history', () => {
    const lineage = buildFeedbackLineage({
      runId: RUN_ID,
      nextRound: 2,
      priorReview: null,
      legacyAttempt: true,
    });
    expect(lineage.proposerInputs.prior_review).toEqual({
      state: 'no-history',
      reason: 'legacy-unbound',
    });
  });

  it('确定性截断保留 verdict/binding 且禁 transcript', () => {
    const longReason = '证'.repeat(20_000);
    const first = validateReviewerResultBinding(reviewerResult({
      summary: longReason,
      decision: { ...reviewerResult().decision, reason: longReason },
    }), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    const second = validateReviewerResultBinding(reviewerResult({
      summary: longReason,
      decision: { ...reviewerResult().decision, reason: longReason },
    }), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    expect(first.result_sha256).toBe(second.result_sha256);
    expect(first.decision.outcome).toBe('NEEDS_REVISION');
    expect(first.decision.binding.contract_sha).toBe(CONTRACT_SHA);
    expect(JSON.stringify(first)).not.toMatch(/transcript|chain_of_thought/);
  });

  it('首次 P0 review_required 在人工批准前阻断 merge deploy', () => {
    const lineage = buildFeedbackLineage({
      runId: RUN_ID,
      nextRound: 2,
      priorReview: validateReviewerResultBinding(reviewerResult(), {
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        round: 1,
        contractSha: CONTRACT_SHA,
      }),
      controllerContractChange: true,
      humanApproval: null,
    });
    expect(lineage.release).toEqual({
      review_required: true,
      merge_allowed: false,
      deploy_allowed: false,
    });
  });
});
