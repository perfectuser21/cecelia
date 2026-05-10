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
import { readFile, access } from 'node:fs/promises';
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

const execFile = promisify(execFileCb);

const VERDICT_RE = /VERDICT:\s*(APPROVED|REVISION)/i;

// 递归上限：GAN 对抗无轮次上限（budgetCapUsd 才是硬保护），但 LangGraph 默认 25 不够。
// 100 = 50 轮 propose+review 预留一倍。
export const DEFAULT_RECURSION_LIMIT = 100;

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

// ── 纯函数辅助（从 harness-gan-loop.js 搬移）──────────────────────────────

export function extractVerdict(stdout) {
  const m = String(stdout || '').match(VERDICT_RE);
  return m ? m[1].toUpperCase() : 'REVISION';
}

// Round-based 阈值（对齐 Anthropic harness-design 2026-03 "each criterion has a hard threshold"）
// Round 1-2 严格（7 分），Round 3-4 放宽（6 分），给 Reviewer 识别收敛但仍严肃的空间。
export function thresholdForRound(round) {
  if (round <= 2) return 7;
  return 6; // Round 3+
}

// 从 Reviewer stdout 里解析 rubric_scores JSON（SKILL v7 产出格式）
// 支持两种：
//   1. final JSON 字面量：{"verdict":..., "rubric_scores":{"dod_machineability":X,...}, ...}
//   2. markdown code fence：```json\n{"dod_machineability":X,...}\n```
// 找不到或解析失败 → 返回 null，调用方 fallback 到 LLM 文本 verdict。
export function extractRubricScores(stdout) {
  const s = String(stdout || '');
  // 优先匹配含 rubric_scores 嵌套的 final JSON
  const finalJsonRe = /\{[^{}]*"rubric_scores"\s*:\s*(\{[^{}]+\})[^{}]*\}/;
  const mFinal = s.match(finalJsonRe);
  if (mFinal) {
    try {
      return JSON.parse(mFinal[1]);
    } catch { /* fall through */ }
  }
  // Fallback：直接找 ```json ... ``` 里含 5 维度 key 的对象
  const fenceRe = /```json\s*(\{[^`]*?"dod_machineability"[^`]*?\})\s*```/;
  const mFence = s.match(fenceRe);
  if (mFence) {
    try {
      return JSON.parse(mFence[1]);
    } catch { /* ignore */ }
  }
  return null;
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

export function extractFeedback(stdout) {
  const s = String(stdout || '');
  if (!s) return '';
  return s.slice(-2000);
}

// 从 proposer 的 stdout 提取 propose_branch（SKILL Step 3 输出 JSON 字面量）。
// 格式形如：{"verdict": "PROPOSED", "propose_branch": "cp-harness-propose-rN-XXXXXXXX", ...}
// 找不到返回 null（兜底，不抛错）。
const PROPOSE_BRANCH_RE = /"propose_branch"\s*:\s*"([^"]+)"/;
export function extractProposeBranch(stdout) {
  const m = String(stdout || '').match(PROPOSE_BRANCH_RE);
  return m ? m[1] : null;
}

// fallback：SKILL Step 4 实际 push 格式 cp-harness-propose-r{round}-{taskIdSlice}。
// 跟 SKILL push 一致，即使 stdout 漏 JSON 也能命中真实分支。
export function fallbackProposeBranch(taskId, round) {
  const taskSlice = String(taskId || 'unknown').slice(0, 8);
  const r = Number.isInteger(round) && round >= 1 ? round : 1;
  return `cp-harness-propose-r${r}-${taskSlice}`;
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
    '',
    '你是 **skeptical staff engineer**（对齐 Anthropic harness-design 2026-03：',
    '"tuning a standalone evaluator to be **skeptical** turns out to be far more tractable'
      + ' than making a generator critical of its own work"）。',
    '',
    '按以下 5 个维度**分别独立**打 0-10 分：',
    '',
    '1. **dod_machineability** (DoD 机检性)：每条 DoD 能否转成 `exit code` 命令？',
    '   10 = 全部 DoD 是 `node -e / curl / psql / npx vitest run` 等非 0 退出即判红的机检命令',
    '   0 = 全是 `echo` / `grep "..."` / 自然语言描述',
    '2. **scope_match_prd** (范围匹配 PRD)：DoD 既不超出 User Story 也不漏掉',
    '   10 = 1:1 覆盖 PRD，无额外膨胀',
    '   0 = 合同讲的事 PRD 没有，或 PRD 关键 story 没对应 DoD',
    '3. **test_is_red** (测试真红)：测试文件存在 + 未实现时必 FAIL',
    '   10 = 显式列"测试文件在 xxx，不动代码跑→exit=1 with 具体断言位置"',
    '   0 = 没列 test 文件路径，或无法判断"尚未实现时会 FAIL"',
    '4. **internal_consistency** (内部一致)：合同本身术语/字段/命令无矛盾无重复定义',
    '   10 = 每字段/命令只定义一次，引用用稳定 ID',
    '   0 = 前后定义不一致，或命令多处粘贴可能漂移',
    '5. **risk_registered** (风险登记)：Risks 栏列了且每条有 mitigation',
    '   10 = ≥ 2 条具名 risk + mitigation（含 cascade 失败对策）',
    '   0 = 无 Risks 栏，或只写"无已知风险"',
    '',
    '## 输出格式（严格遵守 — 外层代码解析 JSON 判 PASS，不信 VERDICT 文字）',
    '',
    '先输出评分块（```json fence 里 5 个 key 一个都不能少，值必须是 0-10 整数）：',
    '',
    '## RUBRIC SCORES',
    '',
    '```json',
    '{"dod_machineability": 7, "scope_match_prd": 8, "test_is_red": 6, "internal_consistency": 7, "risk_registered": 5}',
    '```',
    '',
    '然后每维度一句话证据：',
    '',
    '- **dod_machineability = 7**：[1 句话，为何不是 10 也不是 0]',
    '- **scope_match_prd = 8**：...',
    '- **test_is_red = 6**：...',
    '- **internal_consistency = 7**：...',
    '- **risk_registered = 5**：...',
    '',
    '低于阈值的具体修改建议（仅列低分维度）：',
    '',
    '**risk_registered = 5 → 目标 ≥ 7**：[具体怎么改]',
    '**test_is_red = 6 → 目标 ≥ 7**：[具体怎么改]',
    '',
    '最后一行 `VERDICT: REVISION` 或 `VERDICT: APPROVED`（代码会忽略这行按 rubric 判，留着方便人读）。',
    '',
    '## 关键约束',
    '',
    '- rubric_scores JSON 必须在 ```json fence 里，5 个 key 齐全，值 0-10 整数',
    '- 分数按上面定义**独立**给，不要自己汇总算 verdict',
    '- 不要输出"风险 1 严重性 blocker"那种旧格式',
    '- 阈值判 PASS 由代码做（Round 1-2 全 ≥ 7 / Round 3+ 全 ≥ 6）',
    '- 你的任务是**客观打分 + 精准指出低分怎么改**，不是主观判 APPROVED/REVISION',
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
    fetchOriginFile: _fetchOriginFile = fetchAndShowOriginFile,
    verifyProposer = verifyProposerOutput,
  } = ctx;
  // _fetchOriginFile 保留 ctx 兼容旧 caller（test 仍传 fetchOriginFile），H15 后 proposer 改走 verifyProposer。
  void _fetchOriginFile;

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
    // 解析 stdout 中的 propose_branch（proposer SKILL Step 3 输出 JSON 字面量）。
    // 即使本轮被打回，先把 branch 存下；后续轮次会覆写成新 branch（reducer 取最新）。
    // APPROVED 终态时即 approved contract 的 git branch。
    const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId, nextRound);

    // 防御：proposer SKILL 应每轮写 sprints/task-plan.json（v7.1.0+），缺失打 warn 给下游兜底
    const taskPlanPath = path.join(worktreePath, sprintDir, 'task-plan.json');
    try {
      await access(taskPlanPath);
    } catch {
      console.warn(`[harness-gan] proposer round=${nextRound} missing ${sprintDir}/task-plan.json — inferTaskPlan 拿不到 DAG 时会 hard fail`);
    }

    // H10/H15: brain 主动验证 proposer 容器真把 propose_branch + task-plan.json 推到 origin。
    // docker exit_code=0 ≠ 节点 success（contract enforcement 第一层）。
    // H15 重构：从 ad-hoc fetchOriginFile 改用 SSOT verifyProposerOutput（throws ContractViolation）。
    // 失败时 throw → LangGraph retryPolicy: LLM_RETRY 自动重试 3 次。
    await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir });

    return {
      round: nextRound,
      costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
      contractContent,
      proposeBranch,
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
    // Verdict 决策优先级（对齐 Anthropic harness-design 2026-03 "each criterion has hard threshold"）：
    //   1. rubric_scores 齐全 → 代码判阈值（权威 — LLM 只打分不判决）
    //   2. rubric_scores 缺失 → fallback 到 LLM 文本 "VERDICT: X"（老逻辑）
    //   3. 用 rubricHistory 走势检测 — diverging/oscillating 时 force APPROVED + P1 alert
    //      （替代旧的轮数硬 cap：不限轮数，但发散自动收敛）
    const currentRound = state.round || 0;
    const rubricScores = extractRubricScores(result.stdout);
    const rubricVerdict = computeVerdictFromRubric(rubricScores, currentRound);
    const llmTextVerdict = extractVerdict(result.stdout);
    // authoritative verdict：rubric 齐全优先，否则用 LLM 文本
    let verdict = rubricVerdict || llmTextVerdict;
    const verdictSource = rubricVerdict ? 'rubric' : 'llm_text';
    if (rubricVerdict && rubricVerdict !== llmTextVerdict) {
      console.warn(`[harness-gan] round=${currentRound} rubric_verdict=${rubricVerdict} ≠ llm_text=${llmTextVerdict} — 按 rubric 判（代码权威）`);
    }

    // 收敛检测：把当前轮 scores 拼到历史里，判最近 3 轮趋势。
    // - converging / insufficient_data：按上面 verdict 走（不 force）
    // - diverging / oscillating：force APPROVED + forcedApproval=true + P1 alert
    const newHistoryEntry = rubricScores ? { round: currentRound, scores: rubricScores } : null;
    const combinedHistory = newHistoryEntry
      ? [...(state.rubricHistory || []), newHistoryEntry]
      : (state.rubricHistory || []);
    const trend = detectConvergenceTrend(combinedHistory);
    let forcedApproval = false;
    if (verdict !== 'APPROVED' && (trend === 'diverging' || trend === 'oscillating')) {
      console.warn(`[harness-gan][P1] GAN ${trend} at round=${currentRound} — force APPROVED 进 Phase B (verdict_before=${verdict}, source=${verdictSource}, history_len=${combinedHistory.length})`);
      verdict = 'APPROVED';
      forcedApproval = true;
    }

    const patch = { costUsd: nextCost, verdict, forcedApproval };
    if (newHistoryEntry) {
      // reducer 会 append，所以 patch 给单条新 entry。
      patch.rubricHistory = [newHistoryEntry];
    }
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
 * @param {number} [opts.budgetCapUsd=10]
 * @param {object} opts.checkpointer        PostgresSaver 实例（必填）。v1.229.0 起删除 MemorySaver fallback：
 *                                          PG 缺失必须 fail-fast，避免 brain 重启 state 丢光导致 ghost task。
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
    fetchOriginFile,
    recursionLimit = DEFAULT_RECURSION_LIMIT,
  } = opts;

  if (!taskId) throw new Error('runGanContractGraph: taskId (thread_id) required');
  if (!executor) throw new Error('runGanContractGraph: executor required');
  if (!checkpointer) {
    throw new Error(
      "runGanContractGraph: checkpointer is required (PostgresSaver). "
      + "MemorySaver fallback removed in brain v1.229.0 — "
      + "生产必须显式传 PG checkpointer 防止 brain restart 丢 state（ghost task 根因）。"
    );
  }

  const nodes = createGanContractNodes(executor, {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd, readContractFile, fetchOriginFile,
  });
  const graph = buildGanContractGraph(nodes);
  const app = graph.compile({ checkpointer, durability: 'sync' });

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
    propose_branch: finalState.proposeBranch || null,
  };
}
