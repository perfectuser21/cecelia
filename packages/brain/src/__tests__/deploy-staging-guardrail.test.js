/**
 * deploy-staging-guardrail.test.js
 *
 * 蓝绿部署护栏回归测试：staging 验证失败时，production（生产端口）不被触碰，客户无感。
 *
 * 覆盖两层护栏：
 *  1. ops.js POST /deploy（staging 分支）状态机
 *     - staging 脚本失败（exit 非 0）→ stagingDeployState.status='failed'
 *       且 production deployState 保持 idle（证明"生产实例未被触碰"）
 *     - STAGING_SKIP_REASON=no_docker → skipped_no_docker（环境未配置不阻断 production）
 *     - staging 干净成功 → success
 *  2. 脚本契约：staging-deploy.sh 必须接入 staging-verify.sh
 *     （历史问题：staging-verify.sh 只在注释里，从未被执行 → verification 级失败漏判）
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
import { readFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../..');

const { claimReleaseEffect } = vi.hoisted(() => ({
  claimReleaseEffect: vi.fn(),
}));

// 受控的 execFile mock：每个用例注入 worker 的 callback 行为
let stagingExecImpl = (_file, _args, _options, callback) => callback(
  null,
  { stdout: '', stderr: '' },
);
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: (...args) => stagingExecImpl(...args),
  spawn: () => ({ unref: vi.fn(), on: vi.fn() }),
}));
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

// 轻量化 ops.js 的重依赖
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

// 等待 POST /deploy(staging) 的后台 typed worker 流程跑完
async function waitStagingSettled(stagingDeployState, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (stagingDeployState.status === 'running' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('deploy-staging-guardrail（蓝绿部署 staging 验证护栏）', () => {
  const deployStatusFile = '/tmp/cecelia-deploy-status.json';
  const stagingStatusFile = '/tmp/cecelia-staging-deploy-status.json';
  const originalDeployStatusFile = process.env.DEPLOY_STATUS_FILE;
  const originalStagingStatusFile = process.env.STAGING_DEPLOY_STATUS_FILE;
  const authority = {
    release_run_id: '44444444-4444-4444-8444-444444444444',
    merge_sha: 'f'.repeat(40),
    release_authorization: '55555555-5555-4555-8555-555555555555',
  };
  let app;
  let mod;

  beforeEach(async () => {
    process.env.DEPLOY_TOKEN = 'test-token';
    process.env.DEPLOY_STATUS_FILE = deployStatusFile;
    process.env.STAGING_DEPLOY_STATUS_FILE = stagingStatusFile;
    stagingExecImpl = (_file, _args, _options, callback) => callback(
      null,
      { stdout: '', stderr: '' },
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
    try { unlinkSync(deployStatusFile); } catch { /* noop */ }
    try { unlinkSync(stagingStatusFile); } catch { /* noop */ }
    vi.resetModules();
    mod = await import('../routes/ops.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  afterAll(() => {
    try { unlinkSync(deployStatusFile); } catch { /* noop */ }
    try { unlinkSync(stagingStatusFile); } catch { /* noop */ }
    if (originalDeployStatusFile == null) delete process.env.DEPLOY_STATUS_FILE;
    else process.env.DEPLOY_STATUS_FILE = originalDeployStatusFile;
    if (originalStagingStatusFile == null) {
      delete process.env.STAGING_DEPLOY_STATUS_FILE;
    } else {
      process.env.STAGING_DEPLOY_STATUS_FILE = originalStagingStatusFile;
    }
  });

  it('staging 脚本失败（exit 非 0）→ status=failed，且 production deployState 保持 idle（生产未触碰）', async () => {
    stagingExecImpl = (_file, _args, _options, callback) => {
      const err = new Error('staging-verify.sh exited with code 1');
      err.status = 1;
      callback(err);
    };

    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({ ...authority, staging: true, changed_paths: ['packages/brain/src/tick.js'] });

    expect(res.status).toBe(202);
    expect(res.body.mode).toBe('staging');

    await waitStagingSettled(mod.stagingDeployState);

    // 护栏核心断言：staging 失败被如实记录
    expect(mod.stagingDeployState.status).toBe('failed');
    expect(mod.stagingDeployState.error).toBe('staging_dispatch_failed');
    // 生产实例完全未被触碰
    expect(mod.deployState.status).toBe('idle');
    expect(mod.deployState.started_at).toBeNull();
  });

  it('STAGING_SKIP_REASON=no_docker → skipped_no_docker（ReleaseRun 保持阻断）', async () => {
    stagingExecImpl = (_file, _args, _options, callback) => callback(
      null,
      {
        stdout: '=== Staging Deploy SKIPPED (no docker) ===\nSTAGING_SKIP_REASON=no_docker\n',
        stderr: '',
      },
    );

    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({ ...authority, staging: true });

    await waitStagingSettled(mod.stagingDeployState);

    expect(mod.stagingDeployState.status).toBe('skipped_no_docker');
    expect(mod.stagingDeployState.skip_reason).toBe('no_docker');
    expect(mod.deployState.status).toBe('idle');
  });

  it('staging 干净成功（无 skip 标记）→ status=success', async () => {
    stagingExecImpl = (_file, _args, _options, callback) => callback(
      null,
      {
        stdout: '=== Staging Deploy SUCCESS: cecelia-brain 在端口 5222 健康 ===\n',
        stderr: '',
      },
    );

    await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer test-token')
      .send({ ...authority, staging: true });

    await waitStagingSettled(mod.stagingDeployState);

    expect(mod.stagingDeployState.status).toBe('success');
    expect(mod.deployState.status).toBe('idle');
  });

  it('契约：staging-deploy.sh 必须接入 staging-verify.sh（防止验证环节再次被绕过）', () => {
    const script = readFileSync(join(REPO_ROOT, 'scripts/staging-deploy.sh'), 'utf-8');
    expect(script).toMatch(/staging-verify\.sh/);
  });
});
