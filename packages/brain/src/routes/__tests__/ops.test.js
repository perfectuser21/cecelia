import { deployFixture } from '../../__tests__/helpers/deploy-owned-fs.js';
/**
 * ops.test.js
 * 验证 deploy webhook 使用 REPO_ROOT 环境变量而非 import.meta.url 推算路径。
 * 当 REPO_ROOT=/custom/repo/root，spawn 第二个参数 args[0] 应为
 * /custom/repo/root/scripts/deploy-local.sh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import request from 'supertest';

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
    vi.stubEnv('DEPLOY_TOKEN', 'test-token');
    process.env.REPO_ROOT = deployFixture.root;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_REPO_ROOT === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = ORIG_REPO_ROOT;
    }
    try { unlinkSync(deployFixture.statusFile); } catch {}
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
    expect(scriptPath).toBe(`${deployFixture.root}/scripts/deploy-local.sh`);
    const opts = capturedSpawnArgs[2];
    expect(opts.cwd).toBe(deployFixture.root);
  });

  it('REPO_ROOT 未设置时真实 handler 使用仓库脚本与 cwd', async () => {
    delete process.env.REPO_ROOT;
    const mod=await import('../ops.js');
    const app=express();app.use(express.json());app.use('/api/brain',mod.default);
    const res=await request(app).post('/api/brain/deploy').set('Authorization','Bearer test-token').send({});
    expect(res.status).toBe(202);
    expect(capturedSpawnArgs).not.toBeNull();
    expect(resolve(capturedSpawnArgs[1][0])).toBe(fileURLToPath(new URL('../../../../../scripts/deploy-local.sh',import.meta.url)));
    expect(resolve(capturedSpawnArgs[2].cwd)).toBe(resolve(fileURLToPath(new URL('../../../../..',import.meta.url))));
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

vi.mock('../../receipt-collector.js', () => ({ recordActionReceipt: vi.fn(async () => 'owned-receipt'), resolveActionReceipt: vi.fn(async () => true) }));
vi.mock('../../../../../scripts/brain-image-retention/runtime.mjs', () => ({ createRuntime: vi.fn(async () => null) }));
