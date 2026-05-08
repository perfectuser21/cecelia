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
// Note: legacy `spawn` import removed (Layer 3 uses spawnDockerDetached for fire-and-forget docker run -d)
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
// Note: legacy `writeDockerCallback` import removed (Layer 3 uses callback router POST → Command(resume))
import { spawnDockerDetached } from '../spawn/detached.js';
import { resolveAccount } from '../spawn/middleware/account-rotation.js';
import { checkPrStatus, executeMerge, classifyFailedChecks } from '../shepherd.js';
import { parseDockerOutput, extractField } from '../harness-shared.js';
import { buildGeneratorPrompt, extractWorkstreamIndex } from '../harness-utils.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import pool from '../db.js';

export const MAX_FIX_ROUNDS = 3;
export const MAX_POLL_COUNT = 20;          // 90s × 20 = 30 min
export const POLL_INTERVAL_MS = 90 * 1000;

/**
 * sub-graph state schema
 */
export const TaskState = Annotation.Root({
  task:             Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  contractBranch:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  // Layer 3: containerId 是 spawn 节点 spawn detached 容器的 docker --name，同时也是
  // walking_skeleton_thread_lookup 表 PRIMARY KEY，callback router 反查 thread_id 用。
  // fix_round loop 后 fixDispatchNode 必须 reset 让 spawn 节点重新 spawn fresh container。
  containerId:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_url:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_branch:        Annotation({ reducer: (_o, n) => n, default: () => null }),
  fix_round:        Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  poll_count:       Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  ci_status:        Annotation({ reducer: (_o, n) => n, default: () => 'pending' }),
  ci_fail_type:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  failed_checks:    Annotation({ reducer: (_o, n) => n, default: () => [] }),
  status:           Annotation({ reducer: (_o, n) => n, default: () => 'queued' }),
  cost_usd:         Annotation({ reducer: (c, n) => (c || 0) + (n || 0), default: () => 0 }),
  generator_output: Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:            Annotation({ reducer: (_o, n) => n, default: () => null }),
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
 * @param {Function} [opts.ensureWorktree]
 * @param {Function} [opts.resolveToken]
 * @param {Object}   [opts.poolOverride]     覆盖 pg pool（测试用）
 */
export async function spawnNode(state, opts = {}) {
  // 幂等门 1：已 spawn 过容器就直接 passthrough（防 resume 时重 spawn）
  if (state.containerId) return { containerId: state.containerId };

  const spawnFn = opts.spawnDetached || spawnDockerDetached;
  const ensureWt = opts.ensureWorktree || ensureHarnessWorktree;
  const resolveTok = opts.resolveToken || resolveGitHubToken;
  const dbPool = opts.poolOverride || pool;

  const task = state.task;
  const payload = task?.payload || {};
  const initiativeId = state.initiativeId || payload.parent_task_id || payload.initiative_id || task?.id;
  const fixRound = state.fix_round || 0;
  const fixMode = fixRound > 0;

  let worktreePath = state.worktreePath;
  let token = state.githubToken;

  try {
    if (!worktreePath) worktreePath = await ensureWt({ taskId: task.id, initiativeId });
    if (!token) token = await resolveTok();
  } catch (err) {
    return { error: { node: 'spawn', message: `prep: ${err.message}` } };
  }

  const prompt = buildGeneratorPrompt(task, { fixMode });

  // containerId 必须唯一（fix_round loop 重 spawn 不撞 docker --name）
  // 格式：harness-task-<safeId>-r<round>-<rand8>
  const rand = crypto.randomUUID().slice(0, 8);
  const safeId = String(task.id).replace(/[^a-zA-Z0-9-]/g, '');
  const finalContainerId = `harness-task-${safeId}-r${fixRound}-${rand}`;

  // thread_id 必须跟 harness-initiative.graph runSubTaskNode 用的一致：
  // `harness-task:${initiativeId}:${subTaskId}` —— callback router 用此 lookup
  const threadId = `harness-task:${initiativeId}:${task.id}`;

  // 关键：调 resolveAccount 选 claude account → 注入 CECELIA_CREDENTIALS + CECELIA_MODEL。
  // buildDockerArgs 据此加 -v ~/.claude-accountN:/host-claude-config:ro mount。
  // 漏调 → 容器内 claude CLI "Not logged in" → exit 1 → 0.5s 容器死 → graph 卡 await_callback。
  // (Layer 3 部署 W8 v7 实证 — bug 直到 sub_task fanout 才暴露)
  const acctOpts = { task: { ...task, task_type: 'harness_task' }, env: {} };
  await resolveAccount(acctOpts, { taskId: task.id });
  const accountEnv = acctOpts.env;

  // spawn detached（不 await 容器跑完）
  try {
    await spawnFn({
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
        GITHUB_TOKEN: token,
        CONTRACT_BRANCH: payload.contract_branch || state.contractBranch || '',
        SPRINT_DIR: payload.sprint_dir || 'sprints',
        BRAIN_URL: 'http://host.docker.internal:5221',
        // CALLBACK_URL 容器跑完 wget 这个 URL POST stdout
        HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${finalContainerId}`,
        WORKSTREAM_INDEX: extractWorkstreamIndex(payload),
        WORKSTREAM_COUNT:
          payload.workstream_count !== undefined && payload.workstream_count !== null
            ? String(payload.workstream_count)
            : '',
        PLANNER_BRANCH: payload.planner_branch || '',
      },
    });
  } catch (err) {
    return { error: { node: 'spawn', message: `spawn: ${err.message}` } };
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
export async function awaitCallbackNode(state) {
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
    return {
      error: { node: 'await_callback', message: errMsg },
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

export async function parseCallbackNode(state) {
  // 幂等门：已有 pr_url 跳过
  if (state.pr_url) {
    return { pr_url: state.pr_url, pr_branch: state.pr_branch };
  }
  const out = state.generator_output || '';
  const parsed = parseDockerOutput(out);
  const pr_url = extractField(parsed, 'pr_url');
  const pr_branch = extractField(parsed, 'pr_branch');
  return { pr_url, pr_branch };
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
    return { ci_status: 'timeout', poll_count: pollCount };
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
    return {
      ci_status: 'fail',
      poll_count: pollCount + 1,
      error: { node: 'poll_ci', message: 'PR closed externally' },
    };
  }
  if (info.ciStatus === 'ci_passed' || info.ciStatus === 'merged') {
    return { ci_status: 'pass', poll_count: pollCount + 1 };
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

export async function mergePrNode(state) {
  if (state.status === 'merged') return { status: 'merged' };
  try {
    executeMerge(state.pr_url);
    return { status: 'merged', ci_status: 'merged' };
  } catch (err) {
    return { status: 'failed', error: { node: 'merge_pr', message: err.message } };
  }
}

export async function fixDispatchNode(state) {
  const next = (state.fix_round || 0) + 1;
  return {
    fix_round: next,
    generator_output: null,
    // Layer 3：必须 reset containerId 否则 spawn 节点幂等门 short-circuit，永远不会重 spawn
    containerId: null,
    pr_url: null,
    pr_branch: null,
    poll_count: 0,
    ci_status: 'pending',
    ci_fail_type: null,
    failed_checks: [],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 路由函数

function routeAfterParse(state) {
  if (state.error) return 'end';
  if (!state.pr_url) return 'no_pr';
  return 'poll';
}
function routeAfterPoll(state) {
  if (state.error) return 'end';
  if (state.ci_status === 'pass' || state.ci_status === 'merged') return 'merge';
  if (state.ci_status === 'fail') return 'fix';
  if (state.ci_status === 'timeout') return 'timeout';
  return 'poll'; // pending → loop
}
function routeAfterFix(state) {
  if (state.error) return 'end';
  if (state.fix_round > MAX_FIX_ROUNDS) return 'failed';
  return 'spawn';
}

export function buildHarnessTaskGraph() {
  return new StateGraph(TaskState)
    .addNode('spawn', spawnNode)
    .addNode('await_callback', awaitCallbackNode)
    .addNode('parse_callback', parseCallbackNode)
    .addNode('poll_ci', pollCiNode)
    .addNode('merge_pr', mergePrNode)
    .addNode('fix_dispatch', fixDispatchNode)
    .addEdge(START, 'spawn')
    .addEdge('spawn', 'await_callback')
    .addEdge('await_callback', 'parse_callback')
    .addConditionalEdges('parse_callback', routeAfterParse, {
      end: END, no_pr: END, poll: 'poll_ci',
    })
    .addConditionalEdges('poll_ci', routeAfterPoll, {
      end: END, merge: 'merge_pr', fix: 'fix_dispatch', timeout: END, poll: 'poll_ci',
    })
    .addEdge('merge_pr', END)
    .addConditionalEdges('fix_dispatch', routeAfterFix, {
      end: END, failed: END, spawn: 'spawn',
    });
}

export async function compileHarnessTaskGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessTaskGraph().compile({ checkpointer, durability: 'sync' });
}
