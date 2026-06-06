/**
 * Regression test: GAN executor 阻塞期间心跳保活
 * 根因 #3295: proposer/reviewer 阻塞 await executor() 5-9 分钟不刷心跳，
 * watchdog staleMinutes=3 超时重排触发并发双执行。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../harness-shared.js', () => ({
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: vi.fn(async () => ({ verdict: 'APPROVED', rubric_scores: null })),
  ReviewerOutputSchema: {},
}));

import { createGanContractNodes } from '../workflows/harness-gan.graph.js';

function makeCtx(overrides = {}) {
  return {
    taskId: 'abc12345-def0',
    initiativeId: 'init-hb-1',
    sprintDir: 'sprints',
    worktreePath: '/tmp/wt-hb',
    githubToken: 'tok',
    baseRepo: 'https://github.com/x/y.git',
    plannerOutput: '',
    readContractFile: vi.fn(async () => '# Contract'),
    readContractFromBranch: vi.fn(async () => null),
    verifyProposer: vi.fn(async () => undefined),
    readReviewerFeedback: vi.fn(async () => null),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/**
 * 等待 executor 被调用（说明 setInterval 已经注册），使用真实时间 polling。
 * proposer 有多个前置 await（readContractFromBranch / import / resolveAccount），
 * 必须等这些 microtask 完成后 setInterval 才注册，再推进 fake timer 才能触发心跳。
 */
async function waitForExecutorCall(executorMock, timeoutMs = 5000) {
  const start = Date.now();
  while (executorMock.mock.calls.length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error('executor was not called within timeout');
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('GAN executor 阻塞期间心跳保活（watchdog 防重排）', () => {
  it('proposer executor 阻塞 130s 时 heartbeatFn 被调用 2 次', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const heartbeatFn = vi.fn().mockResolvedValue(undefined);

    let resolveExecutor;
    const executor = vi.fn(
      () => new Promise(resolve => { resolveExecutor = () => resolve({ exit_code: 0 }); })
    );

    const nodes = createGanContractNodes(executor, makeCtx({ heartbeatFn }));
    const proposerPromise = nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });

    // 等 executor 被调用（表示 setInterval 已注册），再推进 fake timer
    await waitForExecutorCall(executor);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(heartbeatFn).toHaveBeenCalledTimes(2);

    resolveExecutor();
    await proposerPromise;

    await vi.advanceTimersByTimeAsync(70_000);
    expect(heartbeatFn).toHaveBeenCalledTimes(2);
  });

  it('reviewer executor 阻塞 130s 时 heartbeatFn 被调用 2 次', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const heartbeatFn = vi.fn().mockResolvedValue(undefined);

    let resolveExecutor;
    const executor = vi.fn(
      () => new Promise(resolve => { resolveExecutor = () => resolve({ exit_code: 0 }); })
    );

    const nodes = createGanContractNodes(executor, makeCtx({ heartbeatFn }));
    const reviewerState = {
      prdContent: '# PRD',
      contractContent: '# Contract',
      round: 1,
      costUsd: 0,
      rubricHistory: [],
    };
    const reviewerPromise = nodes.reviewer(reviewerState);

    // 等 executor 被调用（表示 setInterval 已注册），再推进 fake timer
    await waitForExecutorCall(executor);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(heartbeatFn).toHaveBeenCalledTimes(2);

    resolveExecutor();
    await reviewerPromise;

    await vi.advanceTimersByTimeAsync(70_000);
    expect(heartbeatFn).toHaveBeenCalledTimes(2);
  });

  it('heartbeatFn 未传入时 proposer 正常运行（无心跳也不崩）', async () => {
    const executor = vi.fn().mockResolvedValue({ exit_code: 0 });
    const nodes = createGanContractNodes(executor, makeCtx({}));
    await nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });
    expect(executor).toHaveBeenCalledOnce();
  });

  it('heartbeatFn throw 不阻断 proposer 正常执行', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const heartbeatFn = vi.fn().mockRejectedValue(new Error('db gone'));

    const executor = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 61_000));
      return { exit_code: 0 };
    });

    const nodes = createGanContractNodes(executor, makeCtx({ heartbeatFn }));
    const p = nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });

    // 等 executor 被调用（表示 setInterval 已注册），再推进 fake timer
    await waitForExecutorCall(executor);
    await vi.advanceTimersByTimeAsync(65_000);
    await expect(p).resolves.toBeDefined();
    expect(heartbeatFn).toHaveBeenCalled();
  });
});
