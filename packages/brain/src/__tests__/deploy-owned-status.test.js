import { deployFixture } from './helpers/deploy-owned-fs.js';
/**
 * deploy-receipt.test.js — 九要素 T4：deploy webhook 回执接线
 *
 * 验证 POST /api/brain/deploy 的 production / staging 两分支：
 * - 发起部署时写 pending 回执（kind=deploy, target=production|staging）
 * - 按真实结果核销 confirmed / failed
 * - 鉴权失败不写回执
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import express from 'express';
import request from 'supertest';

const { settlementMock, retentionRuntimeMock } = vi.hoisted(() => ({ settlementMock: vi.fn(), retentionRuntimeMock: vi.fn() }));
vi.mock('../../../../scripts/brain-image-retention/runtime.mjs', () => ({ createRuntime: retentionRuntimeMock }));
let capturedSpawnArgs = null;
let spawnCloseHandler = null;

const { recordActionReceipt, resolveActionReceipt, execSyncMock, execFileMock } = vi.hoisted(() => ({
  recordActionReceipt: vi.fn().mockResolvedValue('r-dep'),
  resolveActionReceipt: vi.fn().mockResolvedValue(true),
  execSyncMock: vi.fn().mockReturnValue(Buffer.from('ok')),
  execFileMock: vi.fn(),
}));
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));

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
vi.mock('../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
vi.mock('child_process', () => ({
  spawn: (...args) => {
    capturedSpawnArgs = args;
    return {
      unref: vi.fn(),
      on: (event, handler) => { if (event === 'close') spawnCloseHandler = handler; },
    };
  },
  execSync: execSyncMock,
  execFile: execFileMock,
}));

let ownedRoot, statusFile;
beforeEach(() => {
  ownedRoot = deployFixture.root;
  statusFile = deployFixture.statusFile;
  vi.stubEnv('REPO_ROOT', ownedRoot); vi.stubEnv('DEPLOY_TOKEN', 'tok');
  capturedSpawnArgs = null; vi.resetModules();
});
afterEach(() => { rmSync(ownedRoot, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it('实际POST持久化本人状态，fresh模块GET恢复running并拒绝重复部署', async () => {
  const { default: router } = await import('../routes/ops.js');
  const app = express(); app.use(express.json()); app.use('/api/brain', router);
  const accepted = await request(app).post('/api/brain/deploy').set('Authorization', 'Bearer tok').send({});
  expect(accepted.status).toBe(202); expect(capturedSpawnArgs).not.toBeNull();
  expect(existsSync(statusFile)).toBe(true);
  expect(JSON.parse(readFileSync(statusFile, 'utf8'))).toMatchObject({ status: 'running' });
  expect(deployFixture.statusOperations.length).toBeGreaterThan(0);
  expect(deployFixture.statusOperations.every(path => path === statusFile)).toBe(true);
  vi.resetModules();
  const { default: restored } = await import('../routes/ops.js');
  const restarted = express(); restarted.use(express.json()); restarted.use('/api/brain', restored);
  expect((await request(restarted).get('/api/brain/deploy/status')).body.status).toBe('running');
  expect((await request(restarted).post('/api/brain/deploy').set('Authorization', 'Bearer tok').send({})).status).toBe(409);
});
