/**
 * Harness Task Sub-Graph — 单 sub-task 全周期 LangGraph。
 *
 * 替代 harness-task-dispatch.js + harness-watcher.js 的 procedural CI 轮询。
 *
 * Layer 3（LangGraph 修正 Sprint）：spawn_generator 反模式（节点内 await 阻塞 5-10 分钟）
 * 重构成 spawn → interrupt → callback resume：
 *   - spawn 用 docker run -d detached，立即返回 containerId
 *   - await_callback interrupt() yield，graph state 落 PG checkpointer
 *   - cecelia-runner 容器跑完 POST /api/brain/harness/callback/:containerId
 *   - callback router 反查 thread_lookup → Command(resume={result, exit_code, stdout})
 *   - graph 从 await_callback 续跑 parse_callback / poll_ci / merge / fix
 *
 * 节点拓扑（Layer 3 后）：
 *   START
 *     → spawn                 （docker run -d，立即 return + 写 thread_lookup）
 *     → await_callback        （interrupt 等 callback resume）
 *     → parse_callback        （提取 pr_url 写 state）
 *     → conditional: 无 pr_url → END status=no_pr
 *     → poll_ci               （checkPrStatus，HARNESS_POLL_INTERVAL_MS 默认 90s，max 20 polls = 30 min）
 *     → conditional:
 *           ci_pass → merge_pr → END status=merged
 *           ci_fail → fix_dispatch (state.fix_round++ + reset containerId)
 *               → conditional: fix_round<=MAX → spawn (loop, fresh containerId)
 *                              fix_round>MAX → END status=failed
 *           ci_pending → poll_ci (loop, 内置 sleep)
 *           ci_timeout → END status=timeout
 *
 * Brain 重启 PostgresSaver thread_id=`harness-task:${initiativeId}:${subTaskId}` resume。
 * 每节点首句加幂等门防 resume 重 spawn。
 *
 * Spec: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md §3.2
 *       docs/superpowers/specs/2026-05-08-langgraph-fix-walking-skeleton.md (Layer 3 模式)
 */

import { StateGraph, Annotation, START, END, interrupt } from '@langchain/langgraph';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { runContractGate, formatGateReport } from '../lib/contract-gate.js';
// Note: legacy `spawn` import removed (Layer 3 uses spawnDockerDetached for fire-and-forget docker run -d)
import { ensureHarnessWorktree, harnessSubTaskBranchName, cleanupHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { runJudgeGate } from '../harness-judge.js';
// Note: legacy `writeDockerCallback` import removed (Layer 3 uses callback router POST → Command(resume))
import { spawnDockerDetached, spawnCodexBridgeDetached } from '../spawn/detached.js';
import { executeOnHost } from '../spawn/host-executor.js';
import { resolveExecutor as resolveExecutorDefault } from '../routing/resolve-executor.js';
import { resolveAccount } from '../spawn/middleware/account-rotation.js';
import { checkAuthFailure } from '../spawn/middleware/cap-marking.js';
import { checkPrStatus, classifyFailedChecks } from '../shepherd.js';
import { parseDockerOutput, extractField, readPrFromGitState, readVerdictFile, readBrainResult, readAndValidateBrainResult, EvaluatorOutputSchema, loadSkillContent } from '../harness-shared.js';
import { buildGeneratorPrompt, harnessContractThreadSuffix } from '../harness-utils.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import pool from '../db.js';
import { verifyGeneratorOutput } from '../lib/contract-verify.js';
import { LLM_RETRY } from './retry-policies.js';

const execFileDefault = promisify(execFileCb);

// B11 (Walking Skeleton P1 cascade): GAN reviewer 是无硬 cap + 趋势收敛（PR #2901）。
// 不对称设计：fix loop 之前硬 cap=3，3 轮没修好就 terminal_fail —— 质量优先原则下
// 这是过早放弃。W33 实证：trivial spec (GET /hello) 4 round fix 仍未让 evaluator PASS
// 不是因为真不收敛，是 3 round 给 generator 改 spec 漂移问题不够。
// 改：MAX 调到 20（实际"无 cap"等价，30 min 单 round × 20 = 10 hr，sanity 兜底防极端 spec
// 死循环占 slot；保留是因为质量优先但 brain 资源仍有限）。
// 长期：参 reviewer SKILL 用 detectConvergenceTrend（state.fix_history[] 同 fail_type 连
// 续 N 轮无 progress → 标 unconvergent_fail），独立 PR 升级。
export const MAX_FIX_ROUNDS = parseInt(process.env.HARNESS_MAX_FIX_ROUNDS || '20', 10);
export const MAX_POLL_COUNT = 20;          // 90s × 20 = 30 min
export const POLL_INTERVAL_MS = 90 * 1000;
// 无 CI check 的 PR：给几轮 grace 等 CI 注册（避免抢在 check 出现前误判），
// 仍 0 check 且 MERGEABLE → 判 pass（无 check 可等，再等也不会出现）。
export const NO_CHECKS_GRACE_POLLS = 2;

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

export function normalizeVerdict(raw) {
  const upper = raw ? String(raw).toUpperCase().trim() : '';
  return new Set(['PASS', 'FIXED', 'APPROVED']).has(upper) ? 'PASS' : 'FAIL';
}

// 任务终态集合：父图/Serial gate 把 initiative 标这些状态后，在飞子图实例必须停手。
export const TERMINAL_TASK_STATUSES = new Set(['failed', 'completed', 'cancelled', 'canceled', 'aborted', 'done']);

/**
 * 查 initiative 任务在 DB 里的终态信号。
 * P2 Issue「在飞执行不感知任务终态」实证（run cf4f596c 08:28-08:34）：initiative 已标 failed 后，
 * 其进程内图实例的 fix loop 仍每 ~2 分钟 spawn 一个 generator，直到手动重启 Brain 才停。
 * 故 spawn / fix_dispatch / evaluate 入口在起容器前查 tasks.status，已终态 → 走 END。
 *
 * fail-open：查不到/查询失败 → terminal=false（不误杀在飞 run），仅 warn。
 * @returns {Promise<{terminal:boolean, status?:string, initiativeId?:string}>}
 */
export async function isInitiativeTerminal(state, opts = {}) {
  const dbPool = opts.poolOverride || pool;
  const payload = state?.task?.payload || {};
  const initiativeId = state?.initiativeId || payload.parent_task_id || payload.initiative_id || state?.task?.id;
  if (!initiativeId) return { terminal: false };
  try {
    const res = await dbPool.query('SELECT status FROM tasks WHERE id = $1', [initiativeId]);
    const status = res?.rows?.[0]?.status;
    return {
      terminal: status ? TERMINAL_TASK_STATUSES.has(String(status).toLowerCase()) : false,
      status,
      initiativeId,
    };
  } catch (err) {
    console.warn(`[harness-task.graph] isInitiativeTerminal 查询失败（fail-open，继续）：${err.message}`);
    return { terminal: false };
  }
}

/**
 * sub-graph state schema
 */
export const TaskState = Annotation.Root({
  task:             Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  contractBranch:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  baseRepo:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  // H13: 防 resume 时 spawn 节点重 import contract sprints/（git fetch 已花过 quota）
  contractImported: Annotation({ reducer: (_o, n) => n, default: () => false }),
  // Layer 3: containerId 是 spawn 节点 spawn detached 容器的 docker --name，同时也是
  // walking_skeleton_thread_lookup 表 PRIMARY KEY，callback router 反查 thread_id 用。
  // fix_round loop 后 fixDispatchNode 必须 reset 让 spawn 节点重新 spawn fresh container。
  containerId:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  // Fix #3: spawn 时间戳，await_callback 总超时兜底用（独立于 docker inspect）。
  spawnedAt:        Annotation({ reducer: (_o, n) => n, default: () => null }),
  // Fix #4: executor + 远程 daemonUrl，远程 worker-daemon /health liveness 用。
  executor:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  daemonUrl:        Annotation({ reducer: (_o, n) => n, default: () => null }),
  // 根因 2（2026-06-10）: resolveAccount 选出的账号，401 callback 时 markAuthFailure 轮换用。
  accountId:        Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_url:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_branch:        Annotation({ reducer: (_o, n) => n, default: () => null }),
  fix_round:        Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  poll_count:       Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  ci_status:        Annotation({ reducer: (_o, n) => n, default: () => 'pending' }),
  ci_fail_type:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  failed_checks:    Annotation({ reducer: (_o, n) => n, default: () => [] }),
  status:           Annotation({ reducer: (_o, n) => n, default: () => 'queued' }),
  rebase_attempted: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  cost_usd:         Annotation({ reducer: (c, n) => (c || 0) + (n || 0), default: () => 0 }),
  generator_output: Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:            Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluate_verdict: Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluate_error:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  // P1: 失败分类。'contract_invalid' = Contract Gate 命中合同产物（合同本身不合格）→
  // 责任在 GAN proposer（有权改合同），generator 无权改合同 → 路由终止 initiative，不进 fix loop。
  // null = 普通实现缺陷 → 维持 generator fix loop。
  failure_class:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:       Annotation({ reducer: (_o, n) => n, default: () => null }),
});

// ──────────────────────────────────────────────────────────────────────────
// 节点

/**
 * Layer 3 spawnNode — spawn detached docker container 立即 return（不阻塞）。
 *
 * 关键差异（vs 旧 spawnGeneratorNode）：
 *   - 不 await 容器跑完 5-10 分钟；容器 detached（docker run -d）后台跑。
 *   - 立刻写 thread_lookup mapping (containerId → thread_id, graph_name='harness-task')
 *     让 callback router 收到容器 POST 后能反查 graph 续跑。
 *   - 不在这里 writeDockerCallback；callback router 收到 POST 用 Command(resume) 唤回 await_callback 节点。
 *
 * 幂等门：state.containerId 已存在 → 跳过（resume 后 graph 重跑此节点不能重 spawn）。
 *
 * @param {Object} state           TaskState
 * @param {Object} [opts]
 * @param {Function} [opts.spawnDetached]    覆盖 spawnDockerDetached（测试用）
 * @param {Function} [opts.spawnBridge]      覆盖 spawnCodexBridgeDetached（测试用 DI）
 * @param {Function} [opts.resolveExecutor]  覆盖 resolveExecutor（机器+执行器路由，测试用 DI）
 * @param {Function} [opts.ensureWorktree]
 * @param {Function} [opts.resolveToken]
 * @param {Object}   [opts.poolOverride]     覆盖 pg pool（测试用）
 */
export async function spawnNode(state, opts = {}) {
  // 幂等门 1：已 spawn 过容器就直接 passthrough（防 resume 时重 spawn）
  if (state.containerId) return { containerId: state.containerId };

  // 终态门（P2「在飞执行不感知任务终态」）：起容器前查 initiative 是否已被标终态。
  // 已 failed/completed → 直接走 END（写明确终态 status='aborted'，与问题1 END 终态口径一致），
  // 不再起 generator（run cf4f596c 实证：initiative failed 后 fix loop 仍每 ~2 分钟 spawn）。
  const checkTerminal = opts.isInitiativeTerminal || isInitiativeTerminal;
  const term0 = await checkTerminal(state, opts);
  if (term0.terminal) {
    console.warn(`[spawn] initiative ${term0.initiativeId} 已终态 status=${term0.status} → 中止 spawn，不再起 generator`);
    return { status: 'aborted', error: { node: 'spawn', message: `initiative already terminal (status=${term0.status}); abort generator spawn` } };
  }

  const spawnFn = opts.spawnDetached || spawnDockerDetached;
  const ensureWt = opts.ensureWorktree || ensureHarnessWorktree;
  const resolveTok = opts.resolveToken || resolveGitHubToken;
  const dbPool = opts.poolOverride || pool;
  const execFile = opts.execFile || execFileDefault;

  const task = state.task;
  const payload = task?.payload || {};
  const initiativeId = state.initiativeId || payload.parent_task_id || payload.initiative_id || task?.id;
  const fixRound = state.fix_round || 0;
  const fixMode = fixRound > 0;

  // Fix #6: 提前生成 finalContainerId，让任何 catch 块都能带上 containerId 返回。
  // 永挂 debug 实证：catch 返回 {error} 不带 containerId → brain 日志 grep 不到任何
  // containerId，无法反查/清理西安远程容器（可能已起）。containerId 必须唯一
  // （fix_round loop 重 spawn 不撞 docker --name）：harness-task-<safeId>-r<round>-<rand8>。
  const rand = crypto.randomUUID().slice(0, 8);
  const safeId = String(task.id).replace(/[^a-zA-Z0-9-]/g, '');
  const finalContainerId = `harness-task-${safeId}-r${fixRound}-${rand}`;

  let worktreePath = state.worktreePath;
  let token = state.githubToken;

  try {
    if (!worktreePath) {
      // H11: sub-task 独立 worktree 用 <init8>-<logical> 复合 key（绕过 shortTaskId ≥8 限制）。
      // 修 PR #2851 P0：之前调 ensureHarnessWorktree(taskId='ws1') 被 shortTaskId 拒 → spawn 从未真跑。
      const wtKey = `${String(initiativeId).slice(0, 8)}-${task.id}`;
      const branch = harnessSubTaskBranchName(initiativeId, task.id);
      worktreePath = await ensureWt({ taskId: task.id, initiativeId, wtKey, branch, baseRepo: state.baseRepo || undefined });
    }
    if (!token) token = await resolveTok();
  } catch (err) {
    return { containerId: finalContainerId, status: 'failed', error: { node: 'spawn', message: `prep: ${err.message}` } };
  }

  // H13: 把 proposer 分支的合同物件（sprints/）checkout 到 generator worktree。
  // proposer push 了 contract-dod-wsN.md / tests/wsN/ / task-plan.json 到 cp-harness-propose-r3-*，
  // 但 generator worktree fresh off main 看不到。先 fetch + checkout，让 generator 容器内 SKILL
  // 能 read 合同基于它干活；不做 'import contract' → generator 不知道 DoD 存在 → evaluator 永远 FAIL。
  const contractBranch = state.contractBranch;
  // 本地标志：合同是否已在本次 worktree 里（已有 state.contractImported 或本次刚导入）。
  // 不能用 state.contractImported 作 codex push 门控——它只在本函数 return 时才置 true，
  // 同一次执行里读仍是 false → 首次运行 push 被跳过 → 西安 codex clone 后没合同 → 无产出无 PR（358c80f3 实证）。
  let contractInWorktree = !!state.contractImported;
  if (contractBranch && !state.contractImported) {
    try {
      await execFile('git', ['fetch', 'origin', `${contractBranch}:refs/remotes/origin/${contractBranch}`], { cwd: worktreePath });
      await execFile('git', ['checkout', `origin/${contractBranch}`, '--', 'sprints/'], { cwd: worktreePath });
      await execFile('git', ['add', 'sprints/'], { cwd: worktreePath });
      // commit 失败（无变更）非阻塞 — generator 仍能在 worktree 里看到 sprints/
      await execFile('git', ['commit', '-m', `chore(harness): import contract from ${contractBranch}`], { cwd: worktreePath })
        .catch(() => null);
      contractInWorktree = true;
    } catch (err) {
      return { containerId: finalContainerId, status: 'failed', error: { node: 'spawn', message: `prep: import contract from ${contractBranch}: ${err.message}` } };
    }
  }

  // Protocol v2: Brain 预计算分支名并注入容器，不再依赖容器自报分支
  // harnessSubTaskBranchName 是纯函数，幂等调用安全（ensureWt 也用了同参数调用）
  const precomputedBranch = harnessSubTaskBranchName(initiativeId, task.id);

  const prompt = buildGeneratorPrompt(task, { fixMode, prdContent: state.prdContent || null });

  // thread_id 必须跟 harness-initiative.graph runSubTaskNode 用的一致：
  // `harness-task:${initiativeId}:${subTaskId}:fix${N}<合同后缀>` —— callback router 用此 lookup
  // B47: final_e2e_fix_count 从 payload 读，与 config thread_id 保持一致
  // 合同绑定：thread_id 追加 contractBranch 折出的稳定短 token，合同重新收敛 → 新线程，
  // 不复用旧终局 checkpoint（run da418741 死线程秒回 root cause）。state.contractBranch
  // 即父 runSubTaskNode invoke 时传入值，子图内不再变，spawn/evaluate 两处一致。
  const threadFixRound = state.task?.payload?.final_e2e_fix_count ?? 0;
  const threadId = `harness-task:${initiativeId}:${task.id}:fix${threadFixRound}${harnessContractThreadSuffix(state.contractBranch)}`;

  // 关键：调 resolveAccount 选 claude account → 注入 CECELIA_CREDENTIALS + CECELIA_MODEL。
  // buildDockerArgs 据此加 -v ~/.claude-accountN:/host-claude-config:ro mount。
  // 漏调 → 容器内 claude CLI "Not logged in" → exit 1 → 0.5s 容器死 → graph 卡 await_callback。
  // (Layer 3 部署 W8 v7 实证 — bug 直到 sub_task fanout 才暴露)
  const acctOpts = { task: { ...task, task_type: 'harness_task' }, env: {} };
  await resolveAccount(acctOpts, { taskId: task.id });
  const accountEnv = acctOpts.env;

  const callbackUrl = `http://host.docker.internal:5221/api/brain/harness/callback/${finalContainerId}`;

  const dockerArgs = {
    task: { ...task, task_type: 'harness_task' },
    prompt,
    worktreePath,
    containerId: finalContainerId,
    env: {
      // 上面 resolveAccount 注入的 CECELIA_CREDENTIALS + CECELIA_MODEL
      ...accountEnv,
      CECELIA_TASK_TYPE: 'harness_task',
      HARNESS_NODE: 'generator',
      HARNESS_INITIATIVE_ID: initiativeId,
      HARNESS_TASK_ID: task.id,
      HARNESS_FIX_MODE: fixMode ? 'true' : 'false',
      // Protocol v2: Brain 预计算分支名注入，容器直接 checkout 到此分支，无需自报
      HARNESS_BRANCH_NAME: precomputedBranch,
      GITHUB_TOKEN: token,
      CONTRACT_BRANCH: payload.contract_branch || state.contractBranch || '',
      SPRINT_DIR: payload.sprint_dir || 'sprints',
      BRAIN_URL: 'http://host.docker.internal:5221',
      // CALLBACK_URL 容器跑完 wget 这个 URL POST stdout
      HARNESS_CALLBACK_URL: callbackUrl,
      // WORKSTREAM_INDEX/COUNT 已移除 — harness-generator v7.0+ 单 Sprint 模式不使用
      // WORKSTREAM_INDEX: extractWorkstreamIndex(payload),
      // WORKSTREAM_COUNT: payload.workstream_count != null ? String(payload.workstream_count) : '',
      PLANNER_BRANCH: payload.planner_branch || '',
      ...(buildHarnessGoalSettings('The workstream implementation PR has been created and pushed to GitHub')
        ? { CECELIA_GOAL_SETTINGS: buildHarnessGoalSettings('The workstream implementation PR has been created and pushed to GitHub') }
        : {}),
    },
  };

  // 机器+执行器统一路由（取代旧的西安全局开关 env）：
  //   resolveExecutor 据 payload.{machine,executor} > 半显式 > 标签默认 > us-m4/claude 兜底。
  //   executor=claude → 现有 docker 派发（美国本地 cecelia/runner）。
  //   executor=codex  → POST route.url/run（worker-daemon：mode 路由 + repo→codex-task.sh 出 PR）。
  const resolveExec = opts.resolveExecutor || resolveExecutorDefault;
  const spawnBridgeFn = opts.spawnBridge || spawnCodexBridgeDetached;
  // route 在 try 外声明，让成功 return 能带上 executor/daemonUrl（远程 liveness 用）。
  let route = null;
  try {
    route = await resolveExec(task);
    if (route.executor === 'codex') {
      // codex：POST route.url/run，worker-daemon 侧已就绪（mode 路由 + repo + callback 重写）。
      // repo 优先用 state.baseRepo，回退 payload.base_repo。callback_url 用 host.docker.internal，
      // worker-daemon 会重写成真实 Brain 地址。
      //
      // 关键差异（vs claude 本地 docker mount）：codex 在西安 `git clone from GitHub`，
      // 看不到本地 worktree 的 contract import commit。spawnBridge 前必须先 push 合同分支到
      // GitHub，否则西安 codex-task.sh checkout 后看不到 sprints/contract-dod.md → generator
      // 不知道 DoD 存在 → evaluator 永远 FAIL。
      if (contractInWorktree && worktreePath) {
        // 兜底：import 的 commit 偶发未落地（实证 60fa150f：合同 checkout+add 了但 commit 没成功，
        // 文件 staged 未提交）。push 只传 committed，必须先把 worktree 里任何 staged 改动提交进 HEAD，
        // 否则西安 codex clone 的分支没合同 → 无产出无 PR。git add -A + commit（无变更则 no-op）。
        await execFile('git', ['-C', worktreePath, 'add', '-A'], { cwd: worktreePath }).catch(() => null);
        await execFile('git', ['-C', worktreePath,
          '-c', 'user.name=Cecelia Bot', '-c', 'user.email=cecelia-bot@noreply.github.com',
          'commit', '--no-verify', '-m', `chore(harness): ensure contract committed for codex ${precomputedBranch}`],
        { cwd: worktreePath })
          .then(() => console.log(`[spawn-codex] 兜底提交合同到 ${precomputedBranch}`))
          .catch(() => { /* 无 staged 变更 → commit 空转，正常 */ });
        await execFile('git', ['-C', worktreePath, 'push', 'origin',
          `HEAD:${precomputedBranch}`], { timeout: 60_000 });
      }
      const repo = state.baseRepo || payload.base_repo || '';
      await spawnBridgeFn(`${route.url}/run`, {
        task_id: finalContainerId,
        task_type: task.task_type || 'harness_task',
        prompt,
        skill: 'harness-generator',
        branch: precomputedBranch,
        callback_url: callbackUrl,
        repo,
        mode: 'codex',
        // codex-task.sh 容器内需要 token 来 git push + gh pr create。
        env: { GITHUB_TOKEN: token },
      });
      // Fix #5: codex 派发可观测性 — 永挂 debug 实证 grep detached/containerId 全空，
      // 无法判断 spawn 到底有没有跑到西安。
      console.log(`[spawn-codex] dispatched task_id=${finalContainerId} → ${route.url}`);
    } else {
      // claude（默认）：本地 docker run -d detached。
      await spawnFn(dockerArgs);
    }
  } catch (err) {
    // Fix #6: catch 带上 finalContainerId（西安可能已远程起容器，需 containerId 定位/清理）。
    return { containerId: finalContainerId, status: 'failed', error: { node: 'spawn', message: `spawn: ${err.message}` } };
  }

  // 写 thread_lookup（callback router 反查用）。失败不阻塞 spawn，因为容器已经在跑；
  // 但 e2e 会失败（callback router 找不到 thread → 404）。
  try {
    await dbPool.query(
      `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
       VALUES ($1, $2, 'harness-task', 'spawning')
       ON CONFLICT (container_id) DO NOTHING`,
      [finalContainerId, threadId]
    );
  } catch (err) {
    console.warn(`[harness-task.graph] thread_lookup INSERT failed cid=${finalContainerId}: ${err.message}`);
  }

  return {
    containerId: finalContainerId,
    worktreePath,
    githubToken: token,
    // Fix #3: 记录 spawn 时间戳，让 _waitForSubGraphCompletion 能独立于 docker inspect
    //         判断 callback 是否迟到/丢失（await_callback 总超时兜底）。
    spawnedAt: Date.now(),
    // Fix #4: 记录 executor + 远程 daemonUrl，让 _checkContainerLiveness 对西安 Codex
    //         容器走 worker-daemon /health 而非本地 docker inspect（本地查不到远程容器）。
    executor: route?.executor || 'claude',
    daemonUrl: route?.executor === 'codex' ? route.url : null,
    // 根因 2: 记录本次容器用的账号，callback 401 时 awaitCallbackNode 据此 markAuthFailure。
    accountId: accountEnv.CECELIA_CREDENTIALS || null,
    ...(contractBranch ? { contractImported: true } : {}),
  };
}

/**
 * Layer 3 awaitCallbackNode — interrupt() yield，等 callback router Command(resume).
 *
 * resume 后 callbackPayload = { result, error, exit_code, stdout }（callback router POST body）。
 * stdout 是 generator 容器的 stdout（pr_url 在里面），当成 generator_output 塞进 state，
 * 下游 parse_callback 提 pr_url。
 *
 * 幂等门：state.generator_output 已有（resume 后 graph 重跑此节点）→ passthrough。
 */
export async function awaitCallbackNode(state, opts = {}) {
  if (state.generator_output) return { generator_output: state.generator_output };

  const callbackPayload = interrupt({
    type: 'wait_harness_task_callback',
    containerId: state.containerId,
  });

  // 兼容多种 callback shape：
  //   - { stdout, exit_code, ... }（runner 标准）
  //   - { result: {...}, ... }（walking-skeleton 旧 shape）
  const payload = callbackPayload || {};
  const exitCode = payload.exit_code !== undefined ? payload.exit_code : 0;

  if (exitCode !== 0) {
    const errMsg = payload.error || payload.stderr || `container exit_code=${exitCode}`;
    // 根因 2（2026-06-10）: 识别 401 auth 失败 → markAuthFailure 熔断该账号。
    // 之前只标 container_exit 重 spawn，resolveAccount 不知道账号坏了 →
    // 同一个坏账号被反复选中，fix loop 空转烧光轮次。标记后下次 spawn 自动换号。
    const checkAuth = opts.checkAuthFailure || checkAuthFailure;
    let authFailed = false;
    try {
      const authRes = await checkAuth(
        {
          stdout: payload.stdout || (typeof payload.result === 'string' ? payload.result : ''),
          stderr: `${payload.stderr || ''}\n${payload.error || ''}`,
        },
        { env: { CECELIA_CREDENTIALS: state.accountId || null } },
      );
      authFailed = !!authRes?.authFailed;
    } catch (err) {
      console.warn(`[harness-task.graph] checkAuthFailure 失败（non-fatal）: ${err.message}`);
    }
    // B18: 不再设 state.error（fatal）→ 转 ci_fail 路径让 fix loop 继续重试
    // 区分 docker daemon 死（true fatal，由 spawnNode throw 抓）vs 容器内业务 fail（应 retry）
    return {
      ci_status: 'fail',
      ci_fail_type: authFailed ? 'auth_failed' : 'container_exit',
      failed_checks: [errMsg],
    };
  }

  const stdout = payload.stdout || (typeof payload.result === 'string' ? payload.result : '') || '';

  return {
    generator_output: stdout,
    cost_usd: payload.cost_usd || 0,
  };
}

// 兼容老调用方：harness-initiative.graph.js 老 import { buildHarnessTaskGraph } 没用此函数，
// 但保留 export 防止外部 import 名失败。新代码不应再用。
export const spawnGeneratorNode = spawnNode;

export async function parseCallbackNode(state, opts = {}) {
  // 幂等门：已有 pr_url 跳过
  if (state.pr_url) {
    return { pr_url: state.pr_url, pr_branch: state.pr_branch };
  }

  const worktreePath = state.worktreePath;

  // Protocol v2 Priority 1: 从 git 状态读取（Brain 自己算，不依赖 LLM stdout）
  // Brain 预注入了 HARNESS_BRANCH_NAME，容器 push 到该分支后 Brain 直接查 GitHub
  if (worktreePath) {
    const gitResult = await readPrFromGitState(worktreePath, { execFile: opts.execFile });
    if (gitResult?.pr_url) return gitResult;
  }

  // Protocol v1 Fallback: 解析 LLM stdout（旧协议兼容，容器未更新时降级）
  const out = state.generator_output || '';
  const parsed = parseDockerOutput(out);
  const pr_url = extractField(parsed, 'pr_url');
  const pr_branch = extractField(parsed, 'pr_branch');
  // END 终态规则（图的每条 END 边都是 API）：no_pr 是终局路径（routeAfterParse → END），
  // 必须写明确 status='no_pr'，否则停在 status channel 默认值 'queued' → 父 runSubTaskNode
  // getState 读到 queued → Serial gate 误读为 "did not merge (status=queued)"（run cf4f596c
  // 死线程实证：fix0 线程走到 next=[], status=queued）。
  if (!pr_url) {
    return { pr_url: null, pr_branch: pr_branch || null, status: 'no_pr' };
  }
  return { pr_url, pr_branch };
}

/**
 * H15 PRD 阶段 2 收尾：verify_generator 节点 — parse_callback 提到 pr_url 后主动验：
 *   - PR 真存在 (gh pr view)
 *   - opts.requiredArtifacts 出现在 PR diff (gh pr diff)
 * 失败 throw ContractViolation → addNode retryPolicy: LLM_RETRY 自动 retry 3 次。
 *
 * 幂等门：state.poll_count > 0 → 已进入 poll 阶段，跳过（resume 时不重验）。
 */
export async function verifyGeneratorNode(state, opts = {}) {
  if ((state.poll_count || 0) > 0) return {};
  const verifyFn = opts.verifyGenerator || verifyGeneratorOutput;
  await verifyFn({
    pr_url: state.pr_url,
    requiredArtifacts: opts.requiredArtifacts || [],
  });
  return {};
}

export async function pollCiNode(state, opts = {}) {
  const checkFn = opts.checkPr || checkPrStatus;
  const classifyFn = opts.classify || classifyFailedChecks;
  const sleepMs = opts.sleepMs !== undefined
    ? opts.sleepMs
    : (process.env.HARNESS_POLL_INTERVAL_MS !== undefined
        ? Number(process.env.HARNESS_POLL_INTERVAL_MS)
        : POLL_INTERVAL_MS);
  const pollCount = state.poll_count || 0;

  if (pollCount >= MAX_POLL_COUNT) {
    // END 终态规则：timeout 是终局（routeAfterPoll → END），写明确 status='timeout'，
    // 不留默认 'queued'。
    return { ci_status: 'timeout', status: 'timeout', poll_count: pollCount };
  }

  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  let info;
  try {
    info = checkFn(state.pr_url);
  } catch (err) {
    console.warn(`[harness-task.graph] poll_ci checkPrStatus error (will retry): ${err.message}`);
    return { ci_status: 'pending', poll_count: pollCount + 1 };
  }

  if (info.state === 'CLOSED' || info.ciStatus === 'closed') {
    // END 终态规则：PR 被外部关闭 → 终局失败（routeAfterPoll error → END），
    // error 与 status 同时写，杜绝默认 'queued'。
    return {
      ci_status: 'fail',
      status: 'failed',
      poll_count: pollCount + 1,
      error: { node: 'poll_ci', message: 'PR closed externally' },
    };
  }
  if (info.ciStatus === 'ci_passed' || info.ciStatus === 'merged') {
    return { ci_status: 'pass', poll_count: pollCount + 1 };
  }
  // 无 CI check：给 NO_CHECKS_GRACE_POLLS 轮等 CI 注册；仍无 check 且 MERGEABLE → 判 pass。
  // （否则 0-check 的 PR 会被当 pending 一直轮询到 MAX_POLL_COUNT 超时，merge 永不执行）
  if (info.ciStatus === 'ci_no_checks') {
    if (info.mergeable === 'MERGEABLE' && (pollCount + 1) >= NO_CHECKS_GRACE_POLLS) {
      return { ci_status: 'pass', poll_count: pollCount + 1 };
    }
    return { ci_status: 'pending', poll_count: pollCount + 1 };
  }
  if (info.ciStatus === 'ci_failed') {
    const failType = classifyFn(info.failedChecks || []);
    return {
      ci_status: 'fail',
      ci_fail_type: failType,
      failed_checks: info.failedChecks || [],
      poll_count: pollCount + 1,
    };
  }
  return { ci_status: 'pending', poll_count: pollCount + 1 };
}

const BEHIND_RE = /behind|out of date|outdated|head ref is out of date|must be up to date|not mergeable/i;

// 分支保护要求 up-to-date：高合并频率下 PR 会反复 BEHIND main（churn）。
// 限次重试 update-branch，避免无限刷；达上限带 reason 终止。
// 参见 feedback_pr_stuck_behind_churn：禁止本地 rebase 抢 worker，只用服务端 update-branch。
const MAX_REBASE_ATTEMPTS = 3;

// 读取 PR 权威 mergeable 状态，区分 BEHIND（可 update-branch 解）vs CONFLICTING（真冲突，解不了）。
// 失败时返回 UNKNOWN，调用方回落到 merge 错误文本判定。
async function queryMergeState(execFn, prUrl) {
  try {
    const { stdout } = await execFn(
      'gh',
      ['pr', 'view', prUrl, '--json', 'mergeable,mergeStateStatus'],
      { timeout: 30_000 }
    );
    const data = JSON.parse(stdout || '{}');
    return {
      mergeable: data.mergeable || 'UNKNOWN',
      mergeStateStatus: data.mergeStateStatus || 'UNKNOWN',
    };
  } catch {
    return { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
  }
}

export async function mergePrNode(state, opts = {}) {
  if (state.status === 'merged') return { status: 'merged' };
  const execFn = opts.execFile || execFileDefault;
  const prUrl = state?.pr_url;

  if (!prUrl) {
    // END 终态规则：merge_pr 所有 error 返回都经 routeAfterMergePr → END，必须带 status='failed'。
    return { status: 'failed', error: { node: 'merge_pr', message: 'no pr_url available' } };
  }

  try {
    const { stdout } = await execFn(
      'gh',
      ['pr', 'merge', prUrl, '--squash', '--delete-branch'],
      { timeout: 30_000 }
    );
    const tail = (stdout || '').trim().slice(0, 200);
    console.log(`[merge_pr] gh pr merge ok pr=${prUrl}: ${tail}`);
    if (state.worktreePath) {
      await cleanupHarnessWorktree(state.worktreePath);
    }
    return {
      status: 'merged',
      ci_status: 'merged',
      merged_at: new Date().toISOString(),
      merge_command: 'gh pr merge --squash',
    };
  } catch (err) {
    const msg = err.message || '';

    // 已被外部路径合并 → 视为成功（幂等）
    const ALREADY_MERGED_RE = /already merged|not open|pull request.*closed/i;
    if (ALREADY_MERGED_RE.test(msg)) {
      console.log(`[merge_pr] PR already merged, treating as success pr=${prUrl}`);
      try { if (state.worktreePath) await cleanupHarnessWorktree(state.worktreePath); } catch {}
      return { status: 'merged', ci_status: 'merged', merged_at: new Date().toISOString() };
    }

    // 查权威 mergeable 状态，区分 BEHIND vs CONFLICTING（真冲突）
    const { mergeable, mergeStateStatus } = await queryMergeState(execFn, prUrl);

    // CONFLICTING（真冲突）：update-branch 解不了 → 带可诊断 reason 终止，绝不静默干等到超时。
    const isConflicting = mergeable === 'CONFLICTING' || mergeStateStatus === 'DIRTY';
    if (isConflicting) {
      const reason = `PR conflicts with base branch (mergeable=${mergeable}, state=${mergeStateStatus}); `
        + `update-branch cannot auto-resolve merge conflicts — needs fix round / manual resolution`;
      console.error(`[merge_pr] CONFLICTING pr=${prUrl}: ${reason}`);
      return { status: 'failed', error: { node: 'merge_pr', reason: 'conflicting', message: reason } };
    }

    // BEHIND：落后 main（分支保护要求 up-to-date）→ 服务端 update-branch，限次重试。
    const isBehind = mergeStateStatus === 'BEHIND' || BEHIND_RE.test(msg);
    if (!isBehind) {
      console.error(`[merge_pr] non-recoverable merge error pr=${prUrl}: ${msg}`);
      return { status: 'failed', error: { node: 'merge_pr', message: msg } };
    }

    const attempts = state.rebase_attempted || 0;
    if (attempts >= MAX_REBASE_ATTEMPTS) {
      const reason = `branch still BEHIND after ${attempts} update-branch attempts `
        + `(max ${MAX_REBASE_ATTEMPTS}); aborting to avoid infinite rebase churn`;
      console.error(`[merge_pr] ${reason} pr=${prUrl}`);
      return { status: 'failed', error: { node: 'merge_pr', reason: 'rebase_exhausted', message: reason } };
    }

    console.warn(`[merge_pr] branch behind (attempt ${attempts + 1}/${MAX_REBASE_ATTEMPTS}), calling update-branch pr=${prUrl}`);
    try {
      await execFn('gh', ['pr', 'update-branch', prUrl, '--rebase'], { timeout: 30_000 });
      console.log(`[merge_pr] update-branch ok, re-queuing CI poll pr=${prUrl}`);
      return { ci_status: 'pending', rebase_attempted: attempts + 1 };
    } catch (updateErr) {
      console.error(`[merge_pr] update-branch failed pr=${prUrl}: ${updateErr.message}`);
      return { status: 'failed', error: { node: 'merge_pr', message: `update-branch failed: ${updateErr.message}` } };
    }
  }
}

export function routeAfterMergePr(state) {
  if (state.status === 'merged') return 'end';
  if (state.error) return 'end';
  if (state.ci_status === 'pending') return 'poll';
  return 'end';
}

export async function fixDispatchNode(state, opts = {}) {
  // 终态门（P2）：fix loop 路由边在 reset 计数/重 spawn 前查 initiative 终态。
  // 已终态 → 写明确终态 status='aborted' + error，routeAfterFix 据 error 走 END，
  // 不再 ++fix_round、不再 reset containerId 触发 spawn（直接终止 fix loop）。
  const checkTerminal = opts.isInitiativeTerminal || isInitiativeTerminal;
  const term = await checkTerminal(state, opts);
  if (term.terminal) {
    console.warn(`[fix_dispatch] initiative ${term.initiativeId} 已终态 status=${term.status} → 中止 fix loop，走 END`);
    return { status: 'aborted', error: { node: 'fix_dispatch', message: `initiative already terminal (status=${term.status}); abort fix loop` } };
  }
  const next = (state.fix_round || 0) + 1;
  return {
    fix_round: next,
    generator_output: null,
    // Layer 3：必须 reset containerId 否则 spawn 节点幂等门 short-circuit，永远不会重 spawn
    containerId: null,
    // Fix #3: reset spawnedAt — 重 spawn 时由 spawnNode 写新时间戳，旧值会让 callback_timeout 误触发。
    spawnedAt: null,
    // B19: 不 reset pr_url/pr_branch — generator fix mode 同 PR push 新 commit，URL 不变。
    // W40 实证：reset 后 sub-task graph END 时 pr_url=null → finalEvaluate 拿不到
    // PR_BRANCH → evaluator 跑 main 没新代码 → §1 happy FAIL（最后一公里 bug）。
    poll_count: 0,
    ci_status: 'pending',
    ci_fail_type: null,
    failed_checks: [],
    // B21: 必须 reset evaluate_verdict/evaluate_error — evaluateContractNode 幂等门
    // 判 state.evaluate_verdict 非空则短路返回旧 FAIL，新轮次永远不 spawn 真实评估器。
    // 不清零 → 跨 fix_round 持久 FAIL → 无限循环（W45 实证）。
    evaluate_verdict: null,
    evaluate_error: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 路由函数

// Fix #1（第 4 个 generator 永挂 bug 的结构性根因）：
// spawnNode 在 prep/spawn 抛错时返回 {error}（不带可用容器），原代码用无条件边
// `.addEdge('spawn','await_callback')` 无脑进 await_callback → interrupt() 把执行挂在
// 节点内部 → routeAfterCallback conditional edge 永远轮不到 → graph 卡 await_callback
// 66 分钟。改用本路由函数：spawn 返回 error 直接 END(status=failed)，绝不进 interrupt。
export function routeAfterSpawn(state) {
  return state.error ? 'end' : 'await_callback';
}

// B18: awaitCallback exit≠0 后 ci_status='fail' + ci_fail_type='container_exit'
// 此时直接进 fix_dispatch（跟 ci_fail 同等），不走 parse_callback（否则 pr_url=null → END）
export function routeAfterCallback(state) {
  if (state.error) return 'end';
  // 根因 2: auth_failed 同 container_exit 走 fix 路径 — fix_dispatch 重 spawn 时
  // resolveAccount 已因 markAuthFailure 熔断换号，否则 401 会掉进 parse → no_pr 直接终止。
  if (state.ci_status === 'fail'
      && (state.ci_fail_type === 'container_exit' || state.ci_fail_type === 'auth_failed')) {
    return 'fix';
  }
  return 'parse';
}

function routeAfterParse(state) {
  if (state.error) return 'end';
  if (!state.pr_url) return 'no_pr';
  return 'poll';
}
export function routeAfterPoll(state) {
  if (state.error) return 'end';
  if (state.ci_status === 'merged') return 'merge';      // already merged via external path — short-circuit
  if (state.ci_status === 'pass')   return 'evaluate';   // NEW: insert pre-merge gate
  if (state.ci_status === 'fail') return 'fix';
  if (state.ci_status === 'timeout') return 'timeout';
  return 'poll'; // pending → loop
}

// 合同产物文件判定：Contract Gate 命中这些文件 = 合同本身不合格（弱断言/作弊/缺工具），
// 责任在 GAN proposer（有权改合同），不是 generator（CONTRACT IS LAW，generator 无权改合同）。
// contract-dod.md / contract-draft.md / sprint-contract.md 是合同三态产物。
export function isContractArtifactFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const base = filePath.split('/').pop();
  return /^(contract-dod|contract-draft|sprint-contract|contract)\.md$/.test(base);
}

// Pre-merge gate router: post-evaluator verdict → merge / end / fix.
export function routeAfterEvaluate(state) {
  // 终态门（P2）：initiative 已终态 → 直接 END，不 merge 也不进 fix loop。
  if (state.status === 'aborted') return 'end';
  if (state.evaluate_verdict === 'PASS') return 'merge';
  // P1: 合同产物不合格（Contract Gate 命中合同文件本身）→ 终止 initiative，不进 generator fix loop。
  // generator 无权改合同 → 进 fix loop 只会同一行反复命中空转烧轮次（实证 run ea622a94 r0/r1/r2 三连）。
  // 修复责任在 GAN proposer：feedback 已带结构化命中清单，供重发时 proposer 参考。
  if (state.failure_class === 'contract_invalid') return 'end';
  return 'fix';
}

// ─── 确定性 ARTIFACT 门（fidelity-gate 修复，run 926779b5/#3276 实证）─────────────
//
// 根因：pre-merge evaluator 是 LLM agent，local_api 模式打活 brain（跑 main、且重部署中
// 不可达），结构上验不了 PR 分支的新实现，还会 hand-wave PASS；brain 侧没有任何确定性
// "实现真存在" 检查 → "功能没建也 merge"。
//
// 修法：evaluator 之外，brain 自己 checkout PR 分支 + 跑 contract-dod.md 的 [ARTIFACT]
// Test 命令（那些 `node -e ...includes()/accessSync()` 确定性文件检查）。任一失败 → 强制
// verdict=FAIL，无视 LLM。不依赖活 brain、不依赖 LLM 诚实。
// fail-open 原则：门本身跑不起来（无合同/无 worktree/无 ARTIFACT 条目）→ ran=false，放过
// 给 LLM evaluator，不误杀。只有命令"确定性地失败"才强制 FAIL。

/**
 * 从 contract-dod.md 提取 [ARTIFACT] 条目的 Test: 命令（排除 [BEHAVIOR]）。
 * @param {string} md
 * @returns {string[]}
 */
export function extractArtifactTests(md) {
  const lines = (md || '').split('\n');
  const cmds = [];
  let inArtifact = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*-\s*(?:\[[ xX]\]\s*)?\[(ARTIFACT|BEHAVIOR)\]/);
    if (bullet) { inArtifact = bullet[1] === 'ARTIFACT'; continue; }
    if (/^\s*#{1,6}\s/.test(line)) { inArtifact = false; continue; }
    const t = line.match(/^\s*Test:\s*(.+)$/);
    if (t && inArtifact) {
      const cmd = t[1].trim().replace(/^manual:/, '').trim();
      if (cmd) cmds.push(cmd);
    }
  }
  return cmds;
}

// 宿主仓库 node_modules 路径（本文件运行在 live brain 仓库，依赖已装好）。
// ARTIFACT 命令在临时 checkout（git worktree add 出来的 PR 分支）跑，那里没有 node_modules
// → `node -e "import('./src/...')"` 报 `Cannot find package 'zod'`（run 56b5cc39 实证）。
// 把宿主 node_modules 注入 NODE_PATH，让临时目录里的命令能解析到 brain 依赖。
// packages/brain/node_modules + 仓库根 node_modules 都进，覆盖 hoist 与未 hoist 两种装法。
export const HOST_NODE_PATH = (() => {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url)); // .../packages/brain/src/workflows
    return [
      path.resolve(dir, '../../node_modules'),       // packages/brain/node_modules
      path.resolve(dir, '../../../../node_modules'),  // 仓库根 node_modules
    ].join(path.delimiter);
  } catch {
    return '';
  }
})();

// ARTIFACT 命令子进程 env：注入 NODE_PATH 让临时 checkout 能解析宿主依赖。
export function artifactGateEnv(nodePath = HOST_NODE_PATH) {
  return {
    ...process.env,
    NODE_PATH: [nodePath, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  };
}

// 依赖/环境类错误判定：门的本职是抓"实现没做"，不是抓"门自己环境穷"。
// 命中（Cannot find package / MODULE_NOT_FOUND / Cannot find module）→ fail-open 跳过，
// 不算被测者（generator）的失败。
export function isDependencyError(detail) {
  return /Cannot find package|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module/i.test(detail || '');
}

/**
 * 逐条跑 ARTIFACT 命令，任一真断言失败（非依赖类）→ ok=false。
 * 依赖/环境类错误 → 记 skipped（fail-open，warning），不计 FAIL。
 * @param {object} args
 * @param {string[]} args.commands
 * @param {string} args.cwd
 * @param {Function} [args.execShell]  (cmd, {cwd, timeout, nodePath}) => Promise，非零退出须 reject
 * @param {number} [args.timeoutMs]
 * @param {string} [args.nodePath]     注入 NODE_PATH（默认 HOST_NODE_PATH）
 * @returns {Promise<{ok:boolean, failures:{cmd:string,error:string}[], skipped:{cmd:string,error:string}[]}>}
 */
export async function runArtifactGate({ commands, cwd, execShell, timeoutMs = 30000, nodePath = HOST_NODE_PATH }) {
  const run = execShell
    || ((cmd, o) => execFileDefault('bash', ['-c', cmd], { cwd: o.cwd, timeout: o.timeout, env: artifactGateEnv(o.nodePath) }));
  const failures = [];
  const skipped = [];
  for (const cmd of commands || []) {
    try {
      await run(cmd, { cwd, timeout: timeoutMs, nodePath });
    } catch (e) {
      const detail = (e?.stderr || e?.message || 'non-zero exit').toString().slice(0, 300);
      if (isDependencyError(detail)) {
        // 门的环境失败 ≠ 被测者的失败：fail-open 跳过，warning 记录，不打回 generator。
        console.warn(`[artifact-gate] 命令因依赖/环境缺失跳过（fail-open，不计 FAIL）：${cmd} → ${detail}`);
        skipped.push({ cmd, error: detail });
        continue;
      }
      failures.push({ cmd, error: detail });
    }
  }
  return { ok: failures.length === 0, failures, skipped };
}

/**
 * 编排：checkout PR 分支到隔离 worktree → 读 PR 分支的 contract-dod.md → 跑 [ARTIFACT] 命令。
 * fail-open：缺 prBranch/worktreePath/合同/ARTIFACT 条目 → ran=false。
 *
 * @param {object} args  {prBranch, sprintDir, worktreePath, githubToken}
 * @param {object} [deps]  注入 git/IO 依赖（测试用）
 * @returns {Promise<{ran:boolean, ok?:boolean, failures?:object[]}>}
 */
export async function verifyContractArtifactsForPr(
  { prBranch, sprintDir, worktreePath },
  deps = {}
) {
  if (!prBranch || !worktreePath) return { ran: false };
  const execFile = deps.execFile || execFileDefault;
  const runGate = deps.runGate || ((commands, cwd) => runArtifactGate({ commands, cwd }));
  const sd = sprintDir || 'sprints';

  // fetch PR 分支（确保 origin/<prBranch> 在本地）
  // 必须用显式 refspec <branch>:refs/remotes/origin/<branch>：裸 `git fetch origin <branch>`
  // 只更新 FETCH_HEAD，不更新 refs/remotes/origin/<branch> → 后续 `git show origin/<branch>:...`
  // 必 `invalid object name` → catch fail-open → 门没关（与 git-fence.js 同约定，修当天每条 run fail-open）。
  try {
    await execFile(
      'git',
      ['-C', worktreePath, 'fetch', 'origin', `${prBranch}:refs/remotes/origin/${prBranch}`],
      { timeout: 60_000 }
    );
  } catch (e) {
    console.warn(`[artifact-gate] fetch ${prBranch} 失败（fail-open）：${e.message}`);
    return { ran: false };
  }

  // 读 PR 分支上的 contract-dod.md
  const readContract = deps.readContract || (async () => {
    const { stdout } = await execFile(
      'git', ['-C', worktreePath, 'show', `origin/${prBranch}:${sd}/contract-dod.md`],
      { timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout;
  });
  let contractMd;
  try {
    contractMd = await readContract();
  } catch (e) {
    console.warn(`[artifact-gate] 读 ${sd}/contract-dod.md 失败（fail-open）：${e.message}`);
    return { ran: false };
  }

  const commands = extractArtifactTests(contractMd);
  if (commands.length === 0) {
    console.warn('[artifact-gate] 合同无 [ARTIFACT] 条目（fail-open）');
    return { ran: false };
  }

  // checkout PR 分支到隔离临时 worktree
  const tmp = deps.tmpDir || `/tmp/harness-artifact-gate-${crypto.randomUUID().slice(0, 8)}`;
  const mkWorktree = deps.mkWorktree || (async () => {
    await execFile('git', ['-C', worktreePath, 'worktree', 'add', '--detach', '--force', tmp, `origin/${prBranch}`], { timeout: 120_000 });
    return tmp;
  });
  const rmWorktree = deps.rmWorktree || (async (p) => {
    await execFile('git', ['-C', worktreePath, 'worktree', 'remove', '--force', p], { timeout: 60_000 }).catch(() => {});
  });

  let checkoutDir;
  try {
    checkoutDir = await mkWorktree();
  } catch (e) {
    console.warn(`[artifact-gate] worktree add ${prBranch} 失败（fail-open）：${e.message}`);
    return { ran: false };
  }

  try {
    const { ok, failures, skipped } = await runGate(commands, checkoutDir);
    return { ran: true, ok, failures, skipped: skipped || [] };
  } finally {
    await rmWorktree(checkoutDir);
  }
}

// finalizeEvaluation — 运动员（evaluator agent）算出 verdict 后，过「独立裁判」门再返回。
// 三权分立：agent 保留人类式执行权（运动员），证据自动留痕（摄像头），裁判独立判读（运动员不能自发奖牌）。
// 仅 agent verdict===PASS 时调裁判复核；agent FAIL 直接透传走 fix loop（runJudgeGate 内部短路）。
async function finalizeEvaluation(state, opts, ctx) {
  const judgeGate = opts.runJudgeGate || runJudgeGate;
  const res = await judgeGate(
    {
      agentVerdict: ctx.agentVerdict,
      agentFeedback: ctx.agentFeedback,
      transcript: ctx.transcript || '',
      brainResult: ctx.brainResult || null,
      worktreePath: state.worktreePath,
      sprintDir: ctx.sprintDir,
      instanceLabel: ctx.containerId,
    },
    {
      judgeFn: opts.judgeFn,
      collectEvidence: opts.collectEvidence,
      strict: opts.judgeStrict,
      config: opts.toapisConfig,
      fetchFn: opts.judgeFetchFn,
    }
  );
  return {
    evaluate_verdict: res.verdict,
    evaluate_error: res.verdict === 'FAIL'
      ? (res.feedback || ctx.agentFeedback || 'evaluator/judge returned FAIL')
      : null,
  };
}

// evaluateContractNode — evaluator agent pre-merge gate + 独立裁判（对齐 Anthropic 官方 Harness 设计）。
// Anthropic 原文：一个 Sprint = 一个 Generator + 一个 Evaluator，evaluate 在 merge 之前跑，
// PASS → merge；FAIL → 带具体反馈打回 Generator 重写（无限对抗）。
// IS_FINAL_E2E=true：跑 contract-draft.md ## E2E 验收 完整脚本（不再分 Mode A / Mode B）。
// 用户拍板架构：evaluator agent 亲手执行验证（执行权不被代码取代），回调后由独立 DeepSeek 裁判
// 据【证据 + 合同 + Golden Path】复核；agent 说 PASS 但裁判 FAIL/覆盖缺步 → 终判 FAIL（裁判优先）。
export async function evaluateContractNode(state, opts = {}) {
  // 幂等门：Brain 重启或 outer graph 重进时，evaluate_verdict 已存在则直接返回，不重复 spawn。
  if (state.evaluate_verdict) {
    console.log(`[evaluator] idempotent passthrough verdict=${state.evaluate_verdict}`);
    return { evaluate_verdict: state.evaluate_verdict };
  }

  // 终态门（P2）：起 evaluator 容器前查 initiative 终态。已终态 → 写明确终态 status='aborted'，
  // routeAfterEvaluate 据 status==='aborted' 走 END，不浪费一个 evaluator 容器、不进 fix loop。
  const checkTerminal = opts.isInitiativeTerminal || isInitiativeTerminal;
  const termE = await checkTerminal(state, opts);
  if (termE.terminal) {
    console.warn(`[evaluator] initiative ${termE.initiativeId} 已终态 status=${termE.status} → 中止 evaluate`);
    return {
      status: 'aborted',
      evaluate_verdict: 'FAIL',
      evaluate_error: `initiative already terminal (status=${termE.status}); abort evaluate`,
    };
  }

  // merged-short-circuit（P1 收尾）：PR 已 merge 时直接 PASS，不 checkout 已删分支跑 E2E、不触发 fix loop。
  // 本系统每次 merge 触发 auto-version 重启 brain → checkpoint 大概率断在 merge 节点后 → 成功的
  // harness run 恢复时会重跑 evaluate；此时 PR 已 merge、分支已删 → checkout 失败 / E2E FAIL →
  // routeAfterEvaluate 路由 fix → 在【已 merge 的 PR】上 spawn generator（fix loop）。这是常态而非边缘。
  // 合同已过 CI 合并即视为达标 → PASS。mergePrNode 对已 merge PR 幂等（already-merged→success→end）。
  const checkPrMerged = opts.checkPrMerged || (async (prUrl) => {
    try {
      const { stdout } = await execFileDefault(
        'gh', ['pr', 'view', prUrl, '--json', 'state', '-q', '.state'], { timeout: 10_000 }
      );
      return stdout.trim() === 'MERGED';
    } catch (err) {
      // fail-open：查不到状态就当未 merge，继续正常 evaluate（绝不因查询失败误判 PASS）
      console.warn(`[evaluator] merged-check gh pr view 失败（fail-open，继续正常 evaluate）：${err.message}`);
      return false;
    }
  });
  if (state.pr_url) {
    const merged = await checkPrMerged(state.pr_url);
    if (merged) {
      console.log(`[evaluator] PR 已 merge（${state.pr_url}）→ merged-short-circuit verdict=PASS（不 checkout 已删分支/不触发 fix loop）`);
      return { evaluate_verdict: 'PASS', evaluate_error: null };
    }
  }

  const spawnFn = opts.spawnDetached || spawnDockerDetached;
  const resolveTok = opts.resolveToken || resolveGitHubToken;
  const dbPool = opts.poolOverride || pool;

  const task = state.task;
  const payload = task?.payload || {};
  const initiativeId = state.initiativeId || payload.parent_task_id || payload.initiative_id || task?.id;

  // target_environment: 从 prdContent 提取（同 initiative graph 逻辑）
  const targetEnv = (state.prdContent || '').match(/^##?\s*target_environment:\s*(\S+)/m)?.[1]
    || payload.target_environment
    || 'local_api';
  const _baseRepo = (state.baseRepo || payload.base_repo || '').toLowerCase();
  const githubRepo = _baseRepo.includes('zenithjoy') ? 'perfectuser21/zenithjoy-workspace' : 'perfectuser21/cecelia';
  const windowsCloudWorkflow = _baseRepo.includes('zenithjoy') ? 'agent-e2e-video.yml' : 'e2e-windows.yml';

  let token = state.githubToken;
  try {
    if (!token) token = await resolveTok();
  } catch (err) {
    return { evaluate_verdict: 'FAIL', evaluate_error: `prep: ${err.message}` };
  }

  const rand = crypto.randomUUID().slice(0, 8);
  const safeId = String(task.id).replace(/[^a-zA-Z0-9-]/g, '');
  const containerId = `harness-evaluate-${safeId}-r${state.fix_round || 0}-${rand}`;
  // B10: evaluate_contract 在 harness-task graph 内，thread_lookup 必须用 task graph thread_id
  // B47: final_e2e_fix_count 从 payload 读，与 config thread_id 保持一致
  // 合同绑定：与 spawnNode 同口径追加合同后缀，保证 callback router 反查命中同一线程。
  const threadFixRound = state.task?.payload?.final_e2e_fix_count ?? 0;
  const threadId = `harness-task:${initiativeId}:${task.id}:fix${threadFixRound}${harnessContractThreadSuffix(state.contractBranch)}`;

  // B14: PR 分支名传给 evaluator（Step 0a git checkout 用，不传则永远跑 main 看不到改动）
  let prBranchEnv = state.pr_branch || '';
  if (!prBranchEnv && state.pr_url) {
    try {
      const { stdout } = await execFileDefault(
        'gh',
        ['pr', 'view', state.pr_url, '--json', 'headRefName', '-q', '.headRefName'],
        { timeout: 10_000 }
      );
      prBranchEnv = stdout.trim();
    } catch (err) {
      console.warn(`[evaluate_contract] gh pr view fallback failed: ${err.message}`);
    }
  }

  const sprintDir = payload.sprint_dir || 'sprints';

  // ── 确定性 ARTIFACT 门（fidelity-gate 修复）──────────────────────────────────
  // LLM evaluator 之前先跑 brain 侧确定性检查：checkout PR 分支 + 跑 contract-dod.md 的
  // [ARTIFACT] Test 命令。任一确定性失败 → 直接 FAIL（挡 merge、打回 generator），不浪费
  // LLM spawn。门跑不起来（fail-open）→ 继续走 LLM evaluator。
  const verifyArtifacts = opts.verifyArtifacts || verifyContractArtifactsForPr;
  try {
    const gate = await verifyArtifacts(
      { prBranch: prBranchEnv, sprintDir, worktreePath: state.worktreePath },
      {}
    );
    if (gate && gate.ran && gate.skipped && gate.skipped.length) {
      // 依赖/环境类命令已 fail-open 跳过（不计 FAIL），仅记录可观测性，门继续放行真断言判定。
      console.warn(`[evaluator] ARTIFACT 门跳过 ${gate.skipped.length} 条依赖/环境失败命令（fail-open，门的环境失败不算 generator 失败）`);
    }
    if (gate && gate.ran && gate.ok === false) {
      const detail = (gate.failures || [])
        .map((f) => `• ${f.cmd} → ${f.error}`)
        .join('\n')
        .slice(0, 800);
      console.error(`[evaluator] ARTIFACT 门 FAIL（实现未满足合同 ARTIFACT，挡 merge）pr=${prBranchEnv}:\n${detail}`);
      return {
        evaluate_verdict: 'FAIL',
        evaluate_error: `ARTIFACT 门失败（PR 分支未满足合同 [ARTIFACT] 要求，功能可能未真实现）：\n${detail}`,
      };
    }
  } catch (gateErr) {
    // 门本身异常 → fail-open，不误杀，继续走 LLM evaluator
    console.warn(`[evaluator] ARTIFACT 门执行异常（fail-open）：${gateErr.message}`);
  }

  // ── 确定性 Contract Gate 门（反作弊红线代码化，与 ARTIFACT 门并列）─────────────
  // LLM evaluator 之前先跑 brain 侧确定性 gate（弱 oracle / 作弊 / 环境能力 / 域规则，零 LLM）。
  // 命中（ok===false）→ 直接 FAIL（挡 merge、打回 generator，feedback 为结构化命中清单），
  // 不浪费一个 evaluator 容器（每个 ~$5-7）。门跑不起来（异常）→ fail-open，转 LLM evaluator
  // 兜底（与既有 ARTIFACT 门同样的容错语义；fail-closed 由 CLI/库边界负责）。
  const runGate = opts.runContractGate || runContractGate;
  const gateDir = opts.contractGateDir
    || (state.worktreePath ? path.join(state.worktreePath, sprintDir) : null);
  if (gateDir) {
    let cg = null;
    try {
      cg = await runGate(gateDir, {});
    } catch (cgErr) {
      console.warn(`[evaluator] Contract Gate 执行异常（fail-open，转 LLM evaluator）：${cgErr.message}`);
      cg = null;
    }
    if (cg && cg.ok === false) {
      const feedback = formatGateReport(cg, `${sprintDir}/contract-dod.md`).slice(0, 1200);
      // P1 修复：Contract Gate 扫的是合同产物（contract-dod.md / contract-draft.md）本身。命中 =
      // 合同质量缺陷（弱断言/作弊/缺工具），责任在 GAN proposer（有权改合同），不是 generator。
      // CONTRACT IS LAW：generator 无权改合同 → 进通用 fix loop 只会同一行反复命中空转烧轮次
      // （实证 run ea622a94 r0/r1/r2 三连）。故 fail-fast：标记 failure_class=contract_invalid，
      // routeAfterEvaluate 路由直接终止 initiative（END），feedback 带结构化命中清单供重发时 proposer 参考。
      if (isContractArtifactFile(cg.contractFile)) {
        console.error(`[evaluator] Contract Gate FAIL（合同产物 ${cg.contractFile} 不合格，责任在 GAN proposer，终止 initiative 不进 generator fix loop）：\n${feedback}`);
        // END 终态规则：contract_invalid 经 routeAfterEvaluate → END 直接终止 initiative，
        // 子图层就写明确 status='contract_invalid'（不再依赖外层 runSubTaskNode 把 queued 上浮成
        // failure_class）。外层 #3361 的 failure_class 上浮保留为兼容兜底。
        return {
          evaluate_verdict: 'FAIL',
          status: 'contract_invalid',
          failure_class: 'contract_invalid',
          evaluate_error: `Contract Gate 命中合同产物（${cg.contractFile}）——合同质量缺陷责任在 GAN proposer（generator 无权改合同），终止 initiative，请重发让 proposer 修复后再跑：\n${feedback}`,
        };
      }
      // 命中含实现侧文件（理论分支：当前 gate 只扫合同产物）→ 维持现有 fix loop 行为（generator 可修）。
      console.error(`[evaluator] Contract Gate FAIL（含实现侧命中，spawn 前拦截，进 fix loop）：\n${feedback}`);
      return {
        evaluate_verdict: 'FAIL',
        evaluate_error: `Contract Gate 命中（spawn 前确定性拦截，不浪费 evaluator 容器）：\n${feedback}`,
      };
    }
  }

  const skillContent = loadSkillContent('harness-evaluator');
  const evaluatePrompt = [
    '你是 harness-evaluator agent。按下面 SKILL 指令工作。',
    '',
    skillContent,
    '',
    '---',
    '',
    '## 注入变量',
    `IS_FINAL_E2E=true`,
    `SPRINT_DIR=${sprintDir}`,
    `TASK_ID=${task.id}`,
    `TARGET_ENV=${targetEnv}`,
    `GITHUB_REPO=${githubRepo}`,
  ].join('\n');

  const acctOpts = { task: { ...task, task_type: 'harness_evaluate' }, env: {} };
  try {
    await resolveAccount(acctOpts, { taskId: task.id });
  } catch (err) {
    return { evaluate_verdict: 'FAIL', evaluate_error: `resolveAccount: ${err.message}` };
  }
  const accountEnv = acctOpts.env;

  // evaluator SKILL 变量表声称会注入 WECHAT_RPA_WORKFLOW，实际之前没注入（靠 skill 内
  // fallback 默认值兜着）。两条路径（host / docker）都补上，payload 可覆盖。
  const wechatRpaWorkflow = payload.wechat_rpa_workflow || 'e2e-wechat-rpa.yml';
  const goalSettings = buildHarnessGoalSettings(
    'The evaluation is complete and .brain-result.json has been written with verdict=PASS or FAIL'
  );

  // 两路径共享的基础 env（BRAIN_URL / HARNESS_CALLBACK_URL / DB 三个按环境分别覆盖）。
  const baseEvalEnv = {
    ...accountEnv,
    CECELIA_TASK_TYPE: 'harness_evaluate',
    HARNESS_NODE: 'evaluate_contract',
    HARNESS_INITIATIVE_ID: initiativeId,
    HARNESS_TASK_ID: task.id,
    IS_FINAL_E2E: 'true',
    JOURNEY_TYPE: state.task?.payload?.journey_type || 'autonomous',
    GITHUB_TOKEN: token,
    CONTRACT_BRANCH: state.contractBranch || payload.contract_branch || '',
    PR_URL: state.pr_url || '',
    PR_BRANCH: prBranchEnv,
    SPRINT_DIR: sprintDir,
    TARGET_ENV: targetEnv,
    GITHUB_REPO: githubRepo,
    WINDOWS_CLOUD_WORKFLOW: windowsCloudWorkflow,
    WECHAT_RPA_WORKFLOW: wechatRpaWorkflow,
    ...(goalSettings ? { CECELIA_GOAL_SETTINGS: goalSettings } : {}),
  };

  // ── target_environment 路由 ─────────────────────────────────────────────
  // mac_web（Cecelia Dashboard，localhost:5174/5221 直接可达 + Playwright 需要真实浏览器）
  // 必须在宿主 Mac 上跑，不能进无浏览器的 docker 容器（物理不可能做 UI 验证）。
  // executeOnHost 同步等结果（不走 thread_lookup + interrupt 回调），执行完直接读
  // .brain-result.json 产生与 docker 回调路径完全相同语义的 state 更新。
  if (targetEnv === 'mac_web') {
    const execHost = opts.executeOnHost || executeOnHost;
    let hostResult;
    try {
      hostResult = await execHost({
        task: { ...task, task_type: 'harness_evaluate' },
        prompt: evaluatePrompt,
        worktreePath: state.worktreePath,
        // host 上 host.docker.internal 不可解析 → 一律 localhost。
        // WORKSPACE_PATH 由 executeOnHost 自动注入为 worktreePath。
        env: {
          ...baseEvalEnv,
          BRAIN_URL: 'http://localhost:5221',
          HARNESS_CALLBACK_URL: `http://localhost:5221/api/brain/harness/callback/${containerId}`,
          DB: 'postgresql://localhost/cecelia',
        },
      });
    } catch (err) {
      return { evaluate_verdict: 'FAIL', evaluate_error: `host-exec: ${err.message}` };
    }

    if (!hostResult || hostResult.exit_code !== 0) {
      const detail = hostResult?.timed_out
        ? 'host evaluator timed out'
        : `host evaluator exit_code=${hostResult?.exit_code ?? 'unknown'}`;
      return { evaluate_verdict: 'FAIL', evaluate_error: detail };
    }

    // 镜像 docker 回调路径语义：读 .brain-result.json + schema 校验 → verdict/feedback。
    // 读文件失败 / schema_mismatch → FAIL + evaluate_error（host 路径不 throw，直接收敛）。
    try {
      const data = await readAndValidateBrainResult(state.worktreePath, EvaluatorOutputSchema);
      const normV = normalizeVerdict(data.verdict);
      const feedback = data.feedback || data.log_excerpt || data.failed_step || null;
      return await finalizeEvaluation(state, opts, {
        agentVerdict: normV,
        agentFeedback: feedback,
        transcript: hostResult?.stdout || '',
        brainResult: data,
        sprintDir,
        containerId,
      });
    } catch (e) {
      return { evaluate_verdict: 'FAIL', evaluate_error: `host result read: ${e.message}` };
    }
  }

  // ── docker 路径（local_api / windows_cloud 等，默认）──────────────────────
  try {
    await spawnFn({
      task: { ...task, task_type: 'harness_evaluate' },
      prompt: evaluatePrompt,
      worktreePath: state.worktreePath,
      containerId,
      env: {
        ...baseEvalEnv,
        BRAIN_URL: 'http://host.docker.internal:5221',
        HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
        DB: 'postgresql://host.docker.internal/cecelia',
      },
    });
  } catch (err) {
    return { evaluate_verdict: 'FAIL', evaluate_error: `spawn: ${err.message}` };
  }

  try {
    await dbPool.query(
      // B10: graph_name='harness-task' (统一 namespace) — evaluate_contract 是 task graph 内的节点。
      // lookup router 用 harness-task graph compile，callback resume 用同一 thread_id 才能找到
      // 真正 interrupt 等待的 state。
      `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
       VALUES ($1, $2, 'harness-task', 'spawning')
       ON CONFLICT (container_id) DO NOTHING`,
      [containerId, threadId]
    );
  } catch (err) {
    console.warn(`[harness-task.graph] evaluate thread_lookup INSERT failed cid=${containerId}: ${err.message}`);
  }

  // Await callback via LangGraph interrupt (mirrors awaitCallbackNode pattern).
  const callbackPayload = interrupt({
    type: 'wait_harness_evaluate_callback',
    containerId,
  });

  const cbPayload = callbackPayload || {};
  const exitCode = cbPayload.exit_code !== undefined ? cbPayload.exit_code : 0;
  const stdout = cbPayload.stdout || '';

  if (exitCode !== 0) {
    return {
      evaluate_verdict: 'FAIL',
      evaluate_error: cbPayload.error || `evaluator exit_code=${exitCode}`,
    };
  }

  // Protocol v2 Priority 1: 从约定路径文件读取 verdict（不依赖 LLM stdout 解析）
  // 容器写 ${worktreePath}/.cecelia/verdict.json → { verdict, feedback }
  if (state.worktreePath) {
    const fileVerdict = await readVerdictFile(state.worktreePath);
    if (fileVerdict) {
      const normV = normalizeVerdict(fileVerdict.verdict);
      return await finalizeEvaluation(state, opts, {
        agentVerdict: normV,
        agentFeedback: fileVerdict.feedback || null,
        transcript: stdout,
        brainResult: fileVerdict,
        sprintDir,
        containerId,
      });
    }
  }

  // Protocol v2.5 Fallback: 读 .brain-result.json（harness-evaluator skill 协议）
  // harness-evaluator 写 .brain-result.json 而非 .cecelia/verdict.json，
  // 文件不存在时 readBrainResult 抛异常，catch 后继续 Protocol v1
  if (state.worktreePath) {
    try {
      const brainResult = await readBrainResult(state.worktreePath, ['verdict']);
      const parsed = EvaluatorOutputSchema.safeParse(brainResult);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        console.warn(`[evaluator] schema_mismatch, propagating: ${issues}`);
        const err = new Error(`ContractViolation: schema_mismatch — ${issues}`);
        err.code = 'schema_mismatch';
        throw err;
      }
      const normV = normalizeVerdict(parsed.data.verdict);
      const feedback = parsed.data.feedback || parsed.data.log_excerpt || parsed.data.failed_step || null;
      return await finalizeEvaluation(state, opts, {
        agentVerdict: normV,
        agentFeedback: feedback,
        transcript: stdout,
        brainResult: parsed.data,
        sprintDir,
        containerId,
      });
    } catch (e) {
      if (e.code === 'schema_mismatch') throw e;  // 重新抛出，不被 fallback 吞掉
      // .brain-result.json 不存在或其他错误，继续 Protocol v1 fallback
    }
  }

  // Protocol v1 Fallback: 从 stdout 解析 verdict（旧协议兼容）
  // W37 实证：extractField 比 /verdict:\s*(PASS|FAIL)/i 更可靠（JSON-aware 解析）
  const verdictRaw = extractField(stdout, 'verdict');
  const verdict = normalizeVerdict(verdictRaw);
  const errorMsg = verdict === 'FAIL' ? (cbPayload.error || extractField(stdout, 'error') || 'evaluator returned FAIL') : null;

  return await finalizeEvaluation(state, opts, {
    agentVerdict: verdict,
    agentFeedback: errorMsg,
    transcript: stdout,
    brainResult: null,
    sprintDir,
    containerId,
  });
}

export function routeAfterFix(state) {
  if (state.error) return 'end';
  // B18: 不再 cap fix_round（用户决定不设硬上限）
  // convergence 不是数轮次，是 verdict 真 PASS；MAX_FIX_ROUNDS 常量保留向后兼容
  return 'spawn';
}

export function buildHarnessTaskGraph() {
  return new StateGraph(TaskState)
    .addNode('spawn', spawnNode)
    .addNode('await_callback', awaitCallbackNode)
    .addNode('parse_callback', parseCallbackNode)
    // H15 PRD 阶段 2 收尾：verify_generator 在 parse_callback 提到 pr_url 后主动验副作用，
    // 失败 throw ContractViolation → retryPolicy: LLM_RETRY retry 3 次后再爆。
    .addNode('verify_generator', verifyGeneratorNode, { retryPolicy: LLM_RETRY })
    .addNode('poll_ci', pollCiNode)
    .addNode('evaluate_contract', evaluateContractNode)
    .addNode('merge_pr', mergePrNode)
    .addNode('fix_dispatch', fixDispatchNode)
    .addEdge(START, 'spawn')
    // Fix #1: spawn → 条件边。spawn 返回 {error}（prep/spawn 失败）→ END status=failed，
    // 绝不无条件进 await_callback（否则 interrupt 卡死，conditional edge 永远轮不到）。
    .addConditionalEdges('spawn', routeAfterSpawn, {
      await_callback: 'await_callback', end: END,
    })
    .addConditionalEdges('await_callback', routeAfterCallback, {
      fix: 'fix_dispatch', parse: 'parse_callback', end: END,
    })
    .addConditionalEdges('parse_callback', routeAfterParse, {
      end: END, no_pr: END, poll: 'verify_generator',
    })
    .addEdge('verify_generator', 'poll_ci')
    .addConditionalEdges('poll_ci', routeAfterPoll, {
      end: END, merge: 'merge_pr', evaluate: 'evaluate_contract', fix: 'fix_dispatch', timeout: END, poll: 'poll_ci',
    })
    // P1: end = Contract Gate 命中合同产物（failure_class=contract_invalid）→ 终止 initiative，
    // 不进 generator fix loop（generator 无权改合同，进 fix loop 必空转）。
    .addConditionalEdges('evaluate_contract', routeAfterEvaluate, { merge: 'merge_pr', fix: 'fix_dispatch', end: END })
    .addConditionalEdges('merge_pr', routeAfterMergePr, { end: END, poll: 'poll_ci' })
    .addConditionalEdges('fix_dispatch', routeAfterFix, {
      end: END, failed: END, spawn: 'spawn',
    });
}

export async function compileHarnessTaskGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessTaskGraph().compile({ checkpointer, durability: 'sync' });
}
