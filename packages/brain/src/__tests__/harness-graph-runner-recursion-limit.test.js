/**
 * harness-graph-runner-recursion-limit.test.js
 *
 * 验证 LangGraph recursionLimit 已从官方默认 25 提升到 100：
 *  - reviewer 连续 15 轮 REVISION 后 APPROVED（需要 30+ 步）应能通过，
 *    而 LangGraph 默认 25 会抛 GraphRecursionError。
 *  - opts.recursionLimit 可显式覆盖。
 *  - DEFAULT_RECURSION_LIMIT 常量暴露为 100。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runHarnessPipeline,
  DEFAULT_RECURSION_LIMIT,
} from '../harness-graph-runner.js';

describe('DEFAULT_RECURSION_LIMIT', () => {
  it('exports 100 (up from LangGraph default 25)', () => {
    expect(DEFAULT_RECURSION_LIMIT).toBe(100);
  });
});

describe('runHarnessPipeline — recursionLimit=100 允许 25+ 步循环', () => {
  const ORIGINAL_ENV = process.env.HARNESS_LANGGRAPH_ENABLED;

  beforeEach(() => {
    process.env.HARNESS_LANGGRAPH_ENABLED = 'true';
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.HARNESS_LANGGRAPH_ENABLED;
    else process.env.HARNESS_LANGGRAPH_ENABLED = ORIGINAL_ENV;
  });

  it('reviewer 连续 15 轮 REVISION 后 APPROVED — 默认 limit (100) 足够跑完', async () => {
    let reviewRound = 0;
    const overrides = {
      planner: async () => ({ prd_content: 'prd' }),
      proposer: async () => ({ acceptance_criteria: 'c', contract_content: 'ct' }),
      reviewer: async () => {
        reviewRound += 1;
        const verdict = reviewRound <= 15 ? 'REVISION' : 'APPROVED';
        return {
          review_verdict: verdict,
          review_feedback: verdict === 'REVISION' ? `round ${reviewRound} feedback` : null,
        };
      },
      generator: async () => ({ pr_url: 'https://github.com/x/pull/1', pr_branch: 'cp-test' }),
      evaluator: async () => ({ evaluator_verdict: 'PASS' }),
      report: async () => ({ report_path: 'r.md' }),
    };

    const r = await runHarnessPipeline(
      { id: 'task-rl-1', description: 'demo' },
      { overrides },
    );

    expect(r.skipped).toBe(false);
    // 每轮 reviewer=REVISION 会 reviewer→proposer→reviewer → 2 步/轮，
    // 15 轮 × 2 = 30 步，再加 planner/generator/evaluator/report = 30+ 步。
    // 官方默认 25 会抛 GraphRecursionError；100 能跑完。
    expect(r.steps).toBeGreaterThan(25);
    expect(reviewRound).toBe(16); // 15 REVISION + 1 APPROVED
  });

  it('opts.recursionLimit=5 太低 → LangGraph 抛 GraphRecursionError', async () => {
    const overrides = {
      planner: async () => ({ prd_content: 'prd' }),
      proposer: async () => ({ acceptance_criteria: 'c', contract_content: 'ct' }),
      reviewer: async () => ({ review_verdict: 'REVISION', review_feedback: 'nope' }),
      generator: async () => ({}),
      evaluator: async () => ({ evaluator_verdict: 'PASS' }),
      report: async () => ({ report_path: 'r.md' }),
    };

    await expect(
      runHarnessPipeline(
        { id: 'task-rl-2', description: 'demo' },
        { overrides, recursionLimit: 5 },
      ),
    ).rejects.toThrow();
  });
});
