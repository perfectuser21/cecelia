/**
 * deploy-webhook-log.test.js
 * 验证 deploy webhook 把 typed ReleaseRun worker stdout/stderr 落盘到日志文件，
 * 状态文件加 log_path 字段供运维追踪失败原因。
 *
 * 旧版 stdio:'ignore' 会丢掉 worker error，状态只有泛化失败码。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, unlinkSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

let capturedSpawnArgs = null;
const { claimReleaseEffect, recordActionReceipt, resolveActionReceipt } = vi.hoisted(() => ({
  claimReleaseEffect: vi.fn(),
  recordActionReceipt: vi.fn().mockResolvedValue('r-dep'),
  resolveActionReceipt: vi.fn().mockResolvedValue(true),
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
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
  spawn: (...args) => {
    capturedSpawnArgs = args;
    return { unref: vi.fn(), on: vi.fn() };
  },
  execFile: vi.fn(),
}));

async function waitForProductionWorker(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (capturedSpawnArgs === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('deploy-webhook-log (v1.1.0 log 落盘)', () => {
  const authority = {
    release_run_id: '44444444-4444-4444-8444-444444444444',
    merge_sha: 'f'.repeat(40),
    release_authorization: '55555555-5555-4555-8555-555555555555',
  };
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;
  let tmpRepoRoot;

  beforeEach(async () => {
    capturedSpawnArgs = null;
    process.env.DEPLOY_TOKEN = 'test-token';
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
    // 用真实可写的临时目录，确保 logs/ 子目录能被创建，logFd 得到真实 fd 而非 'ignore'
    tmpRepoRoot = mkdtempSync(join(tmpdir(), 'deploy-test-'));
    process.env.REPO_ROOT = tmpRepoRoot;
    // 关键：测试前清掉残留 status 文件，否则 module 启动时读到 running 状态 → 409
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_REPO_ROOT === undefined) {
      delete process.env.REPO_ROOT;
    } else {
      process.env.REPO_ROOT = ORIG_REPO_ROOT;
    }
    try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}
    try { rmSync(tmpRepoRoot, { recursive: true, force: true }); } catch {}
  });

  it('spawn stdio 不再用 "ignore"，改为数组 [ignore, fd, fd] 让 stdout/stderr 落盘', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);

    expect(res.status).toBe(202);
    await waitForProductionWorker();
    expect(capturedSpawnArgs).not.toBeNull();

    const opts = capturedSpawnArgs[2];
    // 关键断言：stdio 不再是 'ignore' 字符串
    expect(opts.stdio).not.toBe('ignore');
    // 应该是数组形式 [stdin, stdout, stderr]
    expect(Array.isArray(opts.stdio)).toBe(true);
    expect(opts.stdio.length).toBe(3);
    // stdin 仍 ignore，stdout/stderr 是 file descriptor (number) 落盘
    expect(opts.stdio[0]).toBe('ignore');
    expect(typeof opts.stdio[1]).toBe('number');
    expect(typeof opts.stdio[2]).toBe('number');
  });

  it('内部 deploy 状态保留 log_path，但公共状态端点不泄露主机路径', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);
    await waitForProductionWorker();

    expect(mod.deployState.log_path).toMatch(/cecelia-deploy-.*\.log$/);

    // 主机绝对路径只用于内部运维，不进入公共状态响应。
    const statusRes = await request(app).get('/api/brain/deploy/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).not.toHaveProperty('log_path');
  });

  it('log 文件被创建并写入了启动 metadata（cmd / cwd）', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send(authority);
    await waitForProductionWorker();

    const logPath = mod.deployState.log_path;
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf-8');
    // log 应该含启动 metadata，让运维知道这是哪次 deploy 的输出
    expect(content).toMatch(/\[deploy-webhook\] starting at/);
    expect(content).toMatch(/\[deploy-webhook\] worker: .*release-run-effect-worker\.mjs/);
    expect(content).toMatch(/\[deploy-webhook\] routes: brain/);
    // cwd 动态指向 tmpRepoRoot（即 process.env.REPO_ROOT）
    expect(content).toMatch(new RegExp(`\\[deploy-webhook\\] cwd: ${tmpRepoRoot.replace(/[/\\]/g, '[/\\\\]')}`));

    // 日志文件在 afterEach 清理 tmpRepoRoot 时一起删除
  });
});
