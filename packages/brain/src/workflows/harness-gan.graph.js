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
import { readFile, readdir, access } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  StateGraph,
  Annotation,
  START,
  END,
} from '@langchain/langgraph';
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { verifyProposerOutput } from '../lib/contract-verify.js';
import { LLM_RETRY } from './retry-policies.js';
import { loadSkillContent, readBrainResult, ReviewerOutputSchema } from '../harness-shared.js';
import { makeSessionRecord as _makeSessionRecord } from '../harness-session-bridge.js';
import pool from '../db.js';
import { spawnDockerDetached } from '../spawn/detached.js';
import { resolveAccount } from '../spawn/middleware/account-rotation.js';
import { interrupt } from '@langchain/langgraph';

const execFile = promisify(execFileCb);

// 递归上限：GAN 对抗无轮次上限（budgetCapUsd 才是硬保护），但 LangGraph 默认 25 不够。
// 100 = 50 轮 propose+review 预留一倍。
export const DEFAULT_RECURSION_LIMIT = 100;

function buildHarnessGoalSettings(goalCondition) {
  if (!goalCondition) return null;
  return JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{
          type: 'prompt',
          prompt: `Has the following goal been achieved? Answer YES if complete, NO if not.\nGoal: ${goalCondition}\n\nCheck the current state of the workspace (files, git status) to determine if the goal is met.`,
          model: 'claude-haiku-4-5-20251001',
        }],
      }],
    },
  });
}

// 5 个 rubric 维度（reviewer 每轮独立打分；收敛检测 + 阈值判决均依赖此列表）。
const RUBRIC_DIMENSIONS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
];

// ── 收敛检测（替代旧的轮数硬 cap） ─────────────────────────────────────────
//
// 用户原话：「我希望的是他能够就是无上限地去走，但是你得最终得有一个收敛，
// 或者说你得有一个越来越小的一个方向，你不能说越来越大，越来越大」
//
// 设计：
//   - 不再用轮数硬 cap（环境变量门槛已删除）
//   - 累积每轮 rubric_scores → rubricHistory
//   - converging（5 维度全部持平或上升）→ 继续 GAN
//   - diverging（任一维度连续走低）/ oscillating（最近 3 轮高低高）→ force APPROVED + P1 alert
//   - insufficient_data（< 3 轮）→ 继续 GAN（数据不够判趋势）
//
// 输入：rubricHistory = [{round, scores: {dod_machineability, scope_match_prd, test_is_red,
//                                         internal_consistency, risk_registered}}, ...]
// 输出：'converging' | 'diverging' | 'oscillating' | 'insufficient_data'
export function detectConvergenceTrend(rubricHistory) {
  if (!Array.isArray(rubricHistory) || rubricHistory.length < 3) {
    return 'insufficient_data';
  }
  // 取最近 3 轮，缺 scores 字段也兜底（避免崩）
  const last3 = rubricHistory.slice(-3);
  const valid = last3.every((e) => e && e.scores && typeof e.scores === 'object');
  if (!valid) return 'insufficient_data';
  const [a, b, c] = last3;

  // 1. oscillating 优先：任一维度在 last3 中呈高低高 / 低高低
  for (const dim of RUBRIC_DIMENSIONS) {
    const va = Number(a.scores[dim]);
    const vb = Number(b.scores[dim]);
    const vc = Number(c.scores[dim]);
    if ([va, vb, vc].some((n) => Number.isNaN(n))) continue;
    const highLowHigh = va > vb && vc > vb;
    const lowHighLow = va < vb && vc < vb;
    if (highLowHigh || lowHighLow) return 'oscillating';
  }

  // 2. diverging：任一维度连续 2 轮严格走低（a > b > c）
  for (const dim of RUBRIC_DIMENSIONS) {
    const va = Number(a.scores[dim]);
    const vb = Number(b.scores[dim]);
    const vc = Number(c.scores[dim]);
    if ([va, vb, vc].some((n) => Number.isNaN(n))) continue;
    if (va > vb && vb > vc) return 'diverging';
  }

  // 3. converging：最近 2 轮（b→c）5 维度全部 ≥ 上一轮（持平算 OK）
  const lastPairOk = RUBRIC_DIMENSIONS.every((dim) => {
    const vb = Number(b.scores[dim]);
    const vc = Number(c.scores[dim]);
    if (Number.isNaN(vb) || Number.isNaN(vc)) return false;
    return vc >= vb;
  });
  if (lastPairOk) return 'converging';

  // 兜底（5 维度有升有降但没有任一维度持续走低/震荡）
  return 'converging';
}

// Round-based 阈值（对齐 Anthropic harness-design 2026-03 "each criterion has a hard threshold"）
// Round 1-2 严格（7 分），Round 3-4 放宽（6 分），给 Reviewer 识别收敛但仍严肃的空间。
export function thresholdForRound(round) {
  if (round <= 2) return 7;
  return 6; // Round 3+
}

// 根据 rubric scores 和 round 计算权威 verdict（代码判 PASS，不信 LLM 文字）
// 所有 5 维度 ≥ 阈值 → APPROVED；任一低于 → REVISION。
// scores 缺失或维度不完整 → null（调用方 fallback 到 LLM 文本 verdict）。
// 对齐 Anthropic：each criterion has hard threshold, PASS is code-decided.
// RUBRIC_DIMENSIONS 在文件顶部定义（与 detectConvergenceTrend 共用）。
export function computeVerdictFromRubric(scores, round) {
  if (!scores || typeof scores !== 'object') return null;
  const threshold = thresholdForRound(round);
  const nums = RUBRIC_DIMENSIONS.map((k) => {
    const v = scores[k];
    return typeof v === 'number' && !Number.isNaN(v) ? v : null;
  });
  if (nums.some((n) => n === null)) return null; // 维度不完整
  const allPass = nums.every((n) => n >= threshold);
  return allPass ? 'APPROVED' : 'REVISION';
}

/**
 * Reviewer spawn + schema 验证循环。
 * 不合格 → warn + 继续循环；budget 超 → throw gan_budget_exceeded。
 * 导出供测试使用。
 */
export async function runReviewerSchemaLoop(spawnFn, schema, budgetCap, accumulatedCost = 0) {
  while (true) {
    const raw = await spawnFn();
    accumulatedCost += Number(raw?.cost_usd || 0);

    if (accumulatedCost > budgetCap) {
      throw new Error(`gan_budget_exceeded: spent=${accumulatedCost.toFixed(3)} cap=${budgetCap}`);
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.warn(`[harness-gan] schema_mismatch, retrying: ${issues}`);
      continue;
    }

    return { ...parsed.data, cost_usd: accumulatedCost, _raw: raw };
  }
}

/**
 * Bug 6 fix: 用 inline SKILL pattern 替代 slash command + hardcoded rubric。
 * 之前 brain code hardcoded 5-dim rubric 覆盖 SKILL.md v6.2 的 7-dim → reviewer 输出 5 dim。
 * 现在直接 loadSkillContent 注入完整 SKILL，SKILL.md 是唯一 SSOT，改 SKILL 立即生效。
 */
export function buildProposerPrompt(prdContent, feedback, round, proposeBranch) {
  const skillContent = loadSkillContent('harness-contract-proposer');
  const parts = [
    '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
    '',
    skillContent,
    '',
    '---',
    '',
    `round: ${round}`,
    '',
  ];
  if (proposeBranch) {
    parts.push(
      `**重要**: PROPOSE_BRANCH="${proposeBranch}"（由 Brain 注入的确定性值，你必须使用此值作为分支名，不得修改）`,
      ''
    );
  }
  parts.push('## PRD', prdContent);
  if (feedback) {
    parts.push('', '## 上轮 Reviewer 反馈（必须处理）', feedback);
  }
  return parts.join('\n');
}

/**
 * Bug 6 fix: 同 buildProposerPrompt — inline SKILL，删 hardcoded 5-dim rubric。
 * SKILL.md v6.2 的 7-dim rubric (含 verification_oracle_completeness, behavior_count_position)
 * 现在真正传到 reviewer LLM。
 */
export function buildReviewerPrompt(prdContent, contractContent, round) {
  const skillContent = loadSkillContent('harness-contract-reviewer');
  return [
    '你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。',
    '',
    skillContent,
    '',
    '---',
    '',
    `round: ${round}`,
    '',
    '## PRD',
    prdContent,
    '',
    '## Proposer 当前合同草案',
    contractContent,
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
  // B34: defense-in-depth — planner may create sprints/{name}/ subdirectory.
  try {
    const entries = await readdir(path.join(worktreePath, sprintDir), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const name of ['contract-draft.md', 'sprint-contract.md']) {
        const p = path.join(worktreePath, sprintDir, entry.name, name);
        try {
          return await readFile(p, 'utf8');
        } catch { /* keep scanning */ }
      }
    }
  } catch { /* sprintDir doesn't exist or readdir failed */ }
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
  // forcedApproval: true 表示 verdict=APPROVED 是收敛检测（diverging/oscillating）强制的，
  // Reviewer 实际还想 REVISE。Phase B 用这个 flag 决定是否在 Initiative 记录里标 warn
  // （合同是勉强过，不是真共识）。
  forcedApproval: Annotation({ reducer: (_old, neu) => neu, default: () => false }),
  // proposeBranch: GAN proposer 每轮 push 到独立分支（cp-harness-propose-r{N}-{shortTask}）。
  // Reviewer APPROVED 后此值即 approved contract 的 git branch — Phase B 入库 sub-task
  // 时透传到 payload.contract_branch，供 harness-task-dispatch.js 注入 CONTRACT_BRANCH env。
  // 漏写会导致 Generator ABORT（v6 P0-final 修复点）。
  proposeBranch: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  // rubricHistory: 累积每轮 reviewer 的 rubric_scores，供 detectConvergenceTrend 判趋势。
  // reducer 把 patch 里的新条目 append 进 list（替代旧的轮数硬 cap）。
  // entry 形如 {round, scores: {dod_machineability, scope_match_prd, test_is_red,
  //                              internal_consistency, risk_registered}}
  rubricHistory: Annotation({
    reducer: (old = [], neu) => {
      if (!neu) return old;
      const append = Array.isArray(neu) ? neu : [neu];
      return [...old, ...append];
    },
    default: () => [],
  }),
  session_map: Annotation({
    reducer: (old, neu) => ({ ...(old ?? {}), ...(neu ?? {}) }),
    default: () => ({}),
  }),
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
    taskId, initiativeId, sprintDir, worktreePath, githubToken, baseRepo,
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
    fetchOriginFile: _fetchOriginFile = fetchAndShowOriginFile,
    verifyProposer = verifyProposerOutput,
    spawnDetached: spawnFn = spawnDockerDetached,
    poolOverride: dbPool = pool,
  } = ctx;
  // _fetchOriginFile 保留 ctx 兼容旧 caller（test 仍传 fetchOriginFile），H15 后 proposer 改走 verifyProposer。
  void _fetchOriginFile;

  async function proposer(state) {
    const nextRound = (state.round || 0) + 1;
    const computedBranch = `cp-harness-propose-r${nextRound}-${taskId.slice(0, 8)}`;

    // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
    const { unlink } = await import('node:fs/promises');
    try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 首轮不存在，忽略 */ }

    // 幂等门：已 spawn 过此轮则直接 interrupt 等 callback
    if (state.proposerContainerId && state.proposerContainerRound === nextRound) {
      const payload = interrupt({ type: 'wait_proposer_callback', containerId: state.proposerContainerId });
      return await _processProposerCallback(payload, nextRound, computedBranch, state);
    }

    const rand = crypto.randomUUID().slice(0, 8);
    const containerId = `harness-proposer-r${nextRound}-${taskId.slice(0, 8)}-${rand}`;
    const threadId = `harness-gan:${initiativeId}:proposer-r${nextRound}`;

    const acctOpts = { task: { id: taskId, task_type: 'harness_contract_propose' }, env: {} };
    try { await resolveAccount(acctOpts, { taskId }); } catch { /* non-blocking */ }

    try {
      await spawnFn({
        task: { id: taskId, task_type: 'harness_contract_propose' },
        prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound, computedBranch),
        worktreePath,
        containerId,
        env: {
          ...acctOpts.env,
          CECELIA_TASK_TYPE: 'harness_contract_propose',
          HARNESS_NODE: 'proposer',
          HARNESS_SPRINT_DIR: sprintDir,
          HARNESS_INITIATIVE_ID: initiativeId,
          HARNESS_PROPOSE_ROUND: String(nextRound),
          TASK_ID: taskId,
          SPRINT_DIR: sprintDir,
          PLANNER_BRANCH: 'main',
          PROPOSE_ROUND: String(nextRound),
          PROPOSE_BRANCH: computedBranch,
          GITHUB_TOKEN: githubToken,
          HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
          ...(buildHarnessGoalSettings('The contract-draft.md has been written and pushed to the propose branch')
            ? { CECELIA_GOAL_SETTINGS: buildHarnessGoalSettings('The contract-draft.md has been written and pushed to the propose branch') }
            : {}),
        },
      });
    } catch (err) {
      throw new Error(`proposer_spawn_failed: ${err.message}`);
    }

    try {
      await dbPool.query(
        `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
         VALUES ($1, $2, 'harness-gan', 'spawning') ON CONFLICT (container_id) DO NOTHING`,
        [containerId, threadId]
      );
    } catch (err) {
      console.warn(`[harness-gan] thread_lookup INSERT failed cid=${containerId}: ${err.message}`);
    }

    const payload = interrupt({ type: 'wait_proposer_callback', containerId });
    return await _processProposerCallback(payload, nextRound, computedBranch, state, containerId);
  }

  async function _processProposerCallback(payload, nextRound, computedBranch, state, containerId) {
    const { exit_code } = payload || {};
    if (exit_code !== 0 && exit_code !== undefined) {
      throw new Error(`proposer_failed: exit=${exit_code}`);
    }
    const contractContent = await readContractFile(worktreePath, sprintDir);
    const resultData = await readBrainResult(worktreePath, ['propose_branch']).catch(() => ({}));
    const proposeBranch = resultData.propose_branch || computedBranch;
    await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo }).catch(err => {
      console.warn(`[harness-gan] verifyProposer failed: ${err.message}`);
    });
    return {
      round: nextRound,
      costUsd: state.costUsd || 0,
      contractContent,
      proposeBranch,
      proposerContainerId: containerId || state.proposerContainerId,
      proposerContainerRound: nextRound,
    };
  }

  async function reviewer(state) {
    // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
    const { unlink } = await import('node:fs/promises');
    try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 忽略 */ }

    const currentRound = state.round || 0;

    // 幂等门：已 spawn 过此轮则直接 interrupt 等 callback
    if (state.reviewerContainerId && state.reviewerContainerRound === currentRound) {
      const payload = interrupt({ type: 'wait_reviewer_callback', containerId: state.reviewerContainerId });
      return await _processReviewerCallback(payload, currentRound, state, state.reviewerContainerId);
    }

    const rand = crypto.randomUUID().slice(0, 8);
    const containerId = `harness-reviewer-r${currentRound}-${taskId.slice(0, 8)}-${rand}`;
    const threadId = `harness-gan:${initiativeId}:reviewer-r${currentRound}`;

    const acctOpts = { task: { id: taskId, task_type: 'harness_contract_review' }, env: {} };
    try { await resolveAccount(acctOpts, { taskId }); } catch { /* non-blocking */ }

    try {
      await spawnFn({
        task: { id: taskId, task_type: 'harness_contract_review' },
        prompt: buildReviewerPrompt(state.prdContent, state.contractContent, currentRound),
        worktreePath,
        containerId,
        env: {
          ...acctOpts.env,
          CECELIA_TASK_TYPE: 'harness_contract_review',
          HARNESS_NODE: 'reviewer',
          HARNESS_SPRINT_DIR: sprintDir,
          HARNESS_INITIATIVE_ID: initiativeId,
          HARNESS_REVIEW_ROUND: String(currentRound),
          TASK_ID: taskId,
          SPRINT_DIR: sprintDir,
          PLANNER_BRANCH: 'main',
          REVIEW_ROUND: String(currentRound),
          GITHUB_TOKEN: githubToken,
          HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
          ...(buildHarnessGoalSettings('The review verdict has been written to .brain-result.json as APPROVED or REVISION')
            ? { CECELIA_GOAL_SETTINGS: buildHarnessGoalSettings('The review verdict has been written to .brain-result.json as APPROVED or REVISION') }
            : {}),
        },
      });
    } catch (err) {
      throw new Error(`reviewer_spawn_failed: ${err.message}`);
    }

    try {
      await dbPool.query(
        `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
         VALUES ($1, $2, 'harness-gan', 'spawning') ON CONFLICT (container_id) DO NOTHING`,
        [containerId, threadId]
      );
    } catch (err) {
      console.warn(`[harness-gan] thread_lookup INSERT failed cid=${containerId}: ${err.message}`);
    }

    const payload = interrupt({ type: 'wait_reviewer_callback', containerId });
    return await _processReviewerCallback(payload, currentRound, state, containerId);
  }

  async function _processReviewerCallback(payload, currentRound, state, containerId) {
    const { exit_code } = payload || {};
    if (exit_code !== 0 && exit_code !== undefined) {
      throw new Error(`reviewer_failed: exit=${exit_code}`);
    }

    const costAfterSpawn = state.costUsd || 0;
    if (costAfterSpawn > budgetCapUsd) {
      throw new Error(`gan_budget_exceeded: spent=${costAfterSpawn.toFixed(3)} cap=${budgetCapUsd}`);
    }

    // WS3 async: single spawn per round, no reconnectOrSpawn retry loop
    let resultData = await readBrainResult(worktreePath, ['verdict', 'rubric_scores', 'feedback']).catch(() => ({}));
    const rawData = resultData;
    const hasRubricData = rawData.rubric_scores &&
      typeof rawData.rubric_scores === 'object' &&
      Object.keys(rawData.rubric_scores).length > 0;

    if (hasRubricData) {
      // rubric present: single-call schema validation, no retry spawns
      const loopResult = await runReviewerSchemaLoop(
        async () => ({ ...rawData, cost_usd: 0 }),
        ReviewerOutputSchema,
        budgetCapUsd,
        0,
      ).catch(() => rawData);
      resultData = loopResult;
    }

    const rubricScores = resultData.rubric_scores;
    const rubricVerdict = computeVerdictFromRubric(rubricScores, currentRound);
    let verdict = rubricVerdict || resultData.verdict;
    const verdictSource = rubricVerdict ? 'rubric' : 'file_verdict';
    if (rubricVerdict && rubricVerdict !== resultData.verdict) {
      console.warn(`[harness-gan] round=${currentRound} rubric_verdict=${rubricVerdict} ≠ file_verdict=${resultData.verdict} — 按 rubric 判（代码权威）`);
    }

    // 收敛检测：把当前轮 scores 拼到历史里，判最近 3 轮趋势
    const newHistoryEntry = rubricScores ? { round: currentRound, scores: rubricScores } : null;
    const combinedHistory = newHistoryEntry
      ? [...(state.rubricHistory || []), newHistoryEntry]
      : (state.rubricHistory || []);
    const trend = detectConvergenceTrend(combinedHistory);
    let forcedApproval = false;
    if (verdict !== 'APPROVED' && (trend === 'diverging' || trend === 'oscillating')) {
      console.warn(`[harness-gan][P1] GAN ${trend} at round=${currentRound} — force APPROVED (verdict_before=${verdict}, verdictSource=${verdictSource}, history_len=${combinedHistory.length})`);
      verdict = 'APPROVED';
      forcedApproval = true;
    }

    const patch = {
      costUsd: costAfterSpawn,
      verdict,
      forcedApproval,
      reviewerContainerId: containerId,
      reviewerContainerRound: currentRound,
    };
    if (newHistoryEntry) patch.rubricHistory = [newHistoryEntry];
    if (verdict !== 'APPROVED') patch.feedback = resultData.feedback || '';
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
    .addNode('proposer', nodes.proposer, { retryPolicy: LLM_RETRY })
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
 * @param {string} [opts.baseRepo]            外部 repo 路径（默认 cecelia）
 * @param {number} [opts.budgetCapUsd=10]
 * @param {object} opts.checkpointer        PostgresSaver 实例（必填）。v1.229.0 起删除 MemorySaver fallback：
 *                                          PG 缺失必须 fail-fast，避免 brain 重启 state 丢光导致 ghost task。
 * @param {Function} [opts.readContractFile] 测试注入
 * @param {number} [opts.recursionLimit]
 * @returns {Promise<{contract_content:string, rounds:number, cost_usd:number}>}
 */
/**
 * 编译 GAN graph（供 callback router 的 harness-thread-lookup dispatch 使用）。
 * WS3 async: harness-gan dispatch case 在 harness-thread-lookup.js 注册此函数。
 */
export async function compileHarnessGanGraph(checkpointer) {
  const nodes = createGanContractNodes(null, {
    taskId: '__placeholder__', initiativeId: '__placeholder__',
    sprintDir: 'sprints', worktreePath: '/tmp', githubToken: '',
  });
  const graph = buildGanContractGraph(nodes);
  return graph.compile({ checkpointer, durability: 'sync' });
}

/**
 * GAN 合同循环入口（WS3 async kickoff 版）。
 * 不再阻塞等 GAN 完成，而是 invoke 到第一次 interrupt 就返回。
 * GAN 推进完全靠 callback resume 驱动（harness-thread-lookup dispatcher）。
 */
export async function runGanContractGraph(opts) {
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken, baseRepo,
    budgetCapUsd = 10,
    checkpointer,
    readContractFile,
    fetchOriginFile,
    recursionLimit = DEFAULT_RECURSION_LIMIT,
  } = opts;

  if (!taskId) throw new Error('runGanContractGraph: taskId (thread_id) required');
  if (!checkpointer) {
    throw new Error(
      "runGanContractGraph: checkpointer is required (PostgresSaver). "
      + "MemorySaver fallback removed in brain v1.229.0 — "
      + "生产必须显式传 PG checkpointer 防止 brain restart 丢 state（ghost task 根因）。"
    );
  }

  const nodes = createGanContractNodes(executor, {
    taskId, initiativeId, sprintDir, worktreePath, githubToken, baseRepo,
    budgetCapUsd, readContractFile, fetchOriginFile,
  });
  const graph = buildGanContractGraph(nodes);
  const app = graph.compile({ checkpointer, durability: 'sync' });

  // WS3 async: invoke 到第一次 interrupt 就返回（kickoff，不阻塞等 GAN 完成）
  // GAN 推进靠 callback router Command(resume) 驱动
  await app.invoke(
    { prdContent, round: 0, costUsd: 0, feedback: null },
    {
      configurable: { thread_id: String(taskId) },
      recursionLimit,
    }
  ).catch(err => {
    // interrupt() 会抛出异常被 LangGraph 捕获；非 interrupt 错误才真正抛
    if (!err?.message?.includes('interrupt') && err?.name !== 'GraphInterrupt') throw err;
  });

  // kickoff 成功，GAN 已在第一次 interrupt 挂起，等 callback resume
  return { kickoff: true, thread_id: String(taskId) };
}
