/**
 * drift-sentinel-cwd.test.js
 *
 * 回归测试：验证 drift-sentinel 触发 brain-deploy.sh 时
 *   1. 使用绝对路径（REPO_ROOT/scripts/brain-deploy.sh），而非相对路径
 *   2. 显式传入 cwd: REPO_ROOT
 *
 * 修复前的 bug：exec('bash scripts/brain-deploy.sh', ...) 使用相对路径，
 * 容器内 cwd=/app 且 scripts/ 不在镜像里 → ENOENT，自动补部署永远失败。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve, join } from 'path';

// exec 调用参数捕获（在 mock 提升前声明）
let capturedExecCmd = null;
let capturedExecOpts = null;

vi.mock('child_process', () => ({
  exec: (cmd, opts, cb) => {
    capturedExecCmd = cmd;
    capturedExecOpts = opts;
    if (typeof cb === 'function') cb(null, '', '');
  },
  execSync: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn() }));

describe('drift-sentinel: brain-deploy.sh 执行路径与 cwd [回归-ENOENT修复]', () => {
  const TEST_REPO_ROOT = '/test/fake/repo/root';

  beforeEach(() => {
    capturedExecCmd = null;
    capturedExecOpts = null;
    vi.stubEnv('REPO_ROOT', TEST_REPO_ROOT);
  });

  it('使用 REPO_ROOT 绝对路径而非相对路径调用 exec', async () => {
    // 动态导入以使 vi.stubEnv 在模块初始化前生效
    const { runDriftCheck } = await import('../cron/drift-sentinel.js');

    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    await runDriftCheck({
      fetchMainSha: async () => 'aaaaaa1111111111111111111111111111111111',
      fetchProdSha: async () => 'bbbbbb2222222222222222222222222222222222',
      now: new Date(),
      _testInitialState: {
        driftFirstSeenAt: thirtyOneMinAgo,
        redeployCount: 0,
        consecutiveNetworkErrors: 0,
      },
    });

    expect(capturedExecCmd, 'exec 必须使用绝对路径，不能是 bash scripts/brain-deploy.sh').toBeDefined();
    const expectedScript = join(TEST_REPO_ROOT, 'scripts/brain-deploy.sh');
    expect(capturedExecCmd).toContain(expectedScript);
    // 确保不是纯相对路径
    expect(capturedExecCmd).not.toMatch(/^bash scripts\//);
  });

  it('exec opts.cwd 显式设为 REPO_ROOT', async () => {
    const { runDriftCheck } = await import('../cron/drift-sentinel.js');

    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    await runDriftCheck({
      fetchMainSha: async () => 'aaaaaa1111111111111111111111111111111111',
      fetchProdSha: async () => 'bbbbbb2222222222222222222222222222222222',
      now: new Date(),
      _testInitialState: {
        driftFirstSeenAt: thirtyOneMinAgo,
        redeployCount: 0,
        consecutiveNetworkErrors: 0,
      },
    });

    expect(capturedExecOpts, 'exec 必须传入 opts 对象').toBeDefined();
    expect(capturedExecOpts.cwd).toBe(TEST_REPO_ROOT);
  });

  it('漂移窗口 < 30min 时不触发 exec（防抖正常工作）', async () => {
    const { runDriftCheck } = await import('../cron/drift-sentinel.js');

    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const result = await runDriftCheck({
      fetchMainSha: async () => 'aaaaaa1111111111111111111111111111111111',
      fetchProdSha: async () => 'bbbbbb2222222222222222222222222222222222',
      now: new Date(),
      _testInitialState: {
        driftFirstSeenAt: twentyMinAgo,
        redeployCount: 0,
        consecutiveNetworkErrors: 0,
      },
    });

    expect(result.verdict).toBe('drifting');
    expect(capturedExecCmd).toBeNull();
  });

  it('verdict=redeploying 当 SHA 不一致且防抖窗口已过', async () => {
    const { runDriftCheck } = await import('../cron/drift-sentinel.js');

    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    const result = await runDriftCheck({
      fetchMainSha: async () => 'aaaaaa1111111111111111111111111111111111',
      fetchProdSha: async () => 'bbbbbb2222222222222222222222222222222222',
      now: new Date(),
      _testInitialState: {
        driftFirstSeenAt: thirtyOneMinAgo,
        redeployCount: 0,
        consecutiveNetworkErrors: 0,
      },
    });

    expect(result.verdict).toBe('redeploying');
    expect(result.redeployCount).toBe(1);
  });
});
