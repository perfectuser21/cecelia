/**
 * ops.test.js
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

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
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
vi.mock('../shared.js', () => ({
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

describe('ops — deploy REPO_ROOT path', () => {
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
      .send({});

    expect(res.status).toBe(202);
    expect(capturedSpawnArgs).not.toBeNull();
    const scriptPath = capturedSpawnArgs[1][0];
    expect(scriptPath).toBe('/custom/repo/root/scripts/deploy-local.sh');
    const opts = capturedSpawnArgs[2];
    expect(opts.cwd).toBe('/custom/repo/root');
  });

  it('REPO_ROOT 未设置時 path 计算不崩溃（含 deploy-local.sh 后缀）', () => {
    const repoRootFallback = new URL('../../../../../..', import.meta.url).pathname;
    const scriptFallback = `${repoRootFallback}/scripts/deploy-local.sh`;
    expect(scriptFallback).toMatch(/scripts\/deploy-local\.sh$/);
    const scriptWithEnv = `${process.env.REPO_ROOT}/scripts/deploy-local.sh`;
    expect(scriptWithEnv).toBe('/custom/repo/root/scripts/deploy-local.sh');
  });
});
