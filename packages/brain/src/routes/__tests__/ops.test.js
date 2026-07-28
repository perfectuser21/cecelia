/**
 * ops.test.js
 * 验证 deploy webhook 使用 REPO_ROOT 环境变量而非 import.meta.url 推算路径。
 * 当 REPO_ROOT=/custom/repo/root，spawn 第二个参数 args[0] 应为
 * /custom/repo/root/scripts/deploy-local.sh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';

let capturedSpawnArgs = null;
let spawnError = null;
let terminalWriteError = null;
const rollbackAuthorityId = '66666666-6666-4666-8666-666666666666';
const rollbackTargets = [{
  artifact_name: 'brain',
  current_version: '1.2.3',
  current_digest: `sha256:${'a'.repeat(64)}`,
  previous_version: `brain-image:sha256:${'b'.repeat(64)}`,
  previous_digest: `sha256:${'b'.repeat(64)}`,
  rollback_metadata: {
    image_reference: `sha256:${'b'.repeat(64)}`,
    image_tag: `cecelia-brain:rollback-${'b'.repeat(12)}`,
    current_image_digest: `sha256:${'a'.repeat(64)}`,
  },
}];

const query = vi.fn(async (sql) => {
  if (/INSERT INTO kernel_release_rollback_execution_authorities/.test(sql)) {
    return {
      rows: [{
        id: rollbackAuthorityId,
        release_run_id: '44444444-4444-4444-8444-444444444444',
        expected_merge_sha: 'f'.repeat(40),
        idempotency_key: '77777777-7777-4777-8777-777777777777',
        expected_artifact_versions: [{
          name: 'brain',
          version: '1.2.3',
          digest: `sha256:${'a'.repeat(64)}`,
        }],
        rollback_targets: rollbackTargets,
      }],
      rowCount: 1,
    };
  }
  if (/INSERT INTO kernel_release_rollback_execution_claims/.test(sql)) {
    return {
      rows: [{
        authority_id: rollbackAuthorityId,
        release_run_id: '44444444-4444-4444-8444-444444444444',
        expected_merge_sha: 'f'.repeat(40),
        idempotency_key: '77777777-7777-4777-8777-777777777777',
        expected_artifact_versions: [{
          name: 'brain',
          version: '1.2.3',
          digest: `sha256:${'a'.repeat(64)}`,
        }],
        rollback_targets: rollbackTargets,
        claim_id: 72,
        generation: 1,
        lease_expires_at: new Date(Date.now() + 60_000),
        inserted: true,
      }],
      rowCount: 1,
    };
  }
  if (
    terminalWriteError
    && (
      /INSERT INTO kernel_release_effect_dispatch_outcomes/.test(sql)
      || /INSERT INTO kernel_release_rollback_execution_settlements/.test(sql)
    )
  ) {
    throw terminalWriteError;
  }
  if (
    /FROM kernel_release_rollback_execution_authorities authority/.test(sql)
    && /settlement\.settlement_status/.test(sql)
  ) {
    return { rows: [{
      authority_id: rollbackAuthorityId,
      release_run_id: '44444444-4444-4444-8444-444444444444',
      merge_sha: 'f'.repeat(40),
      artifact_versions: [{ name: 'brain', version: '1.2.3', digest: `sha256:${'a'.repeat(64)}` }],
      rollback_targets: rollbackTargets,
      claim_id: 72,
      generation: 1,
      settlement_status: 'unknown',
      late_effect_risk: true,
      evidence: { error_code: 'release_rollback_lease_lost' },
    }] };
  }
  if (/INSERT INTO kernel_release_effect_dispatch_claims/.test(sql)) {
    return {
      rows: [{
        id: 91,
        generation: 1,
        lease_expires_at: new Date(Date.now() + 60_000),
        inserted: true,
      }],
      rowCount: 1,
    };
  }
  if (/INSERT INTO kernel_release_effect_dispatch_outcomes/.test(sql)) {
    return { rows: [], rowCount: 1 };
  }
  return { rows: [{
    state: 'production_deploying',
    merge_sha: 'f'.repeat(40),
    expected_merge_sha: 'f'.repeat(40),
    effect_kind: 'production',
    idempotency_key: '55555555-5555-4555-8555-555555555555',
    artifact_versions: [{
      name: 'brain',
      version: '1.2.3',
      digest: `sha256:${'a'.repeat(64)}`,
    }],
  }], rowCount: 1 };
});

vi.mock('../../db.js', () => ({ default: {
  query,
  connect: vi.fn(async () => ({ query, release: vi.fn() })),
} }));
vi.mock('../../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../../orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../../tick.js', () => ({ check48hReport: vi.fn() }));
vi.mock('../../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../../task-cleanup.js', () => ({
  getCleanupStats: vi.fn(),
  runTaskCleanup: vi.fn(),
  getCleanupAuditLog: vi.fn(),
}));
vi.mock('../../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));
vi.mock('../../decomposition-checker.js', () => ({ runDecompositionChecks: vi.fn() }));
vi.mock('../../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));
vi.mock('../../orchestrator/release-run-routing.js', () => ({
  planReleaseArtifactRoutes: vi.fn(() => [{
    artifact: 'brain',
    command: '/custom/repo/root/scripts/brain-deploy.sh',
    args: [],
    env: {},
  }]),
}));
vi.mock('../../orchestrator/release-run-rollback-routing.js', () => ({
  planRollbackArtifactRoutes: vi.fn(() => [{
    artifact: 'brain',
    command: '/custom/repo/root/scripts/brain-rollback.sh',
    args: [`rollback-${'b'.repeat(12)}`],
    expected_digest: `sha256:${'b'.repeat(64)}`,
    readback_kind: 'brain-image',
  }]),
}));
vi.mock('../shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
vi.mock('child_process', () => ({
  execFileSync: vi.fn((_command, args) => (
    args[3] === '{{.Image}}'
      ? `sha256:${'a'.repeat(64)}\n`
      : 'cecelia_default\n'
  )),
  spawn: (...args) => {
    if (spawnError) throw spawnError;
    capturedSpawnArgs = args;
    return {
      unref: vi.fn(),
      on: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(0, null));
      }),
    };
  },
  execSync: vi.fn(),
}));

describe('ops — deploy REPO_ROOT path', () => {
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;

  beforeEach(async () => {
    query.mockClear();
    capturedSpawnArgs = null;
    spawnError = null;
    terminalWriteError = null;
    process.env.DEPLOY_TOKEN = 'test-token';
    process.env.REPO_ROOT = '/custom/repo/root';
    process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT = mkdtempSync(
      `${tmpdir()}/kernel-release-worker-test-`,
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_REPO_ROOT === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = ORIG_REPO_ROOT;
    }
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
    rmSync(process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT, {
      recursive: true,
      force: true,
    });
    delete process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT;
  });

  it('POST /deploy 使用 REPO_ROOT 拼接 deploy-local.sh 路径', async () => {
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        release_authorization: '55555555-5555-4555-8555-555555555555',
      });

    expect(res.status).toBe(202);
    expect(capturedSpawnArgs).not.toBeNull();
    expect(capturedSpawnArgs[0]).toBe('docker');
    expect(capturedSpawnArgs[1])
      .toContain('/repo/scripts/lib/release-run-effect-worker.mjs');
    const opts = capturedSpawnArgs[2];
    expect(opts.cwd).toBe('/custom/repo/root');
  });

  it('POST /deploy 缺 ReleaseRun authority 时 fail closed before spawn', async () => {
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/release_effect_request_invalid/);
    expect(capturedSpawnArgs).toBeNull();
  });

  it('cleans the private authority file immediately when detached spawn fails', async () => {
    const countPrivateConfigs = () => readdirSync(tmpdir())
      .filter((entry) => entry.startsWith('cecelia-release-worker-')).length;
    const before = countPrivateConfigs();
    spawnError = new Error('spawn unavailable');
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        release_authorization: '55555555-5555-4555-8555-555555555555',
      });

    expect(res.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(countPrivateConfigs()).toBe(before);
  });

  it('persists a failed production outcome when prelaunch setup throws after claim', async () => {
    const runtimeRoot = process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT;
    process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT = '/dev/null/release-worker';
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        release_authorization: '55555555-5555-4555-8555-555555555555',
      });
    process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT = runtimeRoot;
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO kernel_release_effect_dispatch_outcomes/),
      expect.arrayContaining([91, 1, 'failed']),
    ));
  });

  it('preserves recovery authority when the production terminal write fails', async () => {
    spawnError = new Error('spawn unavailable');
    terminalWriteError = new Error('database unavailable');
    const runtimeRoot = process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT;
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        release_authorization: '55555555-5555-4555-8555-555555555555',
      });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(
      readdirSync(runtimeRoot, { recursive: true })
        .some((entry) => entry.endsWith('authority.json')),
    ).toBe(true));
  });

  it('records an ambiguous production launch as unknown, never failed', async () => {
    spawnError = Object.assign(
      new Error('docker response unavailable'),
      { code: 'release_controller_launch_outcome_unknown' },
    );
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        release_authorization: '55555555-5555-4555-8555-555555555555',
      });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO kernel_release_effect_dispatch_outcomes/),
      expect.arrayContaining([91, 1, 'unknown']),
    ));
    expect(query).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO kernel_release_effect_dispatch_outcomes/),
      expect.arrayContaining([91, 1, 'failed']),
    );
  });

  it('REPO_ROOT 未设置时 path 不崩溃（含 deploy-local.sh 后缀）', () => {
    const repoRootFallback = new URL('../../../../../..', import.meta.url).pathname;
    const scriptFallback = `${repoRootFallback}/scripts/deploy-local.sh`;
    expect(scriptFallback).toMatch(/scripts\/deploy-local\.sh$/);
    const scriptWithEnv = `${process.env.REPO_ROOT}/scripts/deploy-local.sh`;
    expect(scriptWithEnv).toBe('/custom/repo/root/scripts/deploy-local.sh');
  });

  it('POST /deploy/rollback uses a disjoint durable authority and typed worker', async () => {
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        rollback_authorization: '77777777-7777-4777-8777-777777777777',
      });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: 'accepted',
      authority_id: rollbackAuthorityId,
      claim_id: 72,
    });
    expect(capturedSpawnArgs[0]).toBe('docker');
    expect(capturedSpawnArgs[1]).toContain('/repo/scripts/lib/release-run-rollback-worker.mjs');
    expect(capturedSpawnArgs[1]).toContain(`sha256:${'a'.repeat(64)}`);
    const dockerArgs = capturedSpawnArgs[1].join('\n');
    expect(dockerArgs).not.toContain('77777777-7777-4777-8777-777777777777');
    expect(dockerArgs).toContain('KERNEL_RELEASE_ROLLBACK_TARGETS=');
    expect(res.body.controller).toBe('cecelia-release-rollback-72-1');
  });

  it('settles rollback failed when prelaunch setup throws after claim', async () => {
    const runtimeRoot = process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT;
    process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT = '/dev/null/release-worker';
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        rollback_authorization: '77777777-7777-4777-8777-777777777777',
      });
    process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT = runtimeRoot;
    expect(res.status).toBe(500);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO kernel_release_rollback_execution_settlements/),
      expect.arrayContaining([72, 1, 'failed', false]),
    );
  });

  it('preserves rollback recovery authority when terminal settlement fails', async () => {
    spawnError = new Error('spawn unavailable');
    terminalWriteError = new Error('database unavailable');
    const runtimeRoot = process.env.KERNEL_RELEASE_WORKER_RUNTIME_ROOT;
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        rollback_authorization: '77777777-7777-4777-8777-777777777777',
      });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('release_rollback_terminal_persistence_failed');
    expect(
      readdirSync(runtimeRoot, { recursive: true })
        .some((entry) => entry.endsWith('authority.json')),
    ).toBe(true);
  });

  it('settles an ambiguous rollback launch unknown with late-effect risk', async () => {
    spawnError = Object.assign(
      new Error('docker response unavailable'),
      { code: 'release_controller_launch_outcome_unknown' },
    );
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-token')
      .send({
        release_run_id: '44444444-4444-4444-8444-444444444444',
        merge_sha: 'f'.repeat(40),
        rollback_authorization: '77777777-7777-4777-8777-777777777777',
      });
    expect(res.status).toBe(500);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO kernel_release_rollback_execution_settlements/),
      expect.arrayContaining([72, 1, 'unknown', true]),
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO kernel_release_rollback_execution_settlements/),
      expect.arrayContaining([72, 1, 'failed', false]),
    );
  });

  it('denies legacy rollback without exact authority axes before spawn', async () => {
    const mod = await import('../ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
    capturedSpawnArgs = null;
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-token')
      .send({ sha: 'main' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('release_rollback_authority_request_invalid');
    expect(capturedSpawnArgs).toBeNull();
  });

  it('observes rollback settlement from durable DB state across module reload', async () => {
    const mod = await import('../ops.js');
    const app = express();
    app.use('/api/brain', mod.default);
    const first = await request(app)
      .get(`/api/brain/deploy/rollback/${rollbackAuthorityId}`)
      .set('Authorization', 'Bearer test-token');
    vi.resetModules();
    const restarted = await import('../ops.js');
    const restartedApp = express();
    restartedApp.use('/api/brain', restarted.default);
    const second = await request(restartedApp)
      .get(`/api/brain/deploy/rollback/${rollbackAuthorityId}`)
      .set('Authorization', 'Bearer test-token');
    expect(first.body).toEqual(second.body);
    expect(second.body).toMatchObject({
      status: 'unknown',
      late_effect_risk: true,
    });
  });
});

describe('feishu/impression mouth timeout — bridge OAuth 真实响应需 10-30s', () => {
  it('updateFeishuImpression 必须用 timeout >= 60000，不能用 8000', async () => {
    const { readFileSync } = await import('fs');
    const opsPath = new URL('../ops.js', import.meta.url).pathname;
    const src = readFileSync(opsPath, 'utf8');

    const impressionCall = src.match(/callLLM\('mouth',\s*prompt,\s*\{\s*timeout:\s*(\d+)/);
    expect(impressionCall, 'feishu/impression 应该调用 callLLM mouth with timeout option').not.toBeNull();
    const timeoutVal = parseInt(impressionCall[1], 10);
    expect(timeoutVal).toBeGreaterThanOrEqual(60000);
    expect(timeoutVal).not.toBe(8000);
  });

  it('ops.js 不再含 8s timeout 用于 mouth callLLM', async () => {
    const { readFileSync } = await import('fs');
    const opsPath = new URL('../ops.js', import.meta.url).pathname;
    const src = readFileSync(opsPath, 'utf8');
    const badPattern = /callLLM\('mouth',[^)]*timeout:\s*8000/;
    expect(src).not.toMatch(badPattern);
  });
});
