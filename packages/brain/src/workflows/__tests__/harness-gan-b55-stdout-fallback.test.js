/**
 * 回归：B55 — reviewer stdout JSON 提取 fallback。
 *
 * 实证 bug（run 5d5f3cfc，2026-06-03）：
 *   reviewer 每轮第一次调用以约 50% 概率不写 .brain-result.json（LLM 在文字里描述命令而非执行），
 *   B54 散文 fallback（contract-review-feedback.md）也未写 → streak++ → 重跑整个容器浪费 3-5 分钟。
 *
 * 修复（B55）：
 *   verdict 两级皆空时，先从 result.stdout 正则提取 JSON {"verdict":...,"rubric_scores":{...}} 再走散文 fallback。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

import { createGanContractNodes } from '../harness-gan.graph.js';

const VALID_RUBRIC = {
  dod_machineability: 8,
  scope_match_prd: 8,
  test_is_red: 8,
  internal_consistency: 8,
  risk_registered: 8,
  verification_oracle_completeness: 8,
  ci_workflow_alignment: 10,
};

// 触发 REVISION 的 rubric（scope_match_prd=5 < 7）
const REVISION_RUBRIC = { ...VALID_RUBRIC, scope_match_prd: 5 };

function makeStdoutWithVerdict(verdict, rubric = VALID_RUBRIC) {
  return `## RUBRIC SCORES\n\`\`\`json\n${JSON.stringify({ verdict, rubric_scores: rubric, feedback: '' })}\n\`\`\`\n\n## VERDICT: ${verdict}\n`;
}

function makeReviewerExecutor(worktreePath, { writeResult = false, stdout = '' } = {}) {
  return vi.fn(async () => {
    if (writeResult) {
      writeFileSync(
        path.join(worktreePath, '.brain-result.json'),
        JSON.stringify({ verdict: 'APPROVED', rubric_scores: VALID_RUBRIC, feedback: '' }),
      );
    }
    // 不写 .brain-result.json — 模拟 LLM 只输出文本未执行 Bash 工具
    return { exit_code: 0, stdout, cost_usd: 0.01 };
  });
}

async function runReviewerWithStdout(stdout) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'b55-'));
  await mkdir(path.join(tmp, 'sprints', 'test-sprint'), { recursive: true });
  await writeFile(path.join(tmp, 'sprints', 'test-sprint', 'sprint-prd.md'), '# PRD\n## 成功标准\ncurl 返回 200');
  await writeFile(path.join(tmp, 'sprints', 'test-sprint', 'contract-draft.md'), '# Contract\nStep 1: curl ok');

  const reviewerExecutor = makeReviewerExecutor(tmp, { stdout });

  const { reviewer } = createGanContractNodes(reviewerExecutor, {
    taskId: 'test-task',
    initiativeId: 'test-init',
    worktreePath: tmp,
    sprintDir: 'sprints/test-sprint',
    plannerBranch: 'cp-test',
    githubToken: 'fake-token',
    budgetCapUsd: 100,
  });

  const state = {
    round: 1,
    prdContent: '# PRD\n## 成功标准\ncurl 返回 200',
    contractContent: '# Contract\nStep 1: curl ok',
    costUsd: 0,
    reviewerNoVerdictStreak: 0,
  };

  try {
    const result = await reviewer(state);
    return { tmp, result };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

describe('B55 — reviewer stdout JSON 提取 fallback', () => {
  it('stdout 含完整 APPROVED JSON → verdict=APPROVED，不走 retry', async () => {
    const stdout = makeStdoutWithVerdict('APPROVED');
    const { result } = await runReviewerWithStdout(stdout);
    expect(result.verdict).toBe('APPROVED');
    expect(result.reviewerNoVerdictStreak).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('stdout 含 REVISION rubric（score<7）→ verdict=REVISION，streak 不涨', async () => {
    // rubric 有维度 < 7 → computeVerdictFromRubric 返回 REVISION
    const stdout = makeStdoutWithVerdict('REVISION', REVISION_RUBRIC);
    const { result } = await runReviewerWithStdout(stdout);
    expect(result.verdict).toBe('REVISION');
    expect(result.reviewerNoVerdictStreak).toBe(0);
  });

  it('stdout 无 JSON（空）→ streak=1（触发 retry）', async () => {
    const { result } = await runReviewerWithStdout('');
    expect(result.verdict).not.toBe('APPROVED');
    expect(result.reviewerNoVerdictStreak).toBe(1);
  });

  it('stdout 有 JSON 但 rubric_scores 为空对象 → 不采用，streak=1', async () => {
    const stdout = JSON.stringify({ verdict: 'APPROVED', rubric_scores: {}, feedback: '' });
    const { result } = await runReviewerWithStdout(stdout);
    expect(result.reviewerNoVerdictStreak).toBe(1);
  });
});
