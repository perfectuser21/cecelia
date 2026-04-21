import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const VERDICT_RE = /VERDICT:\s*(APPROVED|REVISION)/i;

// Reviewer SKILL v4 APPROVED 时会 rename contract-draft.md → sprint-contract.md，
// 另外 multi-round worktree 被 review branch 污染时文件可能不在当前 HEAD。
// 读多个候选路径，任一命中即返回。
async function defaultReadContractFile(worktreePath, sprintDir) {
  const candidates = [
    path.join(worktreePath, sprintDir, 'contract-draft.md'),
    path.join(worktreePath, sprintDir, 'sprint-contract.md'),
  ];
  const errors = [];
  for (const p of candidates) {
    try {
      return await readFile(p, 'utf8');
    } catch (err) {
      errors.push(`${p}: ${err.code || err.message}`);
    }
  }
  // 从所有 propose/review branch 里 git show 找最新 contract-draft.md
  try {
    const { stdout } = await execFile('git', [
      '-C', worktreePath, 'log', '--all', '--pretty=format:%H', '-S', 'Sprint Contract Draft', '--', `${sprintDir}/contract-draft.md`,
    ], { timeout: 10_000 });
    const sha = String(stdout || '').split('\n')[0].trim();
    if (sha) {
      const { stdout: content } = await execFile('git', [
        '-C', worktreePath, 'show', `${sha}:${sprintDir}/contract-draft.md`,
      ], { timeout: 10_000 });
      if (content) return content;
    }
  } catch (err) {
    errors.push(`git-log-search: ${err.message}`);
  }
  throw new Error(`contract file not found in any of: ${errors.join('; ')}`);
}

function extractVerdict(stdout) {
  const m = String(stdout || '').match(VERDICT_RE);
  return m ? m[1].toUpperCase() : 'REVISION';
}

function extractFeedback(stdout) {
  const s = String(stdout || '');
  if (!s) return '';
  return s.slice(-2000);
}

function buildProposerPrompt(prdContent, feedback, round) {
  const parts = [
    '/harness-contract-proposer',
    '',
    `round: ${round}`,
    '',
    '## PRD',
    prdContent,
  ];
  if (feedback) {
    parts.push('', '## 上轮 Reviewer 反馈（必须处理）', feedback);
  }
  return parts.join('\n');
}

function buildReviewerPrompt(prdContent, contractContent, round) {
  return [
    '/harness-contract-reviewer',
    '',
    `round: ${round}`,
    '',
    '## PRD',
    prdContent,
    '',
    '## Proposer 当前合同草案',
    contractContent,
    '',
    '## 任务',
    '严格找 ≥2 个风险点；找不到才 APPROVED；否则 REVISION + 具体修改建议。',
    '输出末尾必须有 `VERDICT: APPROVED` 或 `VERDICT: REVISION`。',
  ].join('\n');
}

/**
 * Harness v2 Phase A GAN 循环（无轮次上限；budgetCapUsd 兜底）。
 *
 * @param {object} opts
 * @returns {Promise<{contract_content:string, rounds:number, cost_usd:number}>}
 */
export async function runGanContractLoop(opts) {
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken,
    budgetCapUsd = 10,
  } = opts;
  const readContractFile = opts.readContractFile || defaultReadContractFile;

  let round = 0;
  let cost = 0;
  let feedback = null;
  let contractContent = null;

  while (true) {
    round += 1;

    const proposerResult = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(prdContent, feedback, round),
      worktreePath,
      timeoutMs: 1800000, // 30min，v5 SKILL Proposer 单轮最长 15min + buffer
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(round),
        // SKILL v4 约定的 env 变量名（SKILL 用 ${SPRINT_DIR} 等，不是 HARNESS_ 前缀）
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: 'main',
        PROPOSE_ROUND: String(round),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!proposerResult || proposerResult.exit_code !== 0) {
      throw new Error(`proposer_failed: exit=${proposerResult?.exit_code} stderr=${(proposerResult?.stderr || '').slice(0, 300)}`);
    }
    cost += Number(proposerResult.cost_usd || 0);

    contractContent = await readContractFile(worktreePath, sprintDir);

    const reviewerResult = await executor({
      task: { id: taskId, task_type: 'harness_contract_review' },
      prompt: buildReviewerPrompt(prdContent, contractContent, round),
      worktreePath,
      timeoutMs: 1800000, // 30min，Reviewer 虽然一般快，但 v5 挑战深度对抗可能慢
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_contract_review',
        HARNESS_NODE: 'reviewer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_REVIEW_ROUND: String(round),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: 'main',
        REVIEW_ROUND: String(round),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!reviewerResult || reviewerResult.exit_code !== 0) {
      throw new Error(`reviewer_failed: exit=${reviewerResult?.exit_code}`);
    }
    cost += Number(reviewerResult.cost_usd || 0);

    if (cost > budgetCapUsd) {
      throw new Error(`gan_budget_exceeded: spent=${cost.toFixed(3)} cap=${budgetCapUsd}`);
    }

    const verdict = extractVerdict(reviewerResult.stdout);
    if (verdict === 'APPROVED') {
      return { contract_content: contractContent, rounds: round, cost_usd: cost };
    }
    feedback = extractFeedback(reviewerResult.stdout);
  }
}

export { extractVerdict, extractFeedback, buildProposerPrompt, buildReviewerPrompt };
