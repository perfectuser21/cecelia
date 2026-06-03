/**
 * Wave 2c (B59) — GAN 熔断点 error 对象必须带 terminal:true
 *
 * 配合 B58 在 resume 端加的 error?.terminal===true 钩子：熔断（硬停）在第一次中止就能
 * 标 failed 停，而不是白白消耗满 MAX_INITIATIVE_FRESH_STARTS=3 的预算。
 *
 * 关键区分（terminal vs transient）：
 *   terminal:true（熔断/硬停）→ proposer no-push streak / reviewer no-verdict streak / GAN budget 超限
 *   不标 terminal（transient infra）→ proposer_failed/reviewer_failed (exit≠0 瞬时失败) 靠 cap 兜底重试
 *
 * SC-201: proposer 连续未 push 达上限中止 → 返回 error.node='proposer' 且 error.terminal===true
 * SC-202: reviewer 连续无可解析 verdict 达上限中止 → 返回 error.node='reviewer' 且 error.terminal===true
 * SC-203: GAN budget 超限 → reviewer 返回 error.terminal===true（不再裸 throw）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../harness-shared.js', () => ({
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: vi.fn(async () => ({})),   // 无 propose_branch / verdict / rubric_scores
  ReviewerOutputSchema: {},
}));

import {
  createGanContractNodes,
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
} from '../workflows/harness-gan.graph.js';

let tmpWt;
beforeEach(() => {
  vi.clearAllMocks();
  tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-terminal-test-'));
});

function makeCtx(overrides = {}) {
  return {
    taskId: 'task-terminal-1',
    initiativeId: 'init-terminal-1',
    sprintDir: 'sprints/demo',
    worktreePath: tmpWt,
    githubToken: 'ghs_test',
    baseRepo: '/mock-cecelia',
    plannerOutput: '',
    budgetCapUsd: 10,
    readContractFile: vi.fn(async () => '# Contract'),
    ...overrides,
  };
}

describe('GAN 熔断点 error.terminal:true', () => {
  it('SC-201: proposer 连续未 push 达上限中止 → error.terminal===true', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, timed_out: false }));
    // verifyProposer 每轮都失败（push 没成功）
    const verifyProposer = vi.fn(async () => { throw new Error('no push: 429'); });
    const { proposer } = createGanContractNodes(executor, makeCtx({ verifyProposer }));

    // 起始 streak = MAX-1，本轮失败后达 MAX → 中止
    const state = { round: 0, costUsd: 0, proposerNoPushStreak: MAX_NO_PUSH_STREAK - 1 };
    const out = await proposer(state);

    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('proposer');
    expect(out.error.terminal).toBe(true);
    rmSync(tmpWt, { recursive: true, force: true });
  });

  it('SC-202: reviewer 连续无可解析 verdict 达上限中止 → error.terminal===true', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, timed_out: false }));
    const readReviewerFeedback = vi.fn(async () => null); // 散文也无 verdict
    const { reviewer } = createGanContractNodes(executor, makeCtx({ readReviewerFeedback }));

    const state = {
      round: 1,
      costUsd: 0,
      reviewerNoVerdictStreak: MAX_NO_VERDICT_STREAK - 1,
    };
    const out = await reviewer(state);

    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('reviewer');
    expect(out.error.terminal).toBe(true);
    rmSync(tmpWt, { recursive: true, force: true });
  });

  it('SC-203: GAN budget 超限 → reviewer 返回 error.terminal===true（不裸 throw）', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, timed_out: false }));
    const { reviewer } = createGanContractNodes(executor, makeCtx({ budgetCapUsd: 5 }));

    // costUsd 已超 cap → 预算熔断
    const state = { round: 1, costUsd: 999, reviewerNoVerdictStreak: 0 };
    const out = await reviewer(state);

    expect(out.error).toBeTruthy();
    expect(out.error.terminal).toBe(true);
    expect(String(out.error.message)).toMatch(/budget/i);
    rmSync(tmpWt, { recursive: true, force: true });
  });
});
