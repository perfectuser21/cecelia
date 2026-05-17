/**
 * deploy-rollback.test.js
 * 验证 Brain deploy/rollback 端点的鉴权与参数校验：
 * - 401（无 token 或 token 错误）
 * - 400（缺 stable_sha）
 * - 400（非法 SHA 格式，如路径穿越字符串）
 * - 202（合法 SHA 触发回滚成功）
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

  it('400 — 缺少 stable_sha', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send({ reason: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stable_sha/);
  });

  it('400 — 非法 SHA 格式（路径穿越字符串）', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send({ stable_sha: '../../etc/passwd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stable_sha/);
  });

  it('400 — 非法 SHA 格式（含大写字母）', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send({ stable_sha: 'ABCDEF1234567' });
    expect(res.status).toBe(400);
  });

  it('400 — SHA 过短（少于 7 位）', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send({ stable_sha: 'abc12' });
    expect(res.status).toBe(400);
  });

  it('202 — 合法 7 位短 SHA 触发回滚成功', async () => {
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send({ stable_sha: 'abc1234', reason: 'deploy_failed_in_ci' });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.message).toContain('abc1234');
  });

  it('202 — 合法 40 位完整 SHA 触发回滚成功', async () => {
    const fullSha = 'a'.repeat(40);
    const res = await request(app)
      .post('/api/brain/deploy/rollback')
      .set('Authorization', 'Bearer test-secret-token')
      .send({ stable_sha: fullSha });
    expect(res.status).toBe(202);
    expect(res.body.message).toContain(fullSha);
  });
});
