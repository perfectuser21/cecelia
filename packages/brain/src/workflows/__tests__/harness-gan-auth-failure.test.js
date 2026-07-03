/**
 * 回归：harness GAN proposer/reviewer 的 executor 失败（exit_code!=0）时，
 * 必须 (1) 解析 stdout 识别账号认证失败特征 → markAuthFailure 计入熔断器，
 *        避免坏账号被 resolveAccount 反复重选（pipeline 成功率长期 11-15% 根因之一）；
 *     (2) 把 stdout/stderr 尾部摘要带进 Error message，让下游 reportNode 的
 *        failure_reason 能看出真实原因（不能只有裸 exit_code）。
 *
 * 实证 bug：proposer/reviewer 容器秒退 exit=1，stdout 装着
 *   {"result":"Not logged in · Please run /login",...}
 * 旧代码直接 throw new Error(`proposer_failed: exit=1`)，stdout 被丢弃、
 * 熔断器从没被写过 → 同一登出账号被无限重选，直到 cap/watchdog 耗尽。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveAccount：真实实现依赖 DB，测试里 mock 成只往 env 写 accountId
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn(async (opts) => {
    opts.env = opts.env || {};
    opts.env.CECELIA_CREDENTIALS = 'account-test';
  }),
}));

// markAuthFailure：熔断器写入，spy 验证是否被调用
vi.mock('../../account-usage.js', () => ({
  markAuthFailure: vi.fn(),
}));

import { markAuthFailure } from '../../account-usage.js';
import { createGanContractNodes } from '../harness-gan.graph.js';

function makeNodes(executor) {
  return createGanContractNodes(executor, {
    taskId: 'test-task',
    initiativeId: 'init',
    sprintDir: 'sprints',
    worktreePath: '/tmp/gan-auth-test',
    githubToken: 'fake',
    // 让 proposer 不走 B59-idem 幂等跳过、直接 spawn executor
    readContractFromBranch: vi.fn().mockResolvedValue(null),
    verifyProposer: vi.fn(async () => undefined),
  });
}

const NOT_LOGGED_IN_STDOUT =
  '{"result":"Not logged in · Please run /login","total_cost_usd":0,"duration_ms":117}';
const COMPILE_ERROR_STDOUT =
  'src/foo.ts(12,3): error TS2304: Cannot find name "bar". SyntaxError: Unexpected token';

describe('GAN executor 失败 → 认证熔断 + stdout 带进 Error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proposer: exit=1 且 stdout 含 "Not logged in" → markAuthFailure 被调用，Error 带 stdout 片段', async () => {
    const executor = vi.fn(async () => ({ exit_code: 1, stdout: NOT_LOGGED_IN_STDOUT, cost_usd: 0 }));
    const { proposer } = makeNodes(executor);

    await expect(
      proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0, proposerNoPushStreak: 0 }),
    ).rejects.toThrow(/Not logged in/);

    expect(markAuthFailure).toHaveBeenCalledTimes(1);
    expect(markAuthFailure).toHaveBeenCalledWith('account-test', expect.any(String), expect.any(String));
  });

  it('reviewer: exit=1 且 stdout 含 "Not logged in" → markAuthFailure 被调用，Error 前缀 reviewer_failed', async () => {
    const executor = vi.fn(async () => ({ exit_code: 1, stdout: NOT_LOGGED_IN_STDOUT, cost_usd: 0 }));
    const { reviewer } = makeNodes(executor);

    await expect(
      reviewer({ round: 1, prdContent: 'x', contractContent: '# c', costUsd: 0 }),
    ).rejects.toThrow(/reviewer_failed.*Not logged in/s);

    expect(markAuthFailure).toHaveBeenCalledTimes(1);
    expect(markAuthFailure).toHaveBeenCalledWith('account-test', expect.any(String), expect.any(String));
  });

  it('proposer: exit=1 但 stdout 是普通编译错误 → markAuthFailure 不被调用（防误报），但 Error 仍带 stdout 摘要', async () => {
    const executor = vi.fn(async () => ({ exit_code: 1, stdout: COMPILE_ERROR_STDOUT, cost_usd: 0 }));
    const { proposer } = makeNodes(executor);

    await expect(
      proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0, proposerNoPushStreak: 0 }),
    ).rejects.toThrow(/proposer_failed.*SyntaxError/s);

    expect(markAuthFailure).not.toHaveBeenCalled();
  });
});
