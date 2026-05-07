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
  MemorySaver,
} from '@langchain/langgraph';

const execFile = promisify(execFileCb);

const VERDICT_RE = /VERDICT:\s*(APPROVED|REVISION)/i;

// 递归上限：GAN 对抗无轮次上限（budgetCapUsd 才是硬保护），但 LangGraph 默认 25 不够。
// 100 = 50 轮 propose+review 预留一倍。
export const DEFAULT_RECURSION_LIMIT = 100;

// 硬轮数保险丝（对齐 Anthropic harness-design 2026-03：实操 5-15 iter cap）
// Reviewer 连续 N 轮 REVISION 后，即使 LLM 还想 REVISE 也 force APPROVED 进 Phase B。
// 2303a935 真机验证：Round 10 仍在抠正则缝隙 meta-loop，没硬 cap 会无限。
// 可通过 HARNESS_GAN_MAX_ROUNDS env 调，默认 5（时间 API 这类小 scope 足够 3-5 轮）。
export const MAX_ROUNDS = parseInt(process.env.HARNESS_GAN_MAX_ROUNDS || '5', 10);

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
const RUBRIC_DIMENSIONS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
];

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

// 生成 Shanghai 时区 MMDDHHmm 时间戳（与 worktree-manage.sh 创建分支风格一致）。
// 用于 propose_branch 抽取失败时的 fallback：cp-MMDDHHmm-<taskIdSlice>。
export function fallbackProposeBranch(taskId, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {});
  const stamp = `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
  return `cp-${stamp}-${String(taskId || 'unknown').slice(0, 8)}`;
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
  // forcedApproval: true 表示 verdict=APPROVED 是 MAX_ROUNDS 硬 cap 强制的（Reviewer 还想 REVISE）。
  // Phase B 用这个 flag 决定是否在 Initiative 记录里标 warn（合同是勉强过，不是真共识）。
  forcedApproval: Annotation({ reducer: (_old, neu) => neu, default: () => false }),
  // proposeBranch: GAN proposer 每轮 push 到独立分支（cp-harness-propose-r{N}-{shortTask}）。
  // Reviewer APPROVED 后此值即 approved contract 的 git branch — Phase B 入库 sub-task
  // 时透传到 payload.contract_branch，供 harness-task-dispatch.js 注入 CONTRACT_BRANCH env。
  // 漏写会导致 Generator ABORT（v6 P0-final 修复点）。
  proposeBranch: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
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
    // 解析 stdout 中的 propose_branch（proposer SKILL Step 3 输出 JSON 字面量）。
    // 即使本轮被打回，先把 branch 存下；后续轮次会覆写成新 branch（reducer 取最新）。
    // APPROVED 终态时即 approved contract 的 git branch。
    const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);

    // 防御：proposer SKILL 应每轮写 sprints/task-plan.json（v7.1.0+），缺失打 warn 给下游兜底
    const taskPlanPath = path.join(worktreePath, sprintDir, 'task-plan.json');
    try {
      await access(taskPlanPath);
    } catch {
      console.warn(`[harness-gan] proposer round=${nextRound} missing ${sprintDir}/task-plan.json — inferTaskPlan 拿不到 DAG 时会 hard fail`);
    }

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
    //   3. 无论以上哪个结果，round >= MAX_ROUNDS 且非 APPROVED → force APPROVED（保险丝）
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
    // 硬轮数保险丝：即使上面判了 REVISION，round >= MAX_ROUNDS 仍 force APPROVED
    let forcedApproval = false;
    if (verdict !== 'APPROVED' && currentRound >= MAX_ROUNDS) {
      console.warn(`[harness-gan] Force-APPROVED at round=${currentRound} (MAX_ROUNDS=${MAX_ROUNDS}, source=${verdictSource}, verdict_before=${verdict}) — 硬保险丝触发，进 Phase B`);
      verdict = 'APPROVED';
      forcedApproval = true;
    }
    const patch = { costUsd: nextCost, verdict, forcedApproval };
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
    propose_branch: finalState.proposeBranch || null,
  };
}
