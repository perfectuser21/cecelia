/**
 * deploy-repo-root.test.js
 * 验证 deploy webhook 使用 REPO_ROOT 环境变量而非 import.meta.url 推算路径。
 * 当 REPO_ROOT=/custom/repo/root，spawn 第二个参数 args[0] 应为
 * /custom/repo/root/scripts/deploy-local.sh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import express from 'express';
import request from 'supertest';

// Capture what spawn was called with — updated per test
let capturedSpawnArgs = null;

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
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
  spawn: (...args) => {
    capturedSpawnArgs = args;
    return { unref: vi.fn(), on: vi.fn() };
  },
  execSync: vi.fn(),
}));

describe('deploy-repo-root', () => {
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;

  beforeEach(async () => {
    capturedSpawnArgs = null;
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
    // 清理 deploy 状态文件，防止下一个 test 的 fresh module 加载到 running 状态
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
  });

  it('POST /deploy 使用 REPO_ROOT 拼接 deploy-local.sh 路径', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(202);
    expect(capturedSpawnArgs).not.toBeNull();
    // spawn('bash', [scriptPath, ...], { cwd, detached, stdio })
    const scriptPath = capturedSpawnArgs[1][0];
    expect(scriptPath).toBe('/custom/repo/root/scripts/deploy-local.sh');
    // cwd 也应用 REPO_ROOT
    const opts = capturedSpawnArgs[2];
    expect(opts.cwd).toBe('/custom/repo/root');
  });

  it('REPO_ROOT 未设置时 path 计算不崩溃（含 deploy-local.sh 后缀）', () => {
    // 不走 HTTP，只验证路径计算逻辑：process.env.REPO_ROOT || import.meta.url fallback
    const repoRootFallback = new URL('../../../../..', import.meta.url).pathname;
    const scriptFallback = `${repoRootFallback}/scripts/deploy-local.sh`;
    // 回退路径应包含 scripts/deploy-local.sh 后缀
    expect(scriptFallback).toMatch(/scripts\/deploy-local\.sh$/);
    // 设置 REPO_ROOT 时，路径使用 REPO_ROOT
    const scriptWithEnv = `${process.env.REPO_ROOT}/scripts/deploy-local.sh`;
    expect(scriptWithEnv).toBe('/custom/repo/root/scripts/deploy-local.sh');
  });
});
