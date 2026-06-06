/**
 * GAN 轮次安全熔断（治"几个小时"慢根因）
 *
 * 背景：原 B52 移除强制收敛阀，"GAN 无限跑直到 Reviewer 真实 APPROVED"。预算熔断
 * （budgetCapUsd）本应兜底，但实测 executor 返回 cost=n/a → state.costUsd 全程 0，
 * `cost > budgetCap` 永不触发 → GAN 可无限空转（实证 15-23 轮 = 几个小时）。
 *
 * 修复：加独立于 cost 追踪的轮次硬上限 MAX_GAN_ROUNDS，对称已有的
 * MAX_NO_PUSH_STREAK / MAX_NO_VERDICT_STREAK / budget 三个 terminal 熔断。
 * 达上限且仍非 APPROVED（Proposer 未收敛）→ 带 terminal:true 中止，fail-fast。
 *
 * SC-301: reviewer 在 round >= MAX_GAN_ROUNDS 仍 REVISION → error.node='reviewer' 且 error.terminal===true
 * SC-302: reviewer 在 round < MAX_GAN_ROUNDS 的正常 REVISION → 不中止（无 error，verdict='REVISION'）
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
  // reviewer 读到干净的 REVISION verdict（无 rubric_scores → 走 file_verdict）
  readBrainResult: vi.fn(async () => ({ verdict: 'REVISION', feedback: '需要改进' })),
  ReviewerOutputSchema: {},
}));

import {
  createGanContractNodes,
  MAX_GAN_ROUNDS,
} from '../workflows/harness-gan.graph.js';

let tmpWt;
beforeEach(() => {
  vi.clearAllMocks();
  tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-maxrounds-test-'));
});

function makeCtx(overrides = {}) {
  return {
    taskId: 'task-maxround-1',
    initiativeId: 'init-maxround-1',
    sprintDir: 'sprints/demo',
    worktreePath: tmpWt,
    githubToken: 'ghs_test',
    baseRepo: '/mock-cecelia',
    plannerOutput: '',
    budgetCapUsd: 999, // 预算不熔断，专测轮次上限
    readContractFile: vi.fn(async () => '# Contract'),
    ...overrides,
  };
}

describe('GAN 轮次安全熔断 MAX_GAN_ROUNDS', () => {
  it('导出 MAX_GAN_ROUNDS 常量（默认 ≥2）', () => {
    expect(typeof MAX_GAN_ROUNDS).toBe('number');
    expect(MAX_GAN_ROUNDS).toBeGreaterThanOrEqual(2);
  });

  it('SC-301: round >= MAX_GAN_ROUNDS 仍 REVISION → error.terminal===true', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, timed_out: false }));
    const { reviewer } = createGanContractNodes(executor, makeCtx());

    const state = { round: MAX_GAN_ROUNDS, costUsd: 0, reviewerNoVerdictStreak: 0 };
    const out = await reviewer(state);

    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('reviewer');
    expect(out.error.terminal).toBe(true);
    expect(String(out.error.message)).toMatch(/round|轮/i);
    rmSync(tmpWt, { recursive: true, force: true });
  });

  it('SC-302: round < MAX_GAN_ROUNDS 的正常 REVISION → 不中止', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, timed_out: false }));
    const { reviewer } = createGanContractNodes(executor, makeCtx());

    const state = { round: 1, costUsd: 0, reviewerNoVerdictStreak: 0 };
    const out = await reviewer(state);

    expect(out.error).toBeFalsy();
    expect(out.verdict).toBe('REVISION');
    rmSync(tmpWt, { recursive: true, force: true });
  });
});
