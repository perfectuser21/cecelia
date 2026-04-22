/**
 * Harness GAN Contract Graph — LangGraph 2 节点状态机
 *
 * 替代 harness-gan-loop.js 的 while(true) 裸循环。通过 PostgresSaver checkpointer
 * 实现 Brain 重启后从最后一个节点续跑（thread_id = task.id）。
 *
 * 调用路径:
 *   executor.js (harness_initiative) → runInitiative({ checkpointer })
 *     → runGanContractGraph({ ...opts, checkpointer })
 *       → app.invoke(initialState, { configurable: { thread_id: taskId } })
 *
 * 节点:
 *   proposer: 跑 /harness-contract-proposer skill，产出 contract-draft.md
 *   reviewer: 跑 /harness-contract-reviewer skill，返回 VERDICT: APPROVED|REVISION
 *
 * 条件边 (reviewer → ?):
 *   APPROVED → END
 *   REVISION → proposer (回环)
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  StateGraph,
  Annotation,
  START,
  END,
  MemorySaver,
} from '@langchain/langgraph';

const execFile = promisify(execFileCb);

const VERDICT_RE = /VERDICT:\s*(APPROVED|REVISION)/i;

// 递归上限：GAN 对抗无轮次上限（budgetCapUsd 才是硬保护），但 LangGraph 默认 25 不够。
// 100 = 50 轮 propose+review 预留一倍。
export const DEFAULT_RECURSION_LIMIT = 100;

// ── 纯函数辅助（从 harness-gan-loop.js 搬移）──────────────────────────────

export function extractVerdict(stdout) {
  const m = String(stdout || '').match(VERDICT_RE);
  return m ? m[1].toUpperCase() : 'REVISION';
}

export function extractFeedback(stdout) {
  const s = String(stdout || '');
  if (!s) return '';
  return s.slice(-2000);
}

export function buildProposerPrompt(prdContent, feedback, round) {
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

export function buildReviewerPrompt(prdContent, contractContent, round) {
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

// Reviewer SKILL v4 APPROVED 时会 rename contract-draft.md → sprint-contract.md，
// 另外 multi-round worktree 被 review branch 污染时文件可能不在当前 HEAD。
// 读多个候选路径，任一命中即返回。
export async function defaultReadContractFile(worktreePath, sprintDir) {
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

// ── LangGraph State 注解 ─────────────────────────────────────────────────

export const GanContractState = Annotation.Root({
  prdContent: Annotation({ reducer: (_old, neu) => neu, default: () => '' }),
  contractContent: Annotation({ reducer: (_old, neu) => neu, default: () => '' }),
  feedback: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  round: Annotation({ reducer: (_old, neu) => neu, default: () => 0 }),
  costUsd: Annotation({ reducer: (_old, neu) => neu, default: () => 0 }),
  verdict: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
});

// ── 节点工厂 ─────────────────────────────────────────────────────────────

/**
 * 创建 GAN 两个节点函数。
 *
 * @param {Function} executor - docker-executor.executeInDocker
 * @param {object}   ctx
 * @param {string}   ctx.taskId
 * @param {string}   ctx.initiativeId
 * @param {string}   ctx.sprintDir
 * @param {string}   ctx.worktreePath
 * @param {string}   ctx.githubToken
 * @param {number}   [ctx.budgetCapUsd=10]
 * @param {Function} [ctx.readContractFile] 测试注入
 * @returns {{ proposer: Function, reviewer: Function }}
 */
export function createGanContractNodes(executor, ctx) {
  const {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
  } = ctx;

  async function proposer(state) {
    const nextRound = (state.round || 0) + 1;
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound),
      worktreePath,
      timeoutMs: 1800000,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(nextRound),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: 'main',
        PROPOSE_ROUND: String(nextRound),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!result || result.exit_code !== 0) {
      throw new Error(`proposer_failed: exit=${result?.exit_code} stderr=${(result?.stderr || '').slice(0, 300)}`);
    }
    const contractContent = await readContractFile(worktreePath, sprintDir);
    return {
      round: nextRound,
      costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
      contractContent,
    };
  }

  async function reviewer(state) {
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_review' },
      prompt: buildReviewerPrompt(state.prdContent, state.contractContent, state.round),
      worktreePath,
      timeoutMs: 1800000,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_contract_review',
        HARNESS_NODE: 'reviewer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_REVIEW_ROUND: String(state.round),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: 'main',
        REVIEW_ROUND: String(state.round),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!result || result.exit_code !== 0) {
      throw new Error(`reviewer_failed: exit=${result?.exit_code}`);
    }
    const nextCost = (state.costUsd || 0) + Number(result.cost_usd || 0);
    if (nextCost > budgetCapUsd) {
      throw new Error(`gan_budget_exceeded: spent=${nextCost.toFixed(3)} cap=${budgetCapUsd}`);
    }
    const verdict = extractVerdict(result.stdout);
    const patch = { costUsd: nextCost, verdict };
    if (verdict !== 'APPROVED') {
      patch.feedback = extractFeedback(result.stdout);
    }
    return patch;
  }

  return { proposer, reviewer };
}

// ── Graph 组装 ─────────────────────────────────────────────────────────

function reviewerRouter(state) {
  return state.verdict === 'APPROVED' ? END : 'proposer';
}

/**
 * 组装 GAN 子图（编译前）。
 * @param {{ proposer: Function, reviewer: Function }} nodes
 * @returns {StateGraph}
 */
export function buildGanContractGraph(nodes) {
  const graph = new StateGraph(GanContractState)
    .addNode('proposer', nodes.proposer)
    .addNode('reviewer', nodes.reviewer)
    .addEdge(START, 'proposer')
    .addEdge('proposer', 'reviewer')
    .addConditionalEdges('reviewer', reviewerRouter, {
      [END]: END,
      proposer: 'proposer',
    });
  return graph;
}

/**
 * Phase A GAN 合同循环入口（LangGraph + PostgresSaver 版）。
 * 与 harness-gan-loop.runGanContractLoop 保持一致返回形状。
 *
 * @param {object} opts
 * @param {string} opts.taskId              作为 langgraph thread_id
 * @param {string} opts.initiativeId
 * @param {string} opts.sprintDir
 * @param {string} opts.prdContent
 * @param {Function} opts.executor          docker-executor.executeInDocker
 * @param {string} opts.worktreePath
 * @param {string} opts.githubToken
 * @param {number} [opts.budgetCapUsd=10]
 * @param {object} [opts.checkpointer]      PostgresSaver 实例，不传走 MemorySaver
 * @param {Function} [opts.readContractFile] 测试注入
 * @param {number} [opts.recursionLimit]
 * @returns {Promise<{contract_content:string, rounds:number, cost_usd:number}>}
 */
export async function runGanContractGraph(opts) {
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken,
    budgetCapUsd = 10,
    checkpointer,
    readContractFile,
    recursionLimit = DEFAULT_RECURSION_LIMIT,
  } = opts;

  if (!taskId) throw new Error('runGanContractGraph: taskId (thread_id) required');
  if (!executor) throw new Error('runGanContractGraph: executor required');

  const nodes = createGanContractNodes(executor, {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd, readContractFile,
  });
  const graph = buildGanContractGraph(nodes);
  const app = graph.compile({ checkpointer: checkpointer || new MemorySaver() });

  const finalState = await app.invoke(
    { prdContent, round: 0, costUsd: 0, feedback: null },
    {
      configurable: { thread_id: String(taskId) },
      recursionLimit,
    }
  );

  return {
    contract_content: finalState.contractContent,
    rounds: finalState.round,
    cost_usd: finalState.costUsd,
  };
}
