/**
 * deploy-status.test.js
 * 验证 Brain deploy webhook 的状态追踪机制：
 * - deployState 初始为 idle
 * - GET /deploy/status 返回正确结构
 * - 状态字段包含 idle/running/success/failed 四态
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

describe('deploy-status', () => {
  let app;
  let deployState;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../routes/ops.js');
    deployState = mod.deployState;
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  it('deployState 初始状态为 idle', () => {
    expect(deployState.status).toBe('idle');
    expect(deployState.version).toBeNull();
    expect(deployState.started_at).toBeNull();
    expect(deployState.finished_at).toBeNull();
    expect(deployState.elapsed_ms).toBeNull();
    expect(deployState.error).toBeNull();
  });

  it('GET /api/brain/deploy/status 返回 200 和状态对象', async () => {
    const res = await request(app).get('/api/brain/deploy/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body.status).toBe('idle');
  });

  it('deployState 包含 running/success/failed 三个有效状态值', () => {
    const validStatuses = ['idle', 'running', 'success', 'failed'];
    // 验证初始 status 在有效集合内
    expect(validStatuses).toContain(deployState.status);

    // 模拟 running 状态
    deployState.status = 'running';
    deployState.started_at = new Date().toISOString();
    expect(validStatuses).toContain(deployState.status);

    // 模拟 success 状态
    deployState.status = 'success';
    deployState.finished_at = new Date().toISOString();
    deployState.elapsed_ms = 5000;
    expect(validStatuses).toContain(deployState.status);

    // 模拟 failed 状态
    deployState.status = 'failed';
    deployState.error = 'script exit 1';
    expect(validStatuses).toContain(deployState.status);
  });

  it('GET /api/brain/deploy/status 在 running 时返回 started_at', async () => {
    const now = new Date().toISOString();
    deployState.status = 'running';
    deployState.started_at = now;

    const res = await request(app).get('/api/brain/deploy/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.started_at).toBe(now);
  });

  it('GET /api/brain/deploy/status 在 failed 时返回 error 字段', async () => {
    deployState.status = 'failed';
    deployState.error = 'docker build failed';
    deployState.finished_at = new Date().toISOString();
    deployState.elapsed_ms = 3000;

    const res = await request(app).get('/api/brain/deploy/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toBe('docker build failed');
    expect(res.body.elapsed_ms).toBe(3000);
  });

  it('POST /api/brain/deploy 在 running 时返回 409（并发互斥保护）', async () => {
    // 模拟已有部署正在进行
    deployState.status = 'running';
    deployState.started_at = new Date().toISOString();

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({ changed_paths: ['packages/brain/'] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Deploy already in progress');
    expect(res.body.current_status).toBe('running');
    expect(res.body.started_at).toBeDefined();
  });

  it('POST /api/brain/deploy 在 rolling_back 时也返回 409', async () => {
    deployState.status = 'rolling_back';
    deployState.started_at = new Date().toISOString();

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Deploy already in progress');
    expect(res.body.current_status).toBe('rolling_back');
  });
});
