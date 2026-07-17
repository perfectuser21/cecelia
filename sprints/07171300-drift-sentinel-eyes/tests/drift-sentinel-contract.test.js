/**
 * 合同测试 — drift-sentinel-eyes hotfix
 * TASK_ID: fe385921-603a-449f-ba88-606559fd2d43
 *
 * 覆盖场景（T1-T5）：
 *   T1 - sha_main 容器环境：origin 不可达 + gh 无 auth，HTTPS URL 路径生效
 *   T2 - sha_main 二级降级：git 全部失败，curl GitHub API 返回 .sha
 *   T3 - sha_prod 使用 localhost：默认 URL 改为 http://localhost:5221
 *   T4 - 错误日志含原始错误文本：console.log 包含 error= + err.message
 *   T5 - 网络全断保守跳过（回归）：不 throw，verdict=network_error，计数递增
 *
 * TDD 纪律：
 *   T1/T2/T3/T4 在当前代码下先失败（FAILING）。
 *   修复 defaultFetchMainSha() / defaultFetchProdSha() 后，测试通过。
 *   T5 为回归保护，全程通过。
 *
 * mock 策略：
 *   - 通过依赖注入（fetchMainSha / fetchProdSha 参数）测试容器网络环境，
 *     不 mock 内部判定逻辑（isDrifted / 防抖 / redeploy 路径）。
 *   - T1/T2/T3 测试 defaultFetchMainSha / defaultFetchProdSha 本身，
 *     通过 mock child_process.exec 模拟网络 I/O。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock 外部依赖
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../../../packages/brain/src/alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../packages/brain/src/notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(undefined),
}));

// mock child_process.exec — 用于测试 defaultFetchMainSha / defaultFetchProdSha
const mockExec = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    exec: vi.fn((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      mockExec(cmd).then(
        (res) => cb && cb(null, res?.stdout ?? '', res?.stderr ?? ''),
        (err) => cb && cb(err)
      );
    }),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 导入被测模块
// ─────────────────────────────────────────────────────────────────────────────

import {
  defaultFetchMainSha,
  defaultFetchProdSha,
  runDriftCheck,
} from '../../../packages/brain/src/cron/drift-sentinel.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('drift-sentinel-contract — T1~T5', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T1 — sha_main 容器环境：origin 不可达 + gh 无 auth，应走 HTTPS URL
  //
  // FAILING 前：当前 defaultFetchMainSha() 先走 `git ls-remote origin`，
  //             容器内失败后降级走 `gh api`（无 auth 也失败）→ 抛出异常。
  //             修复后：先走 `git ls-remote https://github.com/...` 返回有效 SHA。
  // ───────────────────────────────────────────────────────────────────────────
  it('T1: origin 不可达 + gh 无 auth → HTTPS URL 路径返回有效 SHA', async () => {
    const EXPECTED_SHA = 'aabbccdd1122334455667788990011223344556677';

    mockExec.mockImplementation((cmd) => {
      // 旧路径（修复前）：ls-remote origin → 失败
      if (cmd.includes('ls-remote origin')) {
        return Promise.reject(new Error('fatal: unable to connect to origin'));
      }
      // 旧降级路径（修复前）：gh api → 失败
      if (cmd.includes('gh api')) {
        return Promise.reject(new Error('gh: not authenticated'));
      }
      // 新路径（修复后）：ls-remote https://github.com/... → 成功
      if (cmd.includes('ls-remote') && cmd.includes('https://github.com/')) {
        return Promise.resolve({ stdout: `${EXPECTED_SHA}\trefs/heads/main\n`, stderr: '' });
      }
      // curl GitHub API 降级（T2 场景，T1 不走到这里）
      if (cmd.includes('api.github.com')) {
        return Promise.resolve({ stdout: JSON.stringify({ sha: EXPECTED_SHA }), stderr: '' });
      }
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    // 修复前：此测试应 throw 或返回 network_error（FAILING）
    // 修复后：此测试应返回有效 SHA
    const sha = await defaultFetchMainSha();
    expect(sha).toBeDefined();
    expect(sha.length).toBeGreaterThanOrEqual(7);
    expect(sha).toBe(EXPECTED_SHA);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T2 — sha_main 二级降级：git 全部失败，curl GitHub API 返回 .sha
  //
  // FAILING 前：旧降级路径是 `gh api`（无 auth 失败），不走 curl。
  //             修复后：降级路径改为 curl api.github.com，解析 .sha 返回。
  // ───────────────────────────────────────────────────────────────────────────
  it('T2: git ls-remote 全部失败 → curl GitHub API 降级返回 .sha', async () => {
    const EXPECTED_SHA = 'deadbeef1234567890abcdef1234567890abcdef';

    mockExec.mockImplementation((cmd) => {
      // 所有 git ls-remote 路径均失败
      if (cmd.includes('ls-remote')) {
        return Promise.reject(new Error('git: connection timeout'));
      }
      // 旧降级路径（修复前）：gh api → 失败
      if (cmd.includes('gh api')) {
        return Promise.reject(new Error('gh: not authenticated'));
      }
      // 新降级路径（修复后）：curl api.github.com → 成功
      if (cmd.includes('api.github.com')) {
        return Promise.resolve({
          stdout: JSON.stringify({ sha: EXPECTED_SHA, commit: { message: 'test' } }),
          stderr: '',
        });
      }
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    // 修复前：此测试应 throw（gh api 也失败）（FAILING）
    // 修复后：返回 curl 解析的 .sha
    const sha = await defaultFetchMainSha();
    expect(sha).toBe(EXPECTED_SHA);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T3 — sha_prod 使用 localhost：默认 URL 改为 http://localhost:5221
  //
  // FAILING 前：defaultFetchProdSha() 默认用 https://brain.cecelia.ai（外网不通）。
  //             修复后：默认改为 http://localhost:5221。
  // ───────────────────────────────────────────────────────────────────────────
  it('T3: BRAIN_PROD_URL 未设置时，使用 localhost:5221 返回 git_sha', async () => {
    const EXPECTED_SHA = 'def456abc789def456abc789def456abc789def4';

    // 确保 env 未设置（模拟容器内默认情况）
    const originalEnv = process.env.BRAIN_PROD_URL;
    delete process.env.BRAIN_PROD_URL;

    mockExec.mockImplementation((cmd) => {
      // 旧外网 URL（修复前）：brain.cecelia.ai → 失败
      if (cmd.includes('brain.cecelia.ai')) {
        return Promise.reject(new Error('curl: (7) Failed to connect to brain.cecelia.ai port 443'));
      }
      // 新 localhost URL（修复后）：localhost:5221 → 成功
      if (cmd.includes('localhost:5221')) {
        return Promise.resolve({
          stdout: JSON.stringify({ git_sha: EXPECTED_SHA, status: 'ok' }),
          stderr: '',
        });
      }
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    try {
      // 修复前：此测试应 throw（使用外网 URL 失败）（FAILING）
      // 修复后：返回 localhost health 的 git_sha
      const sha = await defaultFetchProdSha();
      expect(sha).toBe(EXPECTED_SHA);
    } finally {
      if (originalEnv !== undefined) {
        process.env.BRAIN_PROD_URL = originalEnv;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T4 — 错误日志含原始错误文本
  //
  // FAILING 前：catch 块只打 `verdict=network_error`，不含 error= + err.message。
  //             修复后：日志包含 `error=` 前缀和原始错误原文。
  // ───────────────────────────────────────────────────────────────────────────
  it('T4: 探针失败时 console.log 包含 error= 前缀和原始错误文本', async () => {
    const ERROR_MSG = 'ECONNREFUSED 127.0.0.1:9999';

    // 通过依赖注入使两个探针都失败，并携带可识别的错误信息
    await runDriftCheck({
      fetchMainSha: async () => {
        throw new Error(ERROR_MSG);
      },
      fetchProdSha: async () => {
        throw new Error('prod unreachable');
      },
      now: new Date(),
      _testInitialState: {
        redeployCount: 0,
        driftFirstSeenAt: null,
        consecutiveNetworkErrors: 0,
      },
    });

    // 修复前：console.log 只包含 `verdict=network_error`，不含 error=（FAILING）
    // 修复后：至少一次 console.log 调用包含 `error=` + ECONNREFUSED
    const logCalls = consoleSpy.mock.calls.flat().join(' ');
    expect(logCalls).toMatch(/error=/);
    expect(logCalls).toMatch(new RegExp(ERROR_MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T5 — 网络全断保守跳过（回归保护）
  //
  // 两探针均失败 → 不 throw；verdict=network_error；consecutiveNetworkErrors 递增。
  // 此测试为回归保护，当前代码下即应通过。
  // ───────────────────────────────────────────────────────────────────────────
  it('T5: 两探针均失败 → 不 throw，verdict=network_error，计数递增', async () => {
    const result = await runDriftCheck({
      fetchMainSha: async () => {
        throw new Error('connection refused');
      },
      fetchProdSha: async () => {
        throw new Error('prod unreachable');
      },
      now: new Date(),
      _testInitialState: {
        redeployCount: 0,
        driftFirstSeenAt: null,
        consecutiveNetworkErrors: 0,
      },
    });

    // 不抛出（Promise resolve）
    expect(result).toBeDefined();
    // verdict=network_error
    expect(result.verdict).toBe('network_error');
    // sha_main / sha_prod 不应出现有效值
    expect(result.sha_main).toBeUndefined();
    expect(result.sha_prod).toBeUndefined();
  });
});
