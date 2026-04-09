/**
 * Deploy / Rollback Flow 集成测试
 *
 * 覆盖 deploy 链路的 API 合约验证：
 *
 * 1. GET /api/brain/deploy/status — 初始状态为 idle，字段结构正确
 * 2. POST /api/brain/deploy — 缺少 DEPLOY_TOKEN 或 token 不匹配时拒绝
 * 3. POST /api/brain/deploy/rollback — stable_sha 格式校验（缺失/非法/合法）
 * 4. GET /api/brain/deploy/staging/status — staging 状态端点可访问
 *
 * 不进行真实部署（mock child_process.exec/execSync），只测 API 合约和 in-memory 状态机。
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync } from 'fs';
import express from 'express';
import request from 'supertest';

// ─── Mock 外部依赖 ────────────────────────────────────────────────────────────

vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({ loop_running: true, enabled: true }),
  startTick: vi.fn(),
  stopTick: vi.fn(),
  check48hReport: vi.fn(),
}));

vi.mock('../../circuit-breaker.js', () => ({
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  reset: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

vi.mock('../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue('normal'),
  setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(),
  ALERTNESS_LEVELS: { NORMAL: 'normal', ELEVATED: 'elevated', HIGH: 'high' },
  LEVEL_NAMES: { normal: 'Normal', elevated: 'Elevated', high: 'High' },
}));

vi.mock('../../dispatch-stats.js', () => ({
  getDispatchStats: vi.fn().mockReturnValue({ total: 0, success: 0, fail: 0 }),
}));

vi.mock('../../task-cleanup.js', () => ({
  getCleanupStats: vi.fn().mockReturnValue({ cleaned: 0 }),
  runTaskCleanup: vi.fn().mockResolvedValue({ cleaned: 0 }),
  getCleanupAuditLog: vi.fn().mockReturnValue([]),
}));

vi.mock('../../proposal.js', () => ({
  createProposal: vi.fn(),
  approveProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  listProposals: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../domain-detector.js', () => ({
  detectDomain: vi.fn(() => ({ domain: 'agent_ops' })),
}));

vi.mock('../../quarantine.js', () => ({
  classifyFailure: vi.fn(() => 'unknown'),
  FAILURE_CLASS: {
    NETWORK: 'network',
    RATE_LIMIT: 'rate_limit',
    BILLING_CAP: 'billing_cap',
    AUTH: 'auth',
    RESOURCE: 'resource',
  },
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

vi.mock('../../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../../orchestrator-chat.js', () => ({
  handleChat: vi.fn(),
}));

vi.mock('../../task-weight.js', () => ({
  getTaskWeights: vi.fn(),
}));

vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));

vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

vi.mock('../../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));

vi.mock('../../decomposition-checker.js', () => ({
  runDecompositionChecks: vi.fn(),
}));

vi.mock('../../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));

vi.mock('../../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));

// child_process mock — 阻止真实脚本执行
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd, _opts, cb) => { if (cb) cb(null, '', ''); }),
  execSync: vi.fn(() => ''),
}));

vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn(),
  callLLMStream: vi.fn(),
}));

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());
  const opsRouter = await import('../../routes/ops.js').then(m => m.default);
  app.use('/api/brain', opsRouter);
  return app;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('Deploy / Rollback Flow — API 合约测试（in-memory 状态机，无真实部署）', () => {
  let app;

  beforeAll(async () => {
    // 清除 deploy 状态文件，防止 Brain 持久化状态污染测试初始值
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
    app = await makeApp();
  }, 20000);

  // ── Path 1: GET /api/brain/deploy/status — 初始状态查询 ──────────────────

  describe('GET /api/brain/deploy/status — 状态查询', () => {
    it('端点存在，返回 200 + status 字段', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/status')
        .expect(200);

      expect(res.body).toHaveProperty('status');
    });

    it('包含完整字段结构：status / version / started_at / finished_at / elapsed_ms / error', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/status')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('started_at');
      expect(res.body).toHaveProperty('finished_at');
      expect(res.body).toHaveProperty('elapsed_ms');
      expect(res.body).toHaveProperty('error');
    });

    it('初始状态为 idle（测试环境无正在进行的部署）', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/status')
        .expect(200);

      // in-memory 状态：进程启动后重置为 idle
      expect(res.body.status).toBe('idle');
      expect(res.body.version).toBeNull();
      expect(res.body.error).toBeNull();
    });
  });

  // ── Path 2: POST /api/brain/deploy — 认证校验 ────────────────────────────

  describe('POST /api/brain/deploy — 认证校验', () => {
    it('缺少 DEPLOY_TOKEN 环境变量时返回 500', async () => {
      const savedToken = process.env.DEPLOY_TOKEN;
      delete process.env.DEPLOY_TOKEN;

      try {
        const res = await request(app)
          .post('/api/brain/deploy')
          .set('Authorization', 'Bearer some-token')
          .send({})
          .expect(500);

        expect(res.body.error).toContain('DEPLOY_TOKEN');
      } finally {
        if (savedToken !== undefined) {
          process.env.DEPLOY_TOKEN = savedToken;
        }
      }
    });

    it('Authorization 头不匹配时返回 401', async () => {
      process.env.DEPLOY_TOKEN = 'correct-secret-token';

      try {
        const res = await request(app)
          .post('/api/brain/deploy')
          .set('Authorization', 'Bearer wrong-token')
          .send({})
          .expect(401);

        expect(res.body.error).toBeTruthy();
      } finally {
        delete process.env.DEPLOY_TOKEN;
      }
    });

    it('缺少 Authorization 头时返回 401', async () => {
      process.env.DEPLOY_TOKEN = 'correct-secret-token';

      try {
        const res = await request(app)
          .post('/api/brain/deploy')
          .send({})
          .expect(401);

        expect(res.body.error).toBeTruthy();
      } finally {
        delete process.env.DEPLOY_TOKEN;
      }
    });
  });

  // ── Path 3: POST /api/brain/deploy/rollback — stable_sha 校验 ────────────

  describe('POST /api/brain/deploy/rollback — stable_sha 参数校验', () => {
    beforeAll(() => {
      process.env.DEPLOY_TOKEN = 'test-rollback-token';
    });

    afterAll(() => {
      delete process.env.DEPLOY_TOKEN;
    });

    it('缺少 stable_sha 返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/deploy/rollback')
        .set('Authorization', 'Bearer test-rollback-token')
        .send({ reason: 'smoke test failure' })
        .expect(400);

      expect(res.body.error).toContain('stable_sha');
    });

    it('stable_sha 格式非法（含非十六进制字符）返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/deploy/rollback')
        .set('Authorization', 'Bearer test-rollback-token')
        .send({ stable_sha: 'INVALID_SHA_XYZ', reason: 'test' })
        .expect(400);

      expect(res.body.error).toContain('stable_sha');
    });

    it('stable_sha 过短（< 7 字符）返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/deploy/rollback')
        .set('Authorization', 'Bearer test-rollback-token')
        .send({ stable_sha: 'abc12', reason: 'test' })
        .expect(400);

      expect(res.body.error).toContain('stable_sha');
    });

    it('合法 stable_sha（7 位十六进制）且认证通过时返回 202', async () => {
      const res = await request(app)
        .post('/api/brain/deploy/rollback')
        .set('Authorization', 'Bearer test-rollback-token')
        .send({ stable_sha: 'dc4f493', reason: 'integration test rollback' })
        .expect(202);

      expect(res.body.status).toBe('accepted');
      expect(res.body.message).toContain('dc4f493');
    });

    it('合法 stable_sha（40 位）且认证通过时返回 202', async () => {
      const res = await request(app)
        .post('/api/brain/deploy/rollback')
        .set('Authorization', 'Bearer test-rollback-token')
        .send({ stable_sha: 'dc4f493fe1234567890abcdef1234567890abcde', reason: 'full sha test' })
        .expect(202);

      expect(res.body.status).toBe('accepted');
    });
  });

  // ── Path 4: GET /api/brain/deploy/staging/status — staging 状态端点 ──────

  describe('GET /api/brain/deploy/staging/status — staging 状态查询', () => {
    it('端点存在，返回 200 + status 字段', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/staging/status')
        .expect(200);

      expect(res.body).toHaveProperty('status');
    });

    it('初始 staging 状态为 idle', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/staging/status')
        .expect(200);

      expect(res.body.status).toBe('idle');
    });
  });
});
