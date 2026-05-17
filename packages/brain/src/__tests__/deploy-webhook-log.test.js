/**
 * deploy-webhook-log.test.js
 * 验证 v1.1.0 deploy webhook 把 deploy-local.sh stdout/stderr 落盘到日志文件，
 * 状态文件加 log_path 字段供运维追踪失败原因。
 *
 * 旧版 stdio:'ignore' 会丢掉 npm error，状态只有 "deploy-local.sh exited code=1"。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, readFileSync } from 'fs';
import express from 'express';
import request from 'supertest';

let capturedSpawnArgs = null;

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
  spawn: (...args) => {
    capturedSpawnArgs = args;
    return { unref: vi.fn(), on: vi.fn() };
  },
  execSync: vi.fn(),
}));

describe('deploy-webhook-log (v1.1.0 log 落盘)', () => {
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;

  beforeEach(async () => {
    capturedSpawnArgs = null;
    process.env.DEPLOY_TOKEN = 'test-token';
    process.env.REPO_ROOT = '/custom/repo/root';
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
  });

  it('spawn stdio 不再用 "ignore"，改为数组 [ignore, fd, fd] 让 stdout/stderr 落盘', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(202);
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

  it('deploy 状态文件含 log_path 字段指向 /tmp/cecelia-deploy-*.log', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({});

    // 验证 deploy/status 端点返回 log_path
    const statusRes = await request(app).get('/api/brain/deploy/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toHaveProperty('log_path');
    expect(statusRes.body.log_path).toMatch(/cecelia-deploy-.*\.log$/);
  });

  it('log 文件被创建并写入了启动 metadata（cmd / cwd）', async () => {
    const mod = await import('../routes/ops.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({});

    const statusRes = await request(app).get('/api/brain/deploy/status');
    const logPath = statusRes.body.log_path;
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf-8');
    // log 应该含启动 metadata，让运维知道这是哪次 deploy 的输出
    expect(content).toMatch(/\[deploy-webhook\] starting at/);
    expect(content).toMatch(/\[deploy-webhook\] cmd:.*deploy-local\.sh/);
    expect(content).toMatch(/\[deploy-webhook\] cwd: \/custom\/repo\/root/);

    // 清理测试产生的日志文件
    try { unlinkSync(logPath); } catch {}
  });
});
