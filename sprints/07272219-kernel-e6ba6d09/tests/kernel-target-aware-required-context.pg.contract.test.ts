import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';

const { Pool } = pg;
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';
const GOOD_SHA = 'a'.repeat(40);
const STALE_SHA = 'b'.repeat(40);
const OTHER_SHA = 'c'.repeat(40);
const GOOD_REPO = 'perfectuser21/cecelia';
const OTHER_REPO = 'other/repo';

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_required_context_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_required_context_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: '/workspace/packages/brain',
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
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`);
  }
  if (adminPool) await adminPool.end();
}

async function loadContractModule() {
  return import('../../../packages/brain/src/orchestrator/required-context-contract.js');
}

async function seedTask({
  targetEnvironment = 'local_api',
  reviewRequired = true,
  clientRequiredContexts = ['Deploy Preview Environment'],
} = {}) {
  const taskId = randomUUID();
  const initiativeId = randomUUID();
  const runId = randomUUID();
  const payload = {
    target_environment: targetEnvironment,
    review_required: reviewRequired,
    sprint_dir: 'sprints/07272219-kernel-e6ba6d09',
    required_contexts: clientRequiredContexts,
    legacy_required_contexts: ['legacy-preview'],
  };

  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P0', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `kernel-required-context-${taskId}`, JSON.stringify(payload)],
  );
  await testPool.query(
    `INSERT INTO initiative_runs (id, initiative_id, phase, current_task_id, pr_url, orchestrator_version, deadline_at)
     VALUES ($1, $2, 'evaluate', $3, $4, 'v2', NOW() + INTERVAL '120 minutes')`,
    [runId, initiativeId, taskId, PR_URL],
  );
  return { taskId, runId, initiativeId };
}

async function createGate(overrides = {}) {
  const mod = await loadContractModule();
  return mod.createRequiredContextContract({
    pool: testPool,
    now: () => new Date('2026-07-27T00:00:00Z'),
    getCurrentHeadSha: async () => GOOD_SHA,
    fetchStatusCheckRollup: async () => ({
      repo: GOOD_REPO,
      run_id: 1001,
      head_sha: GOOD_SHA,
      checks: [
        { name: 'brain-ci', state: 'SUCCESS' },
        { name: 'Deploy Preview Environment', state: 'FAILURE' },
      ],
    }),
    capturePreviewFailureEvidence: async () => ({
      http_status: 503,
      response_body: '{"error":"preview infra red"}',
      error: 'curl exited with 22',
    }),
    ...overrides,
  });
}

beforeAll(createIsolatedDatabase, 30_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Kernel target-aware required-context contract [BEHAVIOR]', () => {
  it('服务端 target_environment 覆盖客户端 required_contexts', async () => {
    const gate = await createGate();
    const seeded = await seedTask({
      targetEnvironment: 'local_api',
      clientRequiredContexts: ['Deploy Preview Environment', 'totally-client-made-up'],
    });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
    });

    expect(result.target_environment).toBe('local_api');
    expect(result.client_required_contexts_used).toBe(false);
    expect(result.required_contexts).toEqual(['brain-ci']);
    expect(result.head_sha).toBe(GOOD_SHA);
  });

  it('local_api preview neutral 且仅 required contexts 全过才继续', async () => {
    const gate = await createGate({
      fetchStatusCheckRollup: async () => ({
        repo: GOOD_REPO,
        run_id: 1001,
        head_sha: GOOD_SHA,
        checks: [
          { name: 'brain-ci', state: 'SUCCESS' },
          { name: 'Deploy Preview Environment', state: 'FAILURE' },
        ],
      }),
    });
    const seeded = await seedTask({ targetEnvironment: 'local_api' });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
    });

    expect(result.decision).toBe('continue');
    expect(result.contexts.find((c) => c.name === 'Deploy Preview Environment')).toMatchObject({
      classification: 'neutral',
      required: false,
    });
    expect(result.contexts.find((c) => c.name === 'brain-ci')).toMatchObject({
      classification: 'pass',
      required: true,
    });
  });

  it('preview 目标 preview failure 缺失 stale SHA 错 repo run 一律阻断', async () => {
    const gate = await createGate({
      fetchStatusCheckRollup: async () => ({
        repo: OTHER_REPO,
        run_id: 9999,
        head_sha: STALE_SHA,
        checks: [{ name: 'Deploy Preview Environment', state: 'FAILURE' }],
      }),
    });
    const seeded = await seedTask({ targetEnvironment: 'preview_env' });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
      expectedRunId: 1001,
      expectedRepo: GOOD_REPO,
    });

    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/preview_failed|missing_required_context|stale_check_sha|repo_mismatch|run_mismatch/);
    expect(result.contexts.find((c) => c.name === 'Deploy Preview Environment')?.required).toBe(true);
  });

  it('preview 启动失败保留 status body error evidence', async () => {
    const gate = await createGate({
      fetchStatusCheckRollup: async () => ({
        repo: GOOD_REPO,
        run_id: 1001,
        head_sha: GOOD_SHA,
        checks: [{ name: 'Deploy Preview Environment', state: 'FAILURE' }],
      }),
      capturePreviewFailureEvidence: async () => ({
        http_status: 503,
        response_body: '{"error":"upstream bad gateway"}',
        error: 'curl: (22) The requested URL returned error: 503',
      }),
    });
    const seeded = await seedTask({ targetEnvironment: 'preview_env' });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
    });

    expect(result.preview_failure_evidence).toMatchObject({
      http_status: 503,
      response_body: '{"error":"upstream bad gateway"}',
      error: expect.stringContaining('curl: (22)'),
    });
  });

  it('缺失 required context 必须阻断并返回审计原因', async () => {
    const gate = await createGate({
      fetchStatusCheckRollup: async () => ({
        repo: GOOD_REPO,
        run_id: 1001,
        head_sha: GOOD_SHA,
        checks: [],
      }),
    });
    const seeded = await seedTask({ targetEnvironment: 'local_api' });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
    });

    expect(result.decision).toBe('block');
    expect(result.reason).toBe('missing_required_context');
    expect(result.missing_contexts).toContain('brain-ci');
  });

  it('legacy rollout 不得覆盖服务端 required context contract', async () => {
    const gate = await createGate();
    const seeded = await seedTask({
      targetEnvironment: 'local_api',
      clientRequiredContexts: ['Deploy Preview Environment', 'legacy-preview'],
    });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
      legacyRequiredContexts: ['Deploy Preview Environment'],
    });

    expect(result.required_contexts).toEqual(['brain-ci']);
    expect(result.legacy_inputs_observed).toBe(true);
    expect(result.client_required_contexts_used).toBe(false);
  });

  it('generator fix 仅在真正 required failure 才触发', async () => {
    const gate = await createGate();
    const localTask = await seedTask({ targetEnvironment: 'local_api' });
    const previewTask = await seedTask({ targetEnvironment: 'preview_env' });

    const localResult = await gate.evaluateTaskGate({
      taskId: localTask.taskId,
      runId: localTask.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
    });
    const previewResult = await gate.evaluateTaskGate({
      taskId: previewTask.taskId,
      runId: previewTask.runId,
      prUrl: PR_URL,
      mode: 'pre_merge',
    });

    expect(localResult.generator_fix_required).toBe(false);
    expect(previewResult.generator_fix_required).toBe(true);
  });

  it('post merge staging production hard gate 与 review_required 单 SHA 审批', async () => {
    const gate = await createGate({
      fetchStatusCheckRollup: async () => ({
        repo: GOOD_REPO,
        run_id: 1001,
        head_sha: OTHER_SHA,
        checks: [{ name: 'staging-e2e', state: 'FAILURE' }],
      }),
    });
    const seeded = await seedTask({ targetEnvironment: 'staging_e2e', reviewRequired: true });

    const result = await gate.evaluateTaskGate({
      taskId: seeded.taskId,
      runId: seeded.runId,
      prUrl: PR_URL,
      mode: 'post_merge',
      expectedRunId: 1001,
      expectedRepo: GOOD_REPO,
      reviewApprovedSha: GOOD_SHA,
    });

    expect(result.decision).toBe('block');
    expect(result.review_required).toBe(true);
    expect(result.merge_allowed).toBe(false);
    expect(result.reason).toMatch(/required_context_failed|review_not_approved|stale_check_sha/);
  });
});
