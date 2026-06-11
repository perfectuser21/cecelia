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
import { readFile, readdir, access as _access } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  StateGraph,
  Annotation,
  START,
  END,
} from '@langchain/langgraph';
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { verifyContractProposerOutput } from '../lib/contract-verify.js';
// P1 治本：GAN 收敛（reviewer APPROVED）前置跑同一确定性 Contract Gate（#3348 共享库，禁复制）。
import { evaluateContractText, formatGateReport } from '../lib/contract-gate.js';
import { LLM_RETRY } from './retry-policies.js';
import { loadSkillContent, readBrainResult, ReviewerOutputSchema } from '../harness-shared.js';
import { makeSessionRecord as _makeSessionRecord } from '../harness-session-bridge.js';
import { resolveAccount } from '../spawn/middleware/account-rotation.js';

const execFile = promisify(execFileCb);

// 递归上限：GAN 对抗无轮次上限（budgetCapUsd 才是硬保护），但 LangGraph 默认 25 不够。
// 100 = 50 轮 propose+review 预留一倍。
export const DEFAULT_RECURSION_LIMIT = 100;

// proposer 连续未 push 分支的容忍上限。proposer 因账号 429/报错没产出时不 push，
// 旧代码吞掉 verifyProposer 错误继续空转（实证空转 23 轮把账号烧穿）。
// 连续 ≥ 此值即判 proposer 坏 → 带原因中止 GAN（不是轮数上限——push 成功就清零，
// 真在对抗的 GAN 仍可无限轮，符合"GAN 无硬轮数上限"设计）。
export const MAX_NO_PUSH_STREAK = 2;

// B54: reviewer 连续"未产出可解析 verdict"的容忍上限。
// 实证 bug：reviewer 把 APPROVED 写进散文 contract-review-feedback.md，但没把 verdict/rubric_scores
// 写进 brain 读的 .brain-result.json（checkpoint 实证 verdict 通道全程空）→ verdict=undefined →
// 永不 APPROVED；B52 删了强制收敛兜底阀 → 无限空转（v4 实证空转到 round6+ 才手动杀）。
// 先从散文反馈降级解析 verdict；若任何来源都拿不到，连续 ≥ 此值即带原因中止（对称 MAX_NO_PUSH_STREAK）。
// 不是轮数上限——拿到 verdict 就清零，真在对抗的 GAN 仍可无限轮。
export const MAX_NO_VERDICT_STREAK = 3;

// 设计原则（用户明确决策，勿改）：GAN 不设轮数上限，无限转直到 Reviewer 真实 APPROVED。
// 慢的解法是让 Proposer「收敛」（B52 精简纪律：合同覆盖完 PRD 即停，不发散），不是给轮数封顶。
// 仅 no-push / no-verdict streak（输出彻底坏）+ budget（成本超限）这类「真坏掉」状态才 terminal 中止。

// 7 个 rubric 维度（对齐 harness-contract-reviewer SKILL v6.4.0+）。
// ⚠️ harness::rubric-dimensions 接口约定：此数组必须与 reviewer SKILL 输出维度完全一致。
// 改 reviewer SKILL 维度 = 必须同步改这里（查 Brain registry type=harness_interface）。
const RUBRIC_DIMENSIONS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
  'verification_oracle_completeness',
  'ci_workflow_alignment',
];

// ── 收敛检测（替代旧的轮数硬 cap） ─────────────────────────────────────────
//
// 用户原话：「我希望的是他能够就是无上限地去走，但是你得最终得有一个收敛，
// 或者说你得有一个越来越小的一个方向，你不能说越来越大，越来越大」
//
// 设计：
//   - 不再用轮数硬 cap（环境变量门槛已删除）
//   - 累积每轮 rubric_scores → rubricHistory
//   - converging（7 维度全部持平或上升）→ 继续 GAN
//   - diverging（任一维度连续走低）/ oscillating（最近 3 轮高低高）→ force APPROVED + P1 alert
//   - insufficient_data（< 3 轮）→ 继续 GAN（数据不够判趋势）
//
// 输入：rubricHistory = [{round, scores: {7 维度...}, contractLines?: number}, ...]
//   contractLines（B50 新增，可选）：该轮合同行数，连续 2 轮净增长判 diverging（防膨胀）
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

  // 2.5 diverging（B50 — 合同膨胀检测）：合同行数连续 2 轮净增长（a < b < c）= "越来越大"。
  // 用户原意：不限轮数，但必须收敛（越来越小或持平），不能发散。
  // 合同逐轮膨胀且评分未全过 = 典型发散（实证 257→339→413→571 行，15 轮不收敛）。
  // 仅在三轮都有 contractLines 数据时判定（旧 history 无此字段则跳过，向后兼容）。
  const la = Number(a.contractLines);
  const lb = Number(b.contractLines);
  const lc = Number(c.contractLines);
  if (![la, lb, lc].some((n) => Number.isNaN(n)) && la < lb && lb < lc) {
    return 'diverging';
  }

  // 3. converging：最近 2 轮（b→c）7 维度全部 ≥ 上一轮（持平算 OK）
  const lastPairOk = RUBRIC_DIMENSIONS.every((dim) => {
    const vb = Number(b.scores[dim]);
    const vc = Number(c.scores[dim]);
    if (Number.isNaN(vb) || Number.isNaN(vc)) return false;
    return vc >= vb;
  });
  if (lastPairOk) return 'converging';

  // 兜底（7 维度有升有降但没有任一维度持续走低/震荡）
  return 'converging';
}

// 阈值固定 7（对齐 reviewer SKILL v6.4.0+ changelog: 单轮阈值固定 7，不随轮次放宽）。
export function thresholdForRound(_round) {
  return 7;
}

// 根据 rubric scores 和 round 计算权威 verdict（代码判 PASS，不信 LLM 文字）
// 所有 7 维度 ≥ 阈值 → APPROVED；任一低于 → REVISION。
// scores 缺失或维度不完整 → null（调用方 fallback 到 LLM 文本 verdict）。
// 对齐 Anthropic：each criterion has hard threshold, PASS is code-decided.
// RUBRIC_DIMENSIONS 在文件顶部定义（与 detectConvergenceTrend 共用）。
export function computeVerdictFromRubric(scores, round) {
  if (!scores || typeof scores !== 'object') return null;
  const threshold = thresholdForRound(round);
  const nums = RUBRIC_DIMENSIONS.map((k) => {
    const v = scores[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    // ci_workflow_alignment 是 optional 字段，缺失时默认 10（N/A=pass）
    if (k === 'ci_workflow_alignment') return 10;
    return null;
  });
  if (nums.some((n) => n === null)) return null; // 其他必填维度缺失
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
    path.join(worktreePath, sprintDir, 'contract.md'),
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
  // B56: sprints/ 根目录 fallback — sprintDir 可能被误算（如 sprints/tests，合同实际在 sprints/）。
  // 不信任传入的 sprintDir，从 worktree 的 sprints/ 根起扫根+所有子目录找合同，以文件实际位置为准。
  // 防御 sprintDir 多源不一致：不管哪个源算错，合同在哪就读哪。
  try {
    const sprintsRoot = path.join(worktreePath, 'sprints');
    for (const name of ['contract-draft.md', 'sprint-contract.md', 'contract.md']) {
      try {
        return await readFile(path.join(sprintsRoot, name), 'utf8');
      } catch { /* keep scanning */ }
    }
    const rootEntries = await readdir(sprintsRoot, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      for (const name of ['contract-draft.md', 'sprint-contract.md']) {
        try {
          return await readFile(path.join(sprintsRoot, entry.name, name), 'utf8');
        } catch { /* keep scanning */ }
      }
    }
  } catch { /* sprints/ root not found */ }
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

// B59-idem: 查某一轮 propose 分支上是否已 push 合同（proposer 幂等门用）。
// fetch 分支后 git show contract-draft.md / sprint-contract.md；存在返回内容，否则 null（不抛）。
// 让 proposer 节点在 LLM_RETRY 重试时识别"本轮已成功"，跳过重复 spawn。
export async function defaultReadContractFromBranch(worktreePath, branch, sprintDir) {
  try {
    await execFile('git', ['-C', worktreePath, 'fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`],
      { timeout: 30_000 });
  } catch {
    return null; // 分支还不存在 = 本轮还没产出
  }
  for (const name of ['contract-draft.md', 'sprint-contract.md']) {
    try {
      const { stdout } = await execFile('git',
        ['-C', worktreePath, 'show', `origin/${branch}:${sprintDir}/${name}`],
        { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 });
      if (stdout && stdout.trim()) return stdout;
    } catch { /* 该文件不在此分支，试下一个 */ }
  }
  return null;
}

// B54: 从 reviewer 散文反馈 contract-review-feedback.md 降级解析 verdict。
// reviewer 偶发没把 verdict/rubric_scores 写进 brain 读的 .brain-result.json（结构化通道空），
// 但可靠把决定写进散文反馈文件（如 `**verdict**: APPROVED` / `## VERDICT: REVISION`）。
// 结构化 verdict 缺失时用此兜底，避免 reviewer 真实决定丢失导致 GAN 永不收敛。
// 找不到文件/无 verdict 标记 → 返回 null（不抛）。
export async function defaultReadReviewerFeedbackVerdict(worktreePath, sprintDir) {
  const candidates = [
    path.join(worktreePath, sprintDir, 'contract-review-feedback.md'),
    path.join(worktreePath, sprintDir, 'review-feedback.md'),
  ];
  for (const p of candidates) {
    let content;
    try {
      content = await readFile(p, 'utf8');
    } catch {
      continue;
    }
    // 匹配 `**verdict**: APPROVED` / `## VERDICT: REVISION` / `verdict：APPROVED` 等
    const m = content.match(/(?:#{1,4}\s*)?\**\s*verdict\s*\**\s*[:：]\s*\**\s*\(?\s*(APPROVED|REVISION)/i);
    if (m) return m[1].toUpperCase();
  }
  return null;
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
  // proposerNoPushStreak: proposer 连续"没 push 分支"的次数。proposer 因 429/报错没产出时
  // verifyProposer 抛错，旧代码 .catch 吞掉继续空转（实证空转 23 轮把账号烧穿）。
  // 累计 ≥ MAX_NO_PUSH_STREAK 即判 proposer 坏（多半账号限流/报错）→ 带原因中止 GAN。
  // 正常 push 成功则清零。
  proposerNoPushStreak: Annotation({ reducer: (_old, neu) => neu, default: () => 0 }),
  // B54: reviewer 连续"未产出可解析 verdict"的次数。拿到 verdict 清零，达 MAX_NO_VERDICT_STREAK 中止。
  reviewerNoVerdictStreak: Annotation({ reducer: (_old, neu) => neu, default: () => 0 }),
  // error: 节点设置后，graph 路由到 END（中止），上层据此判 GAN 失败。
  error: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
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

// 注：原 defaultCleanupContainer（#3230/#3234 的 spawn 前 docker rm）已删除。
// 根治改为容器名唯一化（docker-executor.containerName 加随机后缀），同 task 多轮
// 容器名互不相同，不再撞名（exit 125），自然也无需 spawn 前清理。

export function createGanContractNodes(executor, ctx) {
  const {
    taskId, initiativeId, sprintDir, worktreePath, githubToken, baseRepo,
    plannerOutput = '',
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
    fetchOriginFile: _fetchOriginFile = fetchAndShowOriginFile,
    verifyProposer = verifyContractProposerOutput,
    readReviewerFeedback = defaultReadReviewerFeedbackVerdict,
    readContractFromBranch = defaultReadContractFromBranch,
    heartbeatFn = null,
  } = ctx;
  // _fetchOriginFile 保留 ctx 兼容旧 caller（test 仍传 fetchOriginFile），H15 后 proposer 改走 verifyProposer。
  void _fetchOriginFile;
  // planner SKILL 推到 cp-MMDDHHM-harness-prd，从 plannerOutput 提取；fallback 'main'（本地 cat 兜底）
  // B47: 优先从 planner verdict JSON 的 planner_branch 字段读（B46 SKILL 新增），regex 作 fallback
  const plannerBranchFromJson = plannerOutput.match(/"planner_branch"\s*:\s*"([^"]+)"/)?.[1];
  const plannerBranch = plannerBranchFromJson
    || plannerOutput.match(/cp-[0-9]+-harness-prd/)?.[0]
    || 'main';

  async function proposer(state) {
    const nextRound = (state.round || 0) + 1;
    const computedBranch = `cp-harness-propose-r${nextRound}-${taskId.slice(0, 8)}`;

    // B59-idem 幂等门：proposer 节点配 retryPolicy=LLM_RETRY(maxAttempts=3)，节点内偶发 throw
    // 会让 LangGraph 重试整节点 → 重复 spawn LLM 容器（实证每轮 2-3 个，纯浪费）。
    // 若本轮 computedBranch 已有合同（上次 attempt 已成功 push），直接复用、跳过 executor，
    // 让重试变廉价。无合同 / 出错 → 正常 spawn。
    const existingContract = await readContractFromBranch(
      worktreePath, computedBranch, sprintDir, { githubToken }
    ).catch(() => null);
    if (existingContract) {
      console.log(`[harness-gan] proposer round ${nextRound} 合同已存在于 ${computedBranch}，跳过重 spawn（B59-idem 幂等）`);
      return {
        round: nextRound,
        costUsd: state.costUsd || 0,
        contractContent: existingContract,
        proposeBranch: computedBranch,
        proposerNoPushStreak: 0,
      };
    }

    // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
    const { unlink } = await import('node:fs/promises');
    try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 首轮不存在，忽略 */ }

    const acctOpts = { task: { id: taskId, task_type: 'harness_contract_propose' }, env: {} };
    try { await resolveAccount(acctOpts, { taskId }); } catch { /* non-blocking */ }

    // B44 fix: 改回阻塞 executor（WS3 async 已回退，根因 propose_branch 丢失）
    const hbTimer = heartbeatFn
      ? setInterval(() => { heartbeatFn().catch(() => {}); }, 60_000)
      : null;
    let result;
    try {
      result = await executor({
        task: { id: taskId, task_type: 'harness_contract_propose' },
        prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound, computedBranch),
        worktreePath,
        env: {
          ...acctOpts.env,
          CECELIA_TASK_TYPE: 'harness_contract_propose',
          HARNESS_NODE: 'proposer',
          HARNESS_SPRINT_DIR: sprintDir,
          HARNESS_INITIATIVE_ID: initiativeId,
          HARNESS_PROPOSE_ROUND: String(nextRound),
          TASK_ID: taskId,
          SPRINT_DIR: sprintDir,
          PLANNER_BRANCH: plannerBranch,
          PROPOSE_ROUND: String(nextRound),
          PROPOSE_BRANCH: computedBranch,
          GITHUB_TOKEN: githubToken,
        },
      });
    } finally {
      if (hbTimer) clearInterval(hbTimer);
    }

    if (result.exit_code !== 0 || result.timed_out) {
      throw new Error(`proposer_failed: exit=${result.exit_code}`);
    }

    const contractContent = await readContractFile(worktreePath, sprintDir);
    const resultData = await readBrainResult(worktreePath, ['propose_branch']).catch(() => ({}));
    const proposeBranch = resultData.propose_branch || computedBranch;

    // verifyProposer 失败 = proposer 这轮没把【合同】push 到 origin 分支（多半账号 429/报错没产出）。
    // 验的是合同产物（contract-draft.md/sprint-contract.md），不是 task-plan.json —— task-plan.json
    // 是 GAN 收敛后 inferTaskPlanNode 才读的下游产物（有 B32 兜底），合同才是每轮真实交付物。
    // 旧代码 .catch 吞掉错误照常返回旧合同，导致 reviewer 审旧合同 → REVISION → 再空转，
    // 实证空转 23 轮把 account2 烧穿。改为：累计连续未 push，达上限即带原因中止（route END）。
    let pushOk = true;
    let pushErr = '';
    await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo, githubToken }).catch(err => {
      pushOk = false;
      pushErr = err.message;
      console.warn(`[harness-gan] verifyProposer failed: ${err.message}`);
    });

    const noPushStreak = pushOk ? 0 : (state.proposerNoPushStreak || 0) + 1;
    if (!pushOk && noPushStreak >= MAX_NO_PUSH_STREAK) {
      const msg = `proposer_repeatedly_didnt_push: 连续 ${noPushStreak} 轮未 push 分支（疑似账号 429/报错，proposer 无产出）— ${pushErr}`;
      console.error(`[harness-gan][ABORT] ${msg}`);
      return {
        round: nextRound,
        costUsd: state.costUsd || 0,
        proposerNoPushStreak: noPushStreak,
        // terminal:true — 熔断（硬停），配合 B58 resume 钩子第一次中止即 failed，不再消耗满 cap
        error: { node: 'proposer', message: msg, terminal: true },
      };
    }

    return {
      round: nextRound,
      costUsd: state.costUsd || 0,
      contractContent,
      proposeBranch,
      proposerNoPushStreak: noPushStreak,
    };
  }

  async function reviewer(state) {
    // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
    const { unlink } = await import('node:fs/promises');
    try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 忽略 */ }

    const currentRound = state.round || 0;

    const acctOpts = { task: { id: taskId, task_type: 'harness_contract_review' }, env: {} };
    try { await resolveAccount(acctOpts, { taskId }); } catch { /* non-blocking */ }

    // B44 fix: 改回阻塞 executor（WS3 async 已回退）
    const hbTimer = heartbeatFn
      ? setInterval(() => { heartbeatFn().catch(() => {}); }, 60_000)
      : null;
    let result;
    try {
      result = await executor({
        task: { id: taskId, task_type: 'harness_contract_review' },
        prompt: buildReviewerPrompt(state.prdContent, state.contractContent, currentRound),
        worktreePath,
        env: {
          ...acctOpts.env,
          CECELIA_TASK_TYPE: 'harness_contract_review',
          HARNESS_NODE: 'reviewer',
          HARNESS_SPRINT_DIR: sprintDir,
          HARNESS_INITIATIVE_ID: initiativeId,
          HARNESS_REVIEW_ROUND: String(currentRound),
          TASK_ID: taskId,
          SPRINT_DIR: sprintDir,
          PLANNER_BRANCH: plannerBranch,
          REVIEW_ROUND: String(currentRound),
          GITHUB_TOKEN: githubToken,
        },
      });
    } finally {
      if (hbTimer) clearInterval(hbTimer);
    }

    if (result.exit_code !== 0 || result.timed_out) {
      throw new Error(`reviewer_failed: exit=${result.exit_code}`);
    }

    const costAfterSpawn = state.costUsd || 0;
    if (costAfterSpawn > budgetCapUsd) {
      // 预算熔断（硬停）：return error 走 finalState.error→ganAborted 统一路径并带 terminal:true，
      // 而不是裸 throw（裸 throw 不带 terminal，会被当 transient 让 cap 兜底无谓重启）。
      const msg = `gan_budget_exceeded: spent=${costAfterSpawn.toFixed(3)} cap=${budgetCapUsd}`;
      console.error(`[harness-gan][ABORT] ${msg}`);
      return {
        costUsd: costAfterSpawn,
        error: { node: 'reviewer', message: msg, terminal: true },
      };
    }

    let resultData = await readBrainResult(worktreePath, ['verdict', 'rubric_scores', 'feedback']).catch(() => ({}));
    const rawData = resultData;
    const hasRubricData = rawData.rubric_scores &&
      typeof rawData.rubric_scores === 'object' &&
      Object.keys(rawData.rubric_scores).length > 0;

    if (hasRubricData) {
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
    const _verdictSource = rubricVerdict ? 'rubric' : 'file_verdict'; // B52: 保留供诊断，前缀 _ 避免 eslint unused-var
    if (rubricVerdict && rubricVerdict !== resultData.verdict) {
      console.warn(`[harness-gan] round=${currentRound} rubric_verdict=${rubricVerdict} ≠ file_verdict=${resultData.verdict} — 按 rubric 判（代码权威）`);
    }

    // B54: 结构化 verdict 缺失（reviewer 没把 verdict/rubric_scores 写进 brain 读的 .brain-result.json，
    // checkpoint 实证 verdict 通道全程空）→ 两级降级兜底：
    // 1. stdout JSON 提取（B55：reviewer stdout 有完整 JSON 但未写文件时直接用，避免重跑容器）
    // 2. 散文反馈 contract-review-feedback.md（B54 原逻辑）
    if (verdict !== 'APPROVED' && verdict !== 'REVISION') {
      // B55: reviewer stdout 里分别提取 verdict 字段 + rubric_scores 对象，避免解析完整外层 JSON
      const stdoutVerdictMatch = (result.stdout || '').match(/"verdict"\s*:\s*"(APPROVED|REVISION)"/);
      const stdoutRubricMatch  = (result.stdout || '').match(/"rubric_scores"\s*:\s*(\{[^}]+\})/);
      if (stdoutVerdictMatch && stdoutRubricMatch) {
        try {
          const extractedRubric = JSON.parse(stdoutRubricMatch[1]);
          if (extractedRubric && Object.keys(extractedRubric).length > 0) {
            const extractedVerdict = computeVerdictFromRubric(extractedRubric, currentRound) || stdoutVerdictMatch[1];
            if (extractedVerdict === 'APPROVED' || extractedVerdict === 'REVISION') {
              verdict = extractedVerdict;
              resultData = { ...resultData, rubric_scores: extractedRubric };
              console.warn(`[harness-gan] round=${currentRound} B55: 从 stdout 提取 verdict=${verdict}，跳过 retry`);
            }
          }
        } catch { /* rubric JSON 格式异常，继续走下一级 fallback */ }
      }
    }
    if (verdict !== 'APPROVED' && verdict !== 'REVISION') {
      const proseVerdict = await readReviewerFeedback(worktreePath, sprintDir).catch(() => null);
      if (proseVerdict) {
        console.warn(`[harness-gan] round=${currentRound} 结构化 verdict 缺失，从 contract-review-feedback.md 降级解析 verdict=${proseVerdict}`);
        verdict = proseVerdict;
      }
    }

    // B52: 记录本轮合同行数 + 趋势（仅用于诊断日志，不再强制 APPROVED）
    // 原 B50 forced-approval 逻辑已移除：GAN 无限跑直到 Reviewer 真实 APPROVED。
    // 强制收敛是 Proposer 漂移的应急阀，根因修复见 harness-contract-proposer B52 精简纪律。
    const contractLines = (state.contractContent || '').split('\n').length;
    const newHistoryEntry = rubricScores ? { round: currentRound, scores: rubricScores, contractLines } : null;
    const combinedHistory = newHistoryEntry
      ? [...(state.rubricHistory || []), newHistoryEntry]
      : (state.rubricHistory || []);
    const trend = detectConvergenceTrend(combinedHistory);
    if (verdict !== 'APPROVED' && (trend === 'diverging' || trend === 'oscillating')) {
      // 诊断日志保留，但不再强制通过 — Proposer B52 精简纪律应防止到达此状态
      console.warn(`[harness-gan][DIAG] GAN ${trend} at round=${currentRound} (verdict=${verdict}, history_len=${combinedHistory.length}) — Proposer 应收敛，不强制 APPROVED`);
    }

    // B54 防御纵深：任何来源（rubric / file_verdict / 散文反馈）都拿不到可解析 verdict =
    // reviewer 输出彻底坏。累计连续失败，达上限即带原因中止 GAN，而不是默默当 REVISION 无限空转
    // （对称 proposerNoPushStreak / #3229）。拿到干净 verdict 就清零，真在对抗的 GAN 仍可无限轮。
    const cleanVerdict = (verdict === 'APPROVED' || verdict === 'REVISION') ? verdict : null;
    const noVerdictStreak = cleanVerdict ? 0 : (state.reviewerNoVerdictStreak || 0) + 1;
    if (!cleanVerdict && noVerdictStreak >= MAX_NO_VERDICT_STREAK) {
      const msg = `reviewer_no_parseable_verdict: 连续 ${noVerdictStreak} 轮 reviewer 未产出可解析 verdict（.brain-result.json 缺 verdict/rubric_scores 且 contract-review-feedback.md 无 verdict 标记）`;
      console.error(`[harness-gan][ABORT] ${msg}`);
      return {
        costUsd: costAfterSpawn,
        reviewerNoVerdictStreak: noVerdictStreak,
        // terminal:true — 熔断（硬停），配合 B58 resume 钩子第一次中止即 failed，不再消耗满 cap
        error: { node: 'reviewer', message: msg, terminal: true },
      };
    }

    // P1 治本：reviewer 判 APPROVED 后、GAN 退出之前，对合同产物跑同一确定性 Contract Gate
    // （#3348 共享库）。命中 = 合同含弱断言/作弊/缺工具的硬红线 → 不退出 GAN，verdict 改 REVISION，
    // 把命中清单作为 feedback 拼进下一轮 proposer 输入（走现有 REVISION 回环），proposer 修合同。
    // 这样弱合同根本到不了 generator（治本）。gate 命中是确定性反馈（行号+规则名），proposer
    // 一两轮内应修掉——GAN 无轮数上限是刻意设计，但 gate 命中不是轮数问题。
    // gate 执行异常 → fail-open，不阻塞 GAN 收敛（语义判断仍归 reviewer）。
    // 只对确定性红线（作弊/弱断言/缺工具/域规则）拦截，排除 structural/no-assertion 元规则：
    // GAN 阶段合同的验收脚本可能在外部 tests/ 文件里（contract-draft.md 不内联 bash），
    // 此时 structural/no-assertion 是格式误报；"无可验收断言"由 evaluator 阶段读 contract-dod.md 兜底。
    let gateFeedback = '';
    if (verdict === 'APPROVED' && state.contractContent) {
      try {
        const cg = evaluateContractText(state.contractContent);
        const blockHits = (cg.hits || []).filter(
          (h) => !h.exempted && h.ruleId !== 'structural/no-assertion'
        );
        const blockEnv = (cg.envMissing || []).filter((e) => !e.exempted);
        if (blockHits.length || blockEnv.length) {
          const report = formatGateReport(
            { hits: blockHits, exemptions: [], envMissing: blockEnv },
            `${sprintDir}/contract-draft.md`
          ).slice(0, 1200);
          gateFeedback =
            '## 确定性 Contract Gate 命中（合同硬红线，必须修复，非主观意见）\n' + report;
          console.warn(`[harness-gan] round=${currentRound} Contract Gate 命中 → 不退出 GAN，verdict 改 REVISION 打回 proposer 修合同：\n${gateFeedback}`);
          verdict = 'REVISION';
        }
      } catch (gateErr) {
        console.warn(`[harness-gan] Contract Gate 执行异常（fail-open，不阻塞收敛）：${gateErr.message}`);
      }
    }

    const patch = {
      costUsd: costAfterSpawn,
      verdict,
      forcedApproval: false,
      reviewerNoVerdictStreak: noVerdictStreak,
    };
    if (newHistoryEntry) patch.rubricHistory = [newHistoryEntry];
    // verdict 非 APPROVED 时回传 feedback：gate 命中清单优先（确定性红线），再拼 reviewer 散文反馈。
    if (verdict !== 'APPROVED') {
      patch.feedback = [gateFeedback, resultData.feedback].filter(Boolean).join('\n\n') || '';
    }
    return patch;
  }

  return { proposer, reviewer };
}

// ── Graph 组装 ─────────────────────────────────────────────────────────

export function reviewerRouter(state) {
  // B54: reviewer 设了 error（连续无可解析 verdict 中止）→ END，不再路由回 proposer 空转。
  if (state.error) return END;
  return state.verdict === 'APPROVED' ? END : 'proposer';
}

// proposer 后路由：error 已设（proposer 连续没 push）则中止到 END，否则正常进 reviewer。
function proposerRouter(state) {
  return state.error ? END : 'reviewer';
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
    .addConditionalEdges('proposer', proposerRouter, {
      [END]: END,
      reviewer: 'reviewer',
    })
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
 * GAN 合同循环入口（同步版，B44 fix 回退 WS3 async）。
 * 不再阻塞等 GAN 完成，而是 invoke 到第一次 interrupt 就返回。
 * GAN 推进完全靠 callback resume 驱动（harness-thread-lookup dispatcher）。
 */
export async function runGanContractGraph(opts) {
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken, baseRepo,
    plannerOutput = '',
    budgetCapUsd = 10,
    checkpointer,
    readContractFile,
    fetchOriginFile,
    recursionLimit = DEFAULT_RECURSION_LIMIT,
    heartbeatFn = null,
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
    plannerOutput, budgetCapUsd, readContractFile, fetchOriginFile,
    heartbeatFn,
  });
  const graph = buildGanContractGraph(nodes);
  const app = graph.compile({ checkpointer, durability: 'sync' });

  // B44 fix: 同步等 GAN 完整跑完再返回（WS3 async 已回退，根因 propose_branch 丢失）
  const finalState = await app.invoke(
    { prdContent, round: 0, costUsd: 0, feedback: null },
    {
      configurable: { thread_id: String(taskId) },
      recursionLimit,
    }
  );
  // proposer 连续没 push 被中止：带原因抛错，让上层 runGanLoopNode 标 GAN 失败，
  // 而不是返回一个"verdict=APPROVED 的空合同"误导后续 Generator。
  if (finalState.error) {
    const e = new Error(finalState.error.message || 'gan_aborted');
    e.ganAborted = true;
    e.node = finalState.error.node || 'proposer';
    // 把熔断点标的 terminal 带到抛出的 error 上，供 runGanLoopNode 写进 checkpoint error.terminal
    e.terminal = finalState.error.terminal === true;
    throw e;
  }

  return {
    contract_content: finalState.contractContent || '',
    propose_branch: finalState.proposeBranch || null,
    rounds: finalState.round || 0,
    cost_usd: finalState.costUsd || 0,
    verdict: finalState.verdict || 'APPROVED',
    forced_approval: finalState.forcedApproval || false,
  };
}

