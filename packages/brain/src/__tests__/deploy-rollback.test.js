/**
 * deploy-rollback.test.js
 * 验证 legacy Brain deploy/rollback 端点已 fail closed：
 * - 401（无 token 或 token 错误）
 * - 409（token 不能替代 durable rollback authority）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock ops.js 的所有重依赖，确保测试轻量
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
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
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
vi.mock('child_process', () => ({ exec: vi.fn(), execSync: vi.fn() }));

describe('deploy-rollback', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_TOKEN', 'test-secret-token');
    const mod = await import('../routes/ops.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  it('401 — 无 Authorization header', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .send({ stable_sha: 'abc1234' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('401 — token 错误', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer wrong-token')
      .send({ stable_sha: 'abc1234' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it.each([
    {},
    { stable_sha: '../../etc/passwd' },
    { stable_sha: 'ABCDEF1234567' },
    { stable_sha: 'abc12' },
    { stable_sha: 'abc1234', reason: 'deploy_failed_in_ci' },
    { stable_sha: 'a'.repeat(40) },
  ])('409 — token-only rollback never mutates production (%j)', async (body) => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('release_rollback_authority_required');
  });
});
