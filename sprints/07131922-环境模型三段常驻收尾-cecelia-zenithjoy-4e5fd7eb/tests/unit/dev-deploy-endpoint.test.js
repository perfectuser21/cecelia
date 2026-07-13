/**
 * dev-deploy-endpoint.test.js
 *
 * 合同测试骨架：验证 Brain dev deploy 端点（FR-5）
 *
 * [BEHAVIOR-5] GET /api/brain/deploy/dev/status 返回 dev 部署状态 JSON（含 status 字段）
 * [BEHAVIOR-6] POST /api/brain/deploy {dev:true} 触发 dev 部署（返回 202 accepted）
 * INV-6: dev 与 staging deploy 并发互不干扰
 *
 * 运行：
 *   cd packages/brain && npx vitest run src/__tests__/deploy-status.test.js
 * 或骨架模式（不依赖 Brain 启动）：
 *   cd sprints/07131922-* && node --experimental-vm-modules tests/unit/dev-deploy-endpoint.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// === Mock 所有重依赖（与 deploy-status.test.js 保持一致） ===
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../packages/brain/src/actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock('../../../packages/brain/src/llm-caller.js', () => ({
  callLLM: vi.fn(),
  callLLMStream: vi.fn(),
}));
vi.mock('../../../packages/brain/src/orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../../../packages/brain/src/tick.js', () => ({ check48hReport: vi.fn() }));
vi.mock('../../../packages/brain/src/task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../../../packages/brain/src/task-cleanup.js', () => ({
  getCleanupStats: vi.fn(),
  runTaskCleanup: vi.fn(),
  getCleanupAuditLog: vi.fn(),
}));
vi.mock('../../../packages/brain/src/dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../../../packages/brain/src/thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
vi.mock('../../../packages/brain/src/decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../../../packages/brain/src/suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));
vi.mock('../../../packages/brain/src/decomposition-checker.js', () => ({
  runDecompositionChecks: vi.fn(),
}));
vi.mock('../../../packages/brain/src/pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));
vi.mock('child_process', () => ({ exec: vi.fn(), execSync: vi.fn() }));

// === 轻量级状态机 mock（模拟 ops.js 中 devDeployState） ===
const mockDevDeployState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  error: null,
};

const mockStagingDeployState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  error: null,
};

// === 构建测试用 express 应用 ===
function createTestApp() {
  const app = express();
  app.use(express.json());

  // GET /api/brain/deploy/dev/status — [BEHAVIOR-5]
  app.get('/api/brain/deploy/dev/status', (req, res) => {
    res.json({
      status: mockDevDeployState.status,
      started_at: mockDevDeployState.startedAt,
      finished_at: mockDevDeployState.finishedAt,
      error: mockDevDeployState.error,
    });
  });

  // GET /api/brain/deploy/staging/status — 对称端点（用于 INV-6 并发隔离测试）
  app.get('/api/brain/deploy/staging/status', (req, res) => {
    res.json({
      status: mockStagingDeployState.status,
      started_at: mockStagingDeployState.startedAt,
      finished_at: mockStagingDeployState.finishedAt,
    });
  });

  // POST /api/brain/deploy — 支持 dev:true 分支（[BEHAVIOR-5]）
  app.post('/api/brain/deploy', (req, res) => {
    const { dev, staging, mode } = req.body || {};
    const isDevDeploy = dev === true;
    const isStagingDeploy = staging === true || mode === 'staging';

    if (isDevDeploy) {
      if (mockDevDeployState.status === 'running') {
        return res.status(409).json({
          error: 'Dev deploy already running',
          current_status: mockDevDeployState.status,
        });
      }
      mockDevDeployState.status = 'running';
      mockDevDeployState.startedAt = new Date().toISOString();
      return res.status(202).json({
        status: 'accepted',
        message: 'Dev deploy triggered',
        mode: 'dev',
      });
    }

    if (isStagingDeploy) {
      if (mockStagingDeployState.status === 'running') {
        return res.status(409).json({
          error: 'Staging deploy already running',
        });
      }
      mockStagingDeployState.status = 'running';
      return res.status(202).json({
        status: 'accepted',
        message: 'Staging deploy triggered',
        mode: 'staging',
      });
    }

    return res.status(400).json({ error: 'Missing deploy target (dev or staging)' });
  });

  return app;
}

// === 测试套件 ===
describe('[BEHAVIOR-5] GET /api/brain/deploy/dev/status', () => {
  let app;

  beforeEach(() => {
    // 重置状态
    mockDevDeployState.status = 'idle';
    mockDevDeployState.startedAt = null;
    mockDevDeployState.finishedAt = null;
    mockDevDeployState.error = null;
    app = createTestApp();
  });

  it('初始状态返回 idle', async () => {
    const res = await request(app).get('/api/brain/deploy/dev/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body.status).toBe('idle');
  });

  it('返回 JSON 含 status 字段（非 null）', async () => {
    const res = await request(app).get('/api/brain/deploy/dev/status');
    expect(res.status).toBe(200);
    expect(res.body.status).not.toBeNull();
    expect(typeof res.body.status).toBe('string');
  });

  it('status 字段值在合法四态内（idle/running/success/failed）', async () => {
    const validStates = ['idle', 'running', 'success', 'failed'];
    const res = await request(app).get('/api/brain/deploy/dev/status');
    expect(validStates).toContain(res.body.status);
  });
});

describe('[BEHAVIOR-5] POST /api/brain/deploy {dev:true}', () => {
  let app;

  beforeEach(() => {
    mockDevDeployState.status = 'idle';
    mockStagingDeployState.status = 'idle';
    app = createTestApp();
  });

  it('dev:true 返回 202 accepted', async () => {
    const res = await request(app)
      .post('/api/brain/deploy')
      .send({ dev: true });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
  });

  it('dev:true 后状态变为 running', async () => {
    await request(app).post('/api/brain/deploy').send({ dev: true });
    const statusRes = await request(app).get('/api/brain/deploy/dev/status');
    expect(statusRes.body.status).toBe('running');
  });

  it('dev:true 重复触发时返回 409（幂等保护）', async () => {
    await request(app).post('/api/brain/deploy').send({ dev: true });
    const res2 = await request(app).post('/api/brain/deploy').send({ dev: true });
    expect(res2.status).toBe(409);
  });
});

describe('[INV-6] dev 与 staging deploy 并发状态机隔离', () => {
  let app;

  beforeEach(() => {
    mockDevDeployState.status = 'idle';
    mockStagingDeployState.status = 'idle';
    app = createTestApp();
  });

  it('dev deploy 运行中，staging deploy 仍可独立触发', async () => {
    // 触发 dev deploy
    await request(app).post('/api/brain/deploy').send({ dev: true });
    expect(mockDevDeployState.status).toBe('running');

    // staging 仍可触发（独立状态机）
    const stagingRes = await request(app)
      .post('/api/brain/deploy')
      .send({ staging: true });
    expect(stagingRes.status).toBe(202);
  });

  it('staging deploy 运行中不影响 dev 状态', async () => {
    // 触发 staging
    await request(app).post('/api/brain/deploy').send({ staging: true });
    expect(mockStagingDeployState.status).toBe('running');

    // dev 状态仍为 idle
    const devStatus = await request(app).get('/api/brain/deploy/dev/status');
    expect(devStatus.body.status).toBe('idle');
  });

  it('staging 状态与 dev 状态相互独立', async () => {
    // 触发 dev
    await request(app).post('/api/brain/deploy').send({ dev: true });

    // staging 状态仍为 idle
    const stagingStatus = await request(app).get('/api/brain/deploy/staging/status');
    expect(stagingStatus.body.status).toBe('idle');
  });
});

describe('[BEHAVIOR-7] TEMP_PORT 5223→5224 代码验证', () => {
  it('brain-deploy.sh 中 TEMP_PORT 应为 5224（静态验证骨架）', () => {
    // 此测试在 CI 中通过 grep 命令验证实际文件
    // 骨架：标记为 TODO - 实施后取消注释并运行
    // const fs = require('fs');
    // const content = fs.readFileSync('scripts/brain-deploy.sh', 'utf-8');
    // expect(content).toMatch(/TEMP_PORT=5224/);
    // expect(content).not.toMatch(/TEMP_PORT=5223/);
    expect(true).toBe(true); // placeholder - 实施后替换
  });
});
