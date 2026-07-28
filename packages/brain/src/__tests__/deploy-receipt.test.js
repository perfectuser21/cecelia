/**
 * deploy-receipt.test.js — 九要素 T4：deploy webhook 回执接线
 *
 * 验证 POST /api/brain/deploy 的 production / staging 两分支：
 * - 发起部署时写 pending 回执（kind=deploy, target=production|staging）
 * - 按真实结果核销 confirmed / failed
 * - 鉴权失败不写回执
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, unlinkSync, rmSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const {
  recordActionReceipt,
  resolveActionReceipt,
  execFileMock,
  claimReleaseEffect,
  launchProductionController,
} = vi.hoisted(() => ({
  recordActionReceipt: vi.fn().mockResolvedValue('r-dep'),
  resolveActionReceipt: vi.fn().mockResolvedValue(true),
  execFileMock: vi.fn((_file, _args, _options, callback) => callback(null, { stdout: 'ok', stderr: '' })),
  claimReleaseEffect: vi.fn(),
  launchProductionController: vi.fn().mockResolvedValue({ name: 'controller' }),
}));
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));
vi.mock('../orchestrator/release-run-authorization.js', () => ({
  authorizeReleaseEffect: vi.fn(),
  appendDispatchOutcome: vi.fn().mockResolvedValue(true),
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
  launchProductionController,
  launchRollbackController: vi.fn(),
  resolveRollbackControllerRuntime: vi.fn(() => ({
    image: `sha256:${'a'.repeat(64)}`,
    network: 'fixture',
  })),
}));

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
  spawn: vi.fn(),
  execFile: (...args) => execFileMock(...args),
}));

describe('deploy webhook 回执接线（T4）', () => {
  const authority = {
    release_run_id: '44444444-4444-4444-8444-444444444444',
    merge_sha: 'f'.repeat(40),
    release_authorization: '55555555-5555-4555-8555-555555555555',
  };
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;
  let app;
  let tmpRepoRoot;

  beforeEach(async () => {
    vi.clearAllMocks();
    recordActionReceipt.mockResolvedValue('r-dep');
    resolveActionReceipt.mockResolvedValue(true);
    execFileMock.mockImplementation(
      (_file, _args, _options, callback) => callback(null, { stdout: 'ok', stderr: '' }),
    );
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
    launchProductionController.mockResolvedValue({ name: 'controller' });
    process.env.DEPLOY_TOKEN = 'tok';
    // 用临时目录做 REPO_ROOT，避免 production 分支在真实仓库里落 log 文件
    tmpRepoRoot = mkdtempSync(join(tmpdir(), 'deploy-receipt-test-'));
    process.env.REPO_ROOT = tmpRepoRoot;
    // 清掉残留状态文件，否则模块启动读到 running → 409
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch { /* noop */ }
    vi.resetModules();
    const { default: opsRouter } = await import('../routes/ops.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', opsRouter);
  });

  afterEach(() => {
    delete process.env.DEPLOY_TOKEN;
    if (tmpRepoRoot) {
      try { rmSync(tmpRepoRoot, { recursive: true, force: true }); } catch { /* noop */ }
      tmpRepoRoot = null;
    }
    if (ORIG_REPO_ROOT === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = ORIG_REPO_ROOT;
    }
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch { /* noop */ }
  });

  it('production deploy writes pending and delegates exact receipt identity to the durable controller', async () => {
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ ...authority, changed_paths: ['packages/brain/src/x.js'] });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'production' })
    );
    expect(launchProductionController).toHaveBeenCalledWith(
      expect.objectContaining({
        workerEnvironment: expect.objectContaining({
          KERNEL_RELEASE_ACTION_RECEIPT_ID: 'r-dep',
        }),
      }),
    );
    expect(resolveActionReceipt).not.toHaveBeenCalled();
  });

  it('production controller launch failure immediately核销 failed', async () => {
    launchProductionController.mockRejectedValueOnce(new Error('launch failed'));
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send(authority);
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'failed', expect.objectContaining({ error: 'launch failed' })
    );
  });

  it('鉴权失败 → 不写回执', async () => {
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer wrong')
      .send({});
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 20));
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('staging deploy 成功 → record(deploy/staging) + confirmed', async () => {
    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ ...authority, mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'staging' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-dep', 'confirmed', expect.anything());
  });

  it('staging worker 失败 → 核销 failed（含稳定 error_code）', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(new Error('boom')));
    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ ...authority, mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'staging' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'failed', expect.objectContaining({ error_code: 'staging_dispatch_failed' })
    );
  });

  it('staging 输出 STAGING_SKIP_REASON=no_docker → failed 且 evidence 含 skip_reason', async () => {
    execFileMock.mockImplementation(
      (_file, _args, _options, callback) => callback(
        null,
        { stdout: 'STAGING_SKIP_REASON=no_docker\n', stderr: '' },
      ),
    );
    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ ...authority, mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'failed', expect.objectContaining({ skip_reason: 'no_docker' })
    );
  });
});
