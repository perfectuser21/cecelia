/**
 * deploy-receipt.test.js — 九要素 T4：deploy webhook 回执接线
 *
 * 验证 POST /api/brain/deploy 的 production / staging 两分支：
 * - 发起部署时写 pending 回执（kind=deploy, target=production|staging）
 * - 按真实结果核销 confirmed / failed
 * - 鉴权失败不写回执
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, unlinkSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
vi.mock('./shared.js', () => ({
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

describe('deploy webhook 回执接线（T4）', () => {
  const ORIG_REPO_ROOT = process.env.REPO_ROOT;
  let app;
  let tmpRepoRoot;

  beforeEach(async () => {
    vi.clearAllMocks();
    retentionRuntimeMock.mockResolvedValue({ledger:{settlement:settlementMock}});
    settlementMock.mockResolvedValue({outcome:"success",git_sha:"a".repeat(40),image_id:"sha256:"+"b".repeat(64)});
    recordActionReceipt.mockResolvedValue('r-dep');
    resolveActionReceipt.mockResolvedValue(true);
    execSyncMock.mockReturnValue(Buffer.from('ok'));
    capturedSpawnArgs = null;
    spawnCloseHandler = null;
    process.env.DEPLOY_TOKEN = 'tok';
    // 用临时目录做 REPO_ROOT，避免 production 分支在真实仓库里落 log 文件
    tmpRepoRoot = mkdtempSync(join(tmpdir(), 'deploy-receipt-test-'));
    process.env.REPO_ROOT = tmpRepoRoot;
    mkdirSync(join(tmpRepoRoot,'scripts'));writeFileSync(join(tmpRepoRoot,'scripts/staging-deploy.sh'),'fixture');
    execFileMock.mockImplementation((_bin,_args,opts,cb)=>cb(null,`STAGING_VERIFIED sha=${'a'.repeat(40)} image=sha256:${'b'.repeat(64)} request=${opts.env.STAGING_REQUEST_ID}\n`));
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

  it('idle只在实际结算证明存在时明确幂等成功',async()=>{
    const res=await request(app).get('/api/brain/deploy/status');
    expect(res.body.settled).toBe(true);expect(res.body.settlement.outcome).toBe('success');
    expect(settlementMock).toHaveBeenCalled();
  });
  it.each(['running','rolling_back','failed','rollback_failed'])('状态%s不能被历史ledger覆盖',async status=>{
    const {deployState}=await import('../routes/ops.js');deployState.status=status;
    const res=await request(app).get('/api/brain/deploy/status');
    expect(res.body.status).toBe(status);expect(res.body.settled).toBe(false);expect(settlementMock).not.toHaveBeenCalled();
  });
  it.each(['IMAGE_RETENTION_BUSY','DOCKER_TIMEOUT'])('只读结算%s保持unsettled',async code=>{
    settlementMock.mockRejectedValue(Object.assign(Error(code),{code}));
    const res=await request(app).get('/api/brain/deploy/status');
    expect(res.status).toBe(200);expect(res.body.settled).toBe(false);expect(res.body.settlement).toBeNull();
  });

  it.each([42, {path:'a'}, ['ok',null], ['line\nbreak'], ['x'.repeat(1025)], Array(2001).fill('a')])('invalid changed_paths rejects before spawn %#',async changed_paths=>{
    const res=await request(app).post('/api/brain/deploy').set('Authorization','Bearer tok').send({changed_paths});
    expect(res.status).toBe(400);expect(capturedSpawnArgs).toBeNull();expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('production binds the requested SHA to a fixed executable and literal argv',async()=>{
    const sha='a'.repeat(40),changed_paths=['packages/brain/src/$(touch SHOULD_NOT_EXIST).js'];
    const res=await request(app).post('/api/brain/deploy').set('Authorization','Bearer tok').send({sha,changed_paths});
    expect(res.status).toBe(202);await new Promise(r=>setTimeout(r,30));
    expect(capturedSpawnArgs[0]).toBe('bash');
    expect(capturedSpawnArgs[1]).toEqual([join(tmpRepoRoot,'scripts/deploy-local.sh'),`--changed=${changed_paths[0]}`,'main']);
    expect(capturedSpawnArgs[2].shell).not.toBe(true);
    expect(capturedSpawnArgs[2].env.EXPECTED_SHA).toBe(sha);
  });

  it('deployment mutation route bounds request rate before side effects',async()=>{
    for(let i=0;i<30;i++)expect((await request(app).post('/api/brain/deploy').send({})).status).toBe(401);
    const limited=await request(app).post('/api/brain/deploy').send({});
    expect(limited.status).toBe(429);expect(capturedSpawnArgs).toBeNull();expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('production deploy → 写 pending(kind=deploy/target=production)，close(0) 核销 confirmed', async () => {
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ changed_paths: ['packages/brain/src/x.js'] });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'production' })
    );
    expect(spawnCloseHandler).toBeTypeOf('function');
    spawnCloseHandler(0, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'confirmed', expect.objectContaining({ exit_code: 0 })
    );
  });

  it('production deploy close(1) → 核销 failed', async () => {
    await request(app).post('/api/brain/deploy').set('Authorization', 'Bearer tok').send({});
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnCloseHandler).toBeTypeOf('function');
    spawnCloseHandler(1, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'failed', expect.objectContaining({ exit_code: 1 })
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

  it('staging 冷构建与隔离恢复允许90分钟执行但保持有限超时', async () => {
    await request(app).post('/api/brain/deploy').set('Authorization', 'Bearer tok')
      .send({ staging: true, sha: 'a'.repeat(40) });
    expect(execFileMock).toHaveBeenCalled();
    expect(execFileMock.mock.calls[0][2].timeout).toBe(90 * 60 * 1000);
  });

  it('staging deploy 成功 → record(deploy/staging) + confirmed', async () => {
    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'staging' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-dep', 'confirmed', expect.anything());
  });

  it('staging execFile 回调错误 → 核销 failed（含 error）', async () => {
    execFileMock.mockImplementation((_bin,_args,_opts,cb)=>cb(new Error('boom')));
    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'staging' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'failed', expect.objectContaining({ error: 'boom' })
    );
  });

  it('staging 输出 STAGING_SKIP_REASON=no_docker → failed 且保留错误回执', async () => {
    execFileMock.mockImplementation((_bin,_args,_opts,cb)=>cb(null,'STAGING_SKIP_REASON=no_docker\n'));
    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(resolveActionReceipt).toHaveBeenCalledWith(
      'r-dep', 'failed', expect.objectContaining({ error: expect.stringContaining('未完成候选验证') })
    );
  });
});
