/**
 * GAN 无轮数上限（锁住设计决策 — 回归测试）
 *
 * 设计原则（用户明确决策，勿改）：GAN 不设轮数上限，无限转直到 Reviewer 真实 APPROVED。
 * 慢的解法是让 Proposer「收敛」（B52 精简纪律），不是给轮数封顶。
 *
 * 本测试取代被撤销的 harness-gan-max-rounds.test.js（#3296 误加的 MAX_GAN_ROUNDS 已移除）：
 * 断言「即使 round 很大，只要 Reviewer 给 REVISION，GAN 也不会因轮数中止」，防止有人再加 cap。
 *
 * SC-501: round=20（远超任何曾经的 cap）仍 REVISION → 不中止（无 error），正常路由回 proposer。
 * SC-502: harness-gan.graph 不导出 MAX_GAN_ROUNDS（确保常量已彻底移除）。
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
  readBrainResult: vi.fn(async () => ({ verdict: 'REVISION', feedback: '继续对抗' })),
  ReviewerOutputSchema: {},
}));

import * as ganGraph from '../workflows/harness-gan.graph.js';
import { createGanContractNodes } from '../workflows/harness-gan.graph.js';

let tmpWt;
beforeEach(() => {
  vi.clearAllMocks();
  tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-nocap-test-'));
});

function makeCtx(overrides = {}) {
  return {
    taskId: 'task-nocap-1',
    initiativeId: 'init-nocap-1',
    sprintDir: 'sprints/demo',
    worktreePath: tmpWt,
    githubToken: 'ghs_test',
    baseRepo: '/mock-cecelia',
    plannerOutput: '',
    budgetCapUsd: 999,
    readContractFile: vi.fn(async () => '# Contract'),
    ...overrides,
  };
}

describe('GAN 无轮数上限（设计锁定）', () => {
  it('SC-502: harness-gan.graph 不导出 MAX_GAN_ROUNDS（常量已移除）', () => {
    expect(ganGraph.MAX_GAN_ROUNDS).toBeUndefined();
  });

  it('SC-501: round=20 仍 REVISION → 不因轮数中止（无 error，verdict=REVISION）', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, timed_out: false }));
    const { reviewer } = createGanContractNodes(executor, makeCtx());

    const state = { round: 20, costUsd: 0, reviewerNoVerdictStreak: 0 };
    const out = await reviewer(state);

    expect(out.error).toBeFalsy();
    expect(out.verdict).toBe('REVISION');
    rmSync(tmpWt, { recursive: true, force: true });
  });
});
