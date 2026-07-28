/**
 * deploy-status.test.js
 * 验证 Brain deploy webhook 的状态追踪机制：
 * - deployState 初始为 idle
 * - GET /deploy/status 返回正确结构
 * - 状态字段包含 idle/running/success/failed 四态
 */

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import express from 'express';
import request from 'supertest';
import { unlinkSync, writeFileSync } from 'node:fs';

const { appendDispatchOutcome, claimReleaseEffect } = vi.hoisted(() => ({
  appendDispatchOutcome: vi.fn().mockResolvedValue(true),
  claimReleaseEffect: vi.fn(),
}));

// Mock ops.js 的所有重依赖，确保测试轻量
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../orchestrator/release-run-authorization.js', () => ({
  authorizeReleaseEffect: vi.fn(),
  appendDispatchOutcome,
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
  launchProductionController: vi.fn(async () => ({ name: 'controller' })),
  launchRollbackController: vi.fn(async () => ({ name: 'rollback-controller' })),
  resolveRollbackControllerRuntime: vi.fn(() => ({
    image: `sha256:${'b'.repeat(64)}`,
    network: 'test',
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
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn((_command, _args, _options, callback) => {
    callback(null, '', '');
  }),
  execSync: vi.fn(),
}));

describe('deploy-status', () => {
  const deployStatusFile = '/tmp/cecelia-release-deploy-status-test.json';
  const originalDeployStatusFile = process.env.DEPLOY_STATUS_FILE;
  const authority = {
    release_run_id: '44444444-4444-4444-8444-444444444444',
    merge_sha: 'f'.repeat(40),
    release_authorization: '55555555-5555-4555-8555-555555555555',
  };
  let app;
  let deployState;
  let stagingDeployState;

  beforeEach(async () => {
    // 设置 DEPLOY_TOKEN 使 POST /deploy 能通过 token 校验
    process.env.DEPLOY_TOKEN = 'test-token';
    process.env.DEPLOY_STATUS_FILE = deployStatusFile;
    try { unlinkSync(deployStatusFile); } catch { /* absent */ }
    claimReleaseEffect.mockClear();
    appendDispatchOutcome.mockClear();
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
    const mod = await import('../routes/ops.js');
    deployState = mod.deployState;
    stagingDeployState = mod.stagingDeployState;
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  afterAll(() => {
    try { unlinkSync(deployStatusFile); } catch { /* absent */ }
    if (originalDeployStatusFile == null) delete process.env.DEPLOY_STATUS_FILE;
    else process.env.DEPLOY_STATUS_FILE = originalDeployStatusFile;
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
    claimReleaseEffect.mockRejectedValueOnce(Object.assign(
      new Error('release_effect_claim_unavailable'),
      { code: 'release_effect_claim_unavailable' },
    ));

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({ ...authority, changed_paths: ['packages/brain/'] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Deploy already in progress');
    expect(res.body.current_status).toBe('running');
    expect(res.body.started_at).toBeDefined();
    expect(claimReleaseEffect).toHaveBeenCalledOnce();
  });

  it('POST /api/brain/deploy 在 rolling_back 时也返回 409', async () => {
    deployState.status = 'rolling_back';
    deployState.started_at = new Date().toISOString();
    claimReleaseEffect.mockRejectedValueOnce(Object.assign(
      new Error('release_effect_claim_unavailable'),
      { code: 'release_effect_claim_unavailable' },
    ));

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Deploy already in progress');
    expect(res.body.current_status).toBe('rolling_back');
    expect(claimReleaseEffect).toHaveBeenCalledOnce();
  });

  it('POST deploy lets the durable claim dedupe override stale memory status', async () => {
    deployState.status = 'running';
    deployState.started_at = new Date().toISOString();
    writeFileSync(deployStatusFile, JSON.stringify({
      status: 'success',
      finished_at: new Date().toISOString(),
    }));
    claimReleaseEffect.mockResolvedValueOnce({
      claimed: false,
      deduped: true,
      dispatch_claim_id: 91,
      generation: 1,
      artifact_versions: [{
        name: 'brain',
        version: '1.268.15',
        digest: `sha256:${'a'.repeat(64)}`,
      }],
    });

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);

    expect(res.status).toBe(202);
    expect(claimReleaseEffect).toHaveBeenCalledOnce();
  });

  it('recovers generation two despite a stale durable running status', async () => {
    deployState.status = 'running';
    deployState.started_at = new Date(Date.now() - 60 * 60_000).toISOString();
    writeFileSync(deployStatusFile, JSON.stringify({
      status: 'running',
      release_run_id: authority.release_run_id,
      merge_sha: authority.merge_sha,
      dispatch_claim_id: 91,
      dispatch_generation: 1,
      started_at: deployState.started_at,
    }));
    claimReleaseEffect.mockResolvedValueOnce({
      claimed: true,
      deduped: false,
      dispatch_claim_id: 92,
      generation: 2,
      artifact_versions: [{
        name: 'brain',
        version: '1.268.15',
        digest: `sha256:${'a'.repeat(64)}`,
      }],
    });

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);

    expect(res.status).toBe(202);
    expect(claimReleaseEffect).toHaveBeenCalledOnce();
    expect(appendDispatchOutcome).not.toHaveBeenCalled();
  });

  it('lets a new durable staging generation replace stale in-memory running state', async () => {
    stagingDeployState.status = 'running';
    stagingDeployState.started_at =
      new Date(Date.now() - 60 * 60_000).toISOString();
    claimReleaseEffect.mockResolvedValueOnce({
      claimed: true,
      deduped: false,
      dispatch_claim_id: 93,
      generation: 2,
      artifact_versions: [{
        name: 'brain',
        version: '1.268.15',
        digest: `sha256:${'a'.repeat(64)}`,
      }],
    });

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({ ...authority, staging: true });

    expect(res.status).toBe(202);
    expect(claimReleaseEffect).toHaveBeenCalledOnce();
  });
});
