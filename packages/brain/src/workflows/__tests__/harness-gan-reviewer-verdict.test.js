/**
 * 回归：reviewer verdict 鲁棒解析 + 无 verdict 中止（B54）。
 *
 * 实证 bug（v4 run task 975f5d9c，checkpoint ground truth）：
 *   verdict / rubricHistory 通道全程零 blob → reviewer 每轮 verdict=undefined。
 *   reviewer 把 APPROVED 写进了散文 contract-review-feedback.md，但没把 verdict/rubric_scores
 *   写进 brain 读的 .brain-result.json（SKILL 用引号 heredoc + 占位符，LLM 没替换→非法 JSON→parse 失败→空）。
 *   verdict = rubricVerdict || resultData.verdict 两级皆空 → 永不 APPROVED；B52 删兜底阀 → 无限空转。
 *
 * 修复：
 *   1. 结构化 verdict 缺失 → 从 contract-review-feedback.md 降级解析（恢复 reviewer 真实决定）。
 *   2. 任何来源都拿不到 verdict → 连续 N 轮 abort（对称 proposerNoPushStreak / #3229），不静默空转。
 *   3. reviewerRouter error → END。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { END } from '@langchain/langgraph';

import {
  createGanContractNodes,
  MAX_NO_VERDICT_STREAK,
  defaultReadReviewerFeedbackVerdict,
  reviewerRouter,
} from '../harness-gan.graph.js';

// reviewer executor：写一个【缺 verdict/rubric_scores】的 .brain-result.json（模拟 reviewer 没写结构化结果）
function makeEmptyResultExecutor(worktreePath) {
  return vi.fn(async () => {
    writeFileSync(
      path.join(worktreePath, '.brain-result.json'),
      JSON.stringify({ feedback: '' }), // 无 verdict、无 rubric_scores
    );
    return { exit_code: 0, stdout: '', cost_usd: 0.01 };
  });
}

describe('B54 — defaultReadReviewerFeedbackVerdict 散文解析', () => {
  async function writeFeedback(content) {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-fb-'));
    await mkdir(path.join(tmp, 'sprints'), { recursive: true });
    await writeFile(path.join(tmp, 'sprints', 'contract-review-feedback.md'), content);
    return tmp;
  }

  it('解析 **verdict**: APPROVED', async () => {
    const tmp = await writeFeedback('# Contract Review Feedback — Round 3\n\n**verdict**: APPROVED\n');
    try {
      expect(await defaultReadReviewerFeedbackVerdict(tmp, 'sprints')).toBe('APPROVED');
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it('解析 ## VERDICT: REVISION', async () => {
    const tmp = await writeFeedback('## VERDICT: REVISION\n\nfeedback...\n');
    try {
      expect(await defaultReadReviewerFeedbackVerdict(tmp, 'sprints')).toBe('REVISION');
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it('无 verdict 标记 → null', async () => {
    const tmp = await writeFeedback('# 一些散文，没有 verdict 行\n合同看起来不错。\n');
    try {
      expect(await defaultReadReviewerFeedbackVerdict(tmp, 'sprints')).toBeNull();
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it('文件不存在 → null（不抛）', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-fb-none-'));
    try {
      expect(await defaultReadReviewerFeedbackVerdict(tmp, 'sprints')).toBeNull();
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});

describe('B54 — reviewer 结构化 verdict 缺失时从散文反馈降级解析', () => {
  it('.brain-result.json 无 verdict/rubric 但散文反馈 APPROVED → verdict=APPROVED（GAN 可退出）', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-rv-'));
    try {
      const { reviewer } = createGanContractNodes(makeEmptyResultExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readReviewerFeedback: vi.fn(async () => 'APPROVED'),
      });
      const r = await reviewer({ round: 3, prdContent: 'x', contractContent: '# contract', costUsd: 0, reviewerNoVerdictStreak: 0 });
      expect(r.verdict).toBe('APPROVED');
      expect(r.error).toBeFalsy();
      expect(r.reviewerNoVerdictStreak).toBe(0);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});

describe('B54 — reviewer 任何来源都无 verdict → 连续 N 轮中止（不空转）', () => {
  it('streak < MAX：不中止，累计 streak', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-nv-'));
    try {
      const { reviewer } = createGanContractNodes(makeEmptyResultExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readReviewerFeedback: vi.fn(async () => null), // 散文也无 verdict
      });
      const r = await reviewer({ round: 1, prdContent: 'x', contractContent: '# c', costUsd: 0, reviewerNoVerdictStreak: 0 });
      expect(r.error).toBeFalsy();
      expect(r.reviewerNoVerdictStreak).toBe(1);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it('streak 达 MAX：设 error 中止', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-nv2-'));
    try {
      const { reviewer } = createGanContractNodes(makeEmptyResultExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readReviewerFeedback: vi.fn(async () => null),
      });
      const r = await reviewer({ round: 5, prdContent: 'x', contractContent: '# c', costUsd: 0, reviewerNoVerdictStreak: MAX_NO_VERDICT_STREAK - 1 });
      expect(r.error).toBeTruthy();
      expect(r.error.node).toBe('reviewer');
      expect(r.error.message).toMatch(/no_parseable_verdict|未产出.*verdict/);
      expect(r.reviewerNoVerdictStreak).toBe(MAX_NO_VERDICT_STREAK);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});

describe('B54 — reviewerRouter error → END', () => {
  it('state.error 存在 → END（不再路由回 proposer 空转）', () => {
    expect(reviewerRouter({ error: { node: 'reviewer', message: 'x' } })).toBe(END);
  });
  it('verdict=APPROVED → END', () => {
    expect(reviewerRouter({ verdict: 'APPROVED' })).toBe(END);
  });
  it('verdict=REVISION → proposer', () => {
    expect(reviewerRouter({ verdict: 'REVISION' })).toBe('proposer');
  });
});
