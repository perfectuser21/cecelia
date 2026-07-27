import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import approvalRouter from '../../../packages/brain/src/routes/harness-kernel-approvals.js';
import { mergeGate } from '../../../packages/brain/src/orchestrator/gates.js';
import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';
import { finalizeHarnessTask } from '../../../packages/brain/src/lib/harness-finalize.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../packages/brain/', import.meta.url));
const APPROVER_TOKEN = 'kernel-contract-token';
const REPO = 'perfectuser21/cecelia';
const PR_NUMBER = 4379;
const PR_URL = `https://github.com/${REPO}/pull/${PR_NUMBER}`;
const HEAD_SHA = 'a'.repeat(40);
const NEXT_HEAD_SHA = 'b'.repeat(40);

let adminPool: InstanceType<typeof Pool> | null = null;
let testPool: InstanceType<typeof Pool> | null = null;
let databaseName = '';

function quotedIdentifier(value: string) {
  if (!/^kernel_wiring_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_wiring_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
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
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 10 });
}

async function dropIsolatedDatabase() {
  if (testPool) await testPool.end();
  testPool = null;
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`);
  }
  if (adminPool) await adminPool.end();
  adminPool = null;
}

async function seedRun({ reviewRequired = true } = {}) {
  if (!testPool) throw new Error('testPool unavailable');
  const initiativeId = randomUUID();
  const contractId = randomUUID();
  const taskId = randomUUID();
  const runId = randomUUID();
  await testPool.query(
    `INSERT INTO initiative_contracts
       (id, initiative_id, version, status, prd_content, contract_content, approved_at)
     VALUES ($1, $2, 1, 'approved', 'prd', 'contract', NOW())`,
    [contractId, initiativeId],
  );
  await testPool.query(
    `INSERT INTO tasks
       (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [
      taskId,
      `kernel-contract-${taskId}`,
      JSON.stringify({
        harness_runtime: 'kernel-v1',
        sprint_dir: 'sprints/0727184802-kernel-merge-authority',
        worktree_path: '/workspace',
        review_required: reviewRequired,
      }),
    ],
  );
  await testPool.query(
    `INSERT INTO initiative_runs
       (id, initiative_id, contract_id, phase, current_task_id, pr_url,
        orchestrator_version, deadline_at)
     VALUES ($1, $2, $3, 'evaluate', $4, $5, 'v2', NOW() + INTERVAL '120 minutes')`,
    [runId, initiativeId, contractId, taskId, PR_URL],
  );
  return { runId, taskId };
}

async function appendReviewRequest(runId: string, sha: string, hop = 3) {
  if (!testPool) throw new Error('testPool unavailable');
  await testPool.query(
    `INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     VALUES ($1, $2, $3::jsonb, 'review', null, 'effect:human_review_requested', $4::jsonb)`,
    [
      runId,
      hop,
      JSON.stringify({ pr: { head_sha: sha } }),
      JSON.stringify({ dispatch_hop: 2, review_reason: 'awaiting_human_review' }),
    ],
  );
}

function createApp(currentSha: string) {
  const app = express();
  app.use(express.json());
  app.set('pool', testPool);
  app.set('kernelPrHeadResolver', async () => currentSha);
  app.use('/api/brain/harness/kernel-reviews', approvalRouter);
  return app;
}

async function approvalRows(runId: string) {
  if (!testPool) throw new Error('testPool unavailable');
  const result = await testPool.query(
    `SELECT detail
       FROM orchestrator_decision_log
      WHERE run_id=$1 AND action='verdict:human_review'
      ORDER BY hop`,
    [runId],
  );
  return result.rows;
}

afterEach(() => {
  delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
});

describe('kernel merge authority contract red tests', () => {
  describe('Kernel approval route on real PostgreSQL', () => {
    beforeAll(createIsolatedDatabase, 30_000);
    afterAll(dropIsolatedDatabase, 30_000);

    it('approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict', async () => {
      process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
      const run = await seedRun();
      await appendReviewRequest(run.runId, HEAD_SHA);
      const app = createApp(HEAD_SHA);

      const response = await request(app)
        .post(`/api/brain/harness/kernel-reviews/${run.runId}/approve`)
        .set('x-approver-token', APPROVER_TOKEN)
        .send({
          task_id: run.taskId,
          pr_head_sha: HEAD_SHA,
          review_request_hop: 3,
          approved_by: 'alex',
        });

      expect(response.status).toBe(400);
      expect(await approvalRows(run.runId)).toHaveLength(0);
    });

    it('approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail', async () => {
      process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
      const run = await seedRun();
      await appendReviewRequest(run.runId, HEAD_SHA);
      const app = createApp(HEAD_SHA);

      const response = await request(app)
        .post(`/api/brain/harness/kernel-reviews/${run.runId}/approve`)
        .set('x-approver-token', APPROVER_TOKEN)
        .send({
          task_id: run.taskId,
          repo: REPO,
          pr_number: PR_NUMBER,
          pr_head_sha: HEAD_SHA,
          review_request_hop: 3,
          approved_by: 'alex',
        });

      expect(response.status).toBe(202);
      const approvals = await approvalRows(run.runId);
      expect(approvals).toHaveLength(1);
      expect(approvals[0].detail).toMatchObject({
        approved_by: 'alex',
        pr_head_sha: HEAD_SHA,
        source: 'authenticated_route',
        timestamp: expect.any(String),
        repo: REPO,
        pr_number: PR_NUMBER,
        run_id: run.runId,
      });
    });

    it('reject route stale SHA 或 run/PR 不匹配时拒绝且不写 human_review verdict', async () => {
      process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;

      const staleRun = await seedRun();
      await appendReviewRequest(staleRun.runId, HEAD_SHA);
      const staleApp = createApp(NEXT_HEAD_SHA);
      const stale = await request(staleApp)
        .post(`/api/brain/harness/kernel-reviews/${staleRun.runId}/reject`)
        .set('x-approver-token', APPROVER_TOKEN)
        .send({
          task_id: staleRun.taskId,
          repo: REPO,
          pr_number: PR_NUMBER,
          pr_head_sha: HEAD_SHA,
          review_request_hop: 3,
          rejected_by: 'alex',
        });

      expect(stale.status).toBe(409);
      expect(await approvalRows(staleRun.runId)).toHaveLength(0);

      const mismatchRun = await seedRun();
      await appendReviewRequest(mismatchRun.runId, HEAD_SHA);
      const mismatchApp = createApp(HEAD_SHA);
      const mismatch = await request(mismatchApp)
        .post(`/api/brain/harness/kernel-reviews/${mismatchRun.runId}/reject`)
        .set('x-approver-token', APPROVER_TOKEN)
        .send({
          task_id: mismatchRun.taskId,
          repo: 'perfectuser21/other-repo',
          pr_number: PR_NUMBER + 1,
          pr_head_sha: HEAD_SHA,
          review_request_hop: 3,
          rejected_by: 'alex',
        });

      expect(mismatch.status).toBe(409);
      expect(await approvalRows(mismatchRun.runId)).toHaveLength(0);
    });

    it('reject route 记录含 rejected_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail', async () => {
      process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
      const run = await seedRun();
      await appendReviewRequest(run.runId, HEAD_SHA);
      const app = createApp(HEAD_SHA);

      const response = await request(app)
        .post(`/api/brain/harness/kernel-reviews/${run.runId}/reject`)
        .set('x-approver-token', APPROVER_TOKEN)
        .send({
          task_id: run.taskId,
          repo: REPO,
          pr_number: PR_NUMBER,
          pr_head_sha: HEAD_SHA,
          review_request_hop: 3,
          rejected_by: 'alex',
        });

      expect(response.status).toBe(202);
      const approvals = await approvalRows(run.runId);
      expect(approvals).toHaveLength(1);
      expect(approvals[0].detail).toMatchObject({
        rejected_by: 'alex',
        pr_head_sha: HEAD_SHA,
        source: 'authenticated_route',
        timestamp: expect.any(String),
        repo: REPO,
        pr_number: PR_NUMBER,
        run_id: run.runId,
      });
    });
  });

  it('review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并', () => {
    const result = mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      prHeadSha: HEAD_SHA,
      reviewRequired: true,
      reviewApproved: false,
    } as never);

    expect(result.allow).toBe(false);
  });

  it('mergeGate 对 stale human approval fail-closed 并要求重跑证据链', () => {
    const result = mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: NEXT_HEAD_SHA },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: NEXT_HEAD_SHA },
      prHeadSha: NEXT_HEAD_SHA,
      reviewRequired: true,
      reviewApproved: true,
      reviewVerdict: { approved: true, pr_head_sha: HEAD_SHA },
    } as never);

    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/stale|review/i);
  });

  it('merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha', async () => {
    const execCmd = vi.fn();
    const handlers = createKernelHandlers({
      execCmd,
      pool: { query: vi.fn() },
      attemptStore: { complete: vi.fn() },
      judgeGate: vi.fn(),
      allocatePort: vi.fn(),
      spawnReviewPreview: vi.fn(),
      notifyReview: vi.fn(),
      promote: vi.fn(),
      buildHandoff: vi.fn(),
      saveHandoff: vi.fn(),
      syncOkr: vi.fn(),
      spawnStaging: vi.fn(),
      cleanup: vi.fn(),
    } as never);

    await handlers.merge_pr({
      observed: {
        pr: {
          url: PR_URL,
          head_sha: HEAD_SHA,
          state: 'OPEN',
          merged: false,
          mergeStateStatus: 'CLEAN',
        },
      },
      decisionLog: [],
    } as never);

    expect(execCmd).toHaveBeenCalledWith(expect.stringContaining(`--match-head-commit ${HEAD_SHA}`));
  });

  it('标题 feat(harness) 或 cp- branch 本身不能决定 Harness merge authority', () => {
    const out = execFileSync(
      'bash',
      ['.github/workflows/scripts/should-auto-merge.sh', 'cp-07271848-ws-deadbeef', 'feat(harness): demo'],
      { cwd: '/workspace', encoding: 'utf8' },
    ).trim();

    expect(out).toContain('FAIL_CLOSED');
  });

  it('resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组', async () => {
    const mod = await import('../../../packages/brain/src/harness-ci-gate.js');
    expect(typeof (mod as Record<string, unknown>).resolveKernelMergeAuthority).toBe('function');
    const resolver = (mod as Record<string, Function>).resolveKernelMergeAuthority;

    expect(resolver({
      repo: REPO,
      pr_number: PR_NUMBER,
      run_id: randomUUID(),
      head_sha: HEAD_SHA,
    })).toEqual({ kernelOwned: true });

    expect(resolver({
      repo: REPO,
      pr_number: PR_NUMBER,
      run_id: randomUUID(),
    })).toEqual({ kernelOwned: false, reason: 'missing_head_sha' });
  });

  it('finalizeHarnessTask 在 review_required=true 且缺当前 SHA human_review 时 fail-closed', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks')) {
          return {
            rows: [{
              id: randomUUID(),
              status: 'in_progress',
              task_type: 'harness_initiative',
              pr_url: PR_URL,
              payload: {
                orchestrator: 'skill-relay',
                base_repo: 'https://github.com/perfectuser21/cecelia',
                review_required: true,
              },
            }],
          };
        }
        if (sql.includes('FROM initiative_run_events')) {
          return { rows: [{ x: 1 }] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes('generator_done')) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [] };
      }),
    };

    const result = await finalizeHarnessTask('task-finalize-red', {
      pool,
      ghFn: vi.fn(async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ state: 'MERGED' });
        throw new Error(`unexpected gh args: ${args.join(' ')}`);
      }),
    });

    expect(result).toMatchObject({ applies: true, allow: false });
    expect(String(result.reason)).toMatch(/human_review|review|judge/i);
  });
});
