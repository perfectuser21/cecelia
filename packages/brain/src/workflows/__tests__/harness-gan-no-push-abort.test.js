/**
 * 回归：proposer 连续未 push 分支（429/报错没产出）时 GAN 必须带原因中止，
 * 而不是吞掉 verifyProposer 错误空转重试。
 *
 * 实证 bug：account2 被烧到 429 后，proposer 容器跑完 exit=0 但没 push 分支，
 * verifyProposer 抛 proposer_didnt_push，旧代码 .catch 吞掉照常返回旧合同，
 * GAN 空转 23 轮把账号彻底烧穿。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

import { createGanContractNodes, MAX_NO_PUSH_STREAK } from '../harness-gan.graph.js';

function makeExecutor(worktreePath) {
  return vi.fn(async ({ env }) => {
    writeFileSync(
      path.join(worktreePath, '.brain-result.json'),
      JSON.stringify({ propose_branch: env.PROPOSE_BRANCH, workstream_count: 1 }),
    );
    return { exit_code: 0, stdout: '', cost_usd: 0.01 };
  });
}

describe('GAN proposer 连续未 push → 中止（不空转）', () => {
  it('verifyProposer 持续失败：第 1 轮不中止（streak<上限），累计达上限轮设 error', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-nopush-'));
    try {
      const failVerify = vi.fn(async () => {
        throw new Error("proposer_didnt_push: branch 'x' not found on origin");
      });
      const { proposer } = createGanContractNodes(makeExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue('# stale contract'),
        fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
        verifyProposer: failVerify,
      });

      // 第 1 次未 push：streak=1 < MAX(2)，不中止，仍返回合同（给 GAN 一次容错重试机会）
      const r1 = await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0, proposerNoPushStreak: 0 });
      expect(r1.error).toBeFalsy();
      expect(r1.proposerNoPushStreak).toBe(1);

      // 第 2 次仍未 push：streak=2 ≥ MAX → 设 error 中止，且不返回合同（不让 reviewer 审旧合同）
      const r2 = await proposer({ round: 1, prdContent: 'x', feedback: null, costUsd: 0, proposerNoPushStreak: 1 });
      expect(r2.error).toBeTruthy();
      expect(r2.error.node).toBe('proposer');
      expect(r2.error.message).toMatch(/didnt_push|未 push|429/);
      expect(r2.proposerNoPushStreak).toBe(2);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('push 成功 → streak 清零（真在对抗的 GAN 不受影响，可无限轮）', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-nopush-ok-'));
    try {
      const { proposer } = createGanContractNodes(makeExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue('# good contract'),
        fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
        verifyProposer: vi.fn(async () => undefined), // push 成功
      });

      // 即便上一轮 streak=1，本轮 push 成功应清零
      const r = await proposer({ round: 3, prdContent: 'x', feedback: null, costUsd: 0, proposerNoPushStreak: 1 });
      expect(r.error).toBeFalsy();
      expect(r.proposerNoPushStreak).toBe(0);
      expect(r.contractContent).toBe('# good contract');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('MAX_NO_PUSH_STREAK 是小常量（不是轮数上限，仅容错）', () => {
    expect(MAX_NO_PUSH_STREAK).toBeGreaterThanOrEqual(2);
    expect(MAX_NO_PUSH_STREAK).toBeLessThanOrEqual(3);
  });
});
