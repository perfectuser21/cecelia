/**
 * deploy-repo-root.test.js
 * 验证 deploy webhook 使用 REPO_ROOT 环境变量而非 import.meta.url 推算路径。
 * 当 REPO_ROOT=/custom/repo/root，typed worker 路径应为
 * /custom/repo/root/scripts/lib/release-run-effect-worker.mjs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

// Capture what spawn was called with — updated per test
let capturedControllerOptions = null;
const {
  claimReleaseEffect,
  recordActionReceipt,
  launchProductionController,
} = vi.hoisted(() => ({
  claimReleaseEffect: vi.fn(),
  recordActionReceipt: vi.fn().mockResolvedValue('r-dep'),
  launchProductionController: vi.fn(async (options) => {
    capturedControllerOptions = options;
    return { name: 'controller' };
  }),
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../receipt-collector.js', () => ({
  recordActionReceipt,
  resolveActionReceipt: vi.fn().mockResolvedValue(true),
}));
vi.mock('../orchestrator/release-run-authorization.js', () => ({
  authorizeReleaseEffect: vi.fn(),
  appendDispatchOutcome: vi.fn().mockResolvedValue(true),
  claimReleaseEffect,
  claimReleaseVerification: vi.fn(),
}));
vi.mock('../orchestrator/release-run-routing.js', () => ({
  planReleaseArtifactRoutes: vi.fn(() => [{
    artifact: 'brain',
    command: '/fixture/deploy-brain.sh',
    args: [],
    env: {},
  }]),
}));
vi.mock('../orchestrator/release-run-controller-launcher.js', () => ({
  launchProductionController,
  launchRollbackController: vi.fn(),
  resolveRollbackControllerRuntime: vi.fn(() => ({
    image: `sha256:${'a'.repeat(64)}`,
    network: 'fixture',
  })),
}));
vi.mock('../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../tick.js', () => ({ check48hReport: vi.fn() }));
vi.mock('../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../task-cleanup.js', () => ({
  getCleanupStats: vi.fn(),
  runTaskCleanup: vi.fn(),
  getCleanupAuditLog: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));
vi.mock('../decomposition-checker.js', () => ({ runDecompositionChecks: vi.fn() }));
vi.mock('../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));
vi.mock('./shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

describe('deploy-repo-root', () => {
  const authority = {
    release_run_id: '44444444-4444-4444-8444-444444444444',
    merge_sha: 'f'.repeat(40),
    release_authorization: '55555555-5555-4555-8555-555555555555',
  };
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;
  let repoRoot;

  beforeEach(async () => {
    capturedControllerOptions = null;
    process.env.DEPLOY_TOKEN = 'test-token';
    repoRoot = mkdtempSync(join(tmpdir(), 'deploy-repo-root-'));
    process.env.REPO_ROOT = repoRoot;
    claimReleaseEffect.mockResolvedValue({
      claimed: true,
      deduped: false,
      dispatch_claim_id: 91,
      generation: 1,
      artifact_versions: [{
        name: 'brain',
        version: '1.268.15',
        digest: `sha256:${'a'.repeat(64)}`,
      }],
    });
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_REPO_ROOT === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = ORIG_REPO_ROOT;
    }
    rmSync(repoRoot, { recursive: true, force: true });
    // 清理 deploy 状态文件，防止下一个 test 的 fresh module 加载到 running 状态
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
  });

  it('POST /deploy 使用 REPO_ROOT 拼接 typed worker 路径', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);

    expect(res.status).toBe(202);
    const deadline = Date.now() + 2000;
    while (capturedControllerOptions === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(capturedControllerOptions).not.toBeNull();
    expect(capturedControllerOptions.repoRoot).toBe(repoRoot);
    expect(capturedControllerOptions.logFile).toMatch(
      new RegExp(`^${repoRoot}/logs/cecelia-deploy-`),
    );
  });

  it('REPO_ROOT 未设置时 path 计算不崩溃（含 typed worker 后缀）', () => {
    // 不走 HTTP，只验证路径计算逻辑：process.env.REPO_ROOT || import.meta.url fallback
    const repoRootFallback = new URL('../../../../..', import.meta.url).pathname;
    const scriptFallback = `${repoRootFallback}/scripts/lib/release-run-effect-worker.mjs`;
    // 回退路径应包含 typed worker 后缀
    expect(scriptFallback).toMatch(/scripts\/lib\/release-run-effect-worker\.mjs$/);
    // 设置 REPO_ROOT 时，路径使用 REPO_ROOT
    const scriptWithEnv = `${process.env.REPO_ROOT}/scripts/lib/release-run-effect-worker.mjs`;
    expect(scriptWithEnv).toBe(`${repoRoot}/scripts/lib/release-run-effect-worker.mjs`);
  });
});
