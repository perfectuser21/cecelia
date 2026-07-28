/**
 * ops.test.js
 * 验证 deploy webhook 使用 REPO_ROOT 环境变量而非 import.meta.url 推算路径。
 * 当 REPO_ROOT=/custom/repo/root，spawn 第二个参数 args[0] 应为
 * /custom/repo/root/scripts/deploy-local.sh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, unlinkSync } from 'fs';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';

let capturedSpawnArgs = null;
let spawnError = null;

const query = vi.fn(async (sql) => {
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
vi.mock('../shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
vi.mock('child_process', () => ({
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
    capturedSpawnArgs = null;
    spawnError = null;
    process.env.DEPLOY_TOKEN = 'test-token';
    process.env.REPO_ROOT = '/custom/repo/root';
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_REPO_ROOT === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = ORIG_REPO_ROOT;
    }
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
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
    const scriptPath = capturedSpawnArgs[1][0];
    expect(scriptPath).toBe('/custom/repo/root/scripts/lib/release-run-effect-worker.mjs');
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

  it('REPO_ROOT 未设置时 path 不崩溃（含 deploy-local.sh 后缀）', () => {
    const repoRootFallback = new URL('../../../../../..', import.meta.url).pathname;
    const scriptFallback = `${repoRootFallback}/scripts/deploy-local.sh`;
    expect(scriptFallback).toMatch(/scripts\/deploy-local\.sh$/);
    const scriptWithEnv = `${process.env.REPO_ROOT}/scripts/deploy-local.sh`;
    expect(scriptWithEnv).toBe('/custom/repo/root/scripts/deploy-local.sh');
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
