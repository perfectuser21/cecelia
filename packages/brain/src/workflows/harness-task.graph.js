/**
 * Harness Task Sub-Graph — 单 sub-task 全周期 LangGraph。
 *
 * 替代 harness-task-dispatch.js + harness-watcher.js 的 procedural CI 轮询。
 *
 * 节点拓扑：
 *   START
 *     → spawn_generator      （内联 executeInDocker + writeDockerCallback）
 *     → parse_callback        （提取 pr_url 写 state）
 *     → conditional: 无 pr_url → END status=no_pr
 *     → poll_ci               （checkPrStatus，HARNESS_POLL_INTERVAL_MS 默认 90s，max 20 polls = 30 min）
 *     → conditional:
 *           ci_pass → merge_pr → END status=merged
 *           ci_fail → fix_dispatch (state.fix_round++)
 *               → conditional: fix_round<=MAX → spawn_generator (loop)
 *                              fix_round>MAX → END status=failed
 *           ci_pending → poll_ci (loop, 内置 sleep)
 *           ci_timeout → END status=timeout
 *
 * Brain 重启 PostgresSaver thread_id=`harness-task:${initiativeId}:${subTaskId}` resume。
 * 每节点首句加幂等门防 resume 重 spawn。
 *
 * Spec: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md §3.2
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import crypto from 'node:crypto';
import { spawn } from '../spawn/index.js';
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { writeDockerCallback } from '../docker-executor.js';
import { checkPrStatus, executeMerge, classifyFailedChecks } from '../shepherd.js';
import { parseDockerOutput, extractField } from '../harness-graph.js';
import { buildGeneratorPrompt, extractWorkstreamIndex } from '../harness-utils.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';

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

export async function spawnGeneratorNode(state, opts = {}) {
  // 幂等门：resume 时已有 output 直接返回
  if (state.generator_output) return { generator_output: state.generator_output };

  const executor = opts.executor || spawn;
  const ensureWt = opts.ensureWorktree || ensureHarnessWorktree;
  const resolveTok = opts.resolveToken || resolveGitHubToken;
  const writeCb = opts.writeCallback || writeDockerCallback;

  const task = state.task;
  const payload = task?.payload || {};
  const initiativeId = state.initiativeId || payload.parent_task_id || payload.initiative_id || task?.id;
  const fixMode = (state.fix_round || 0) > 0;

  let worktreePath = state.worktreePath;
  let token = state.githubToken;

  try {
    if (!worktreePath) worktreePath = await ensureWt({ taskId: task.id, initiativeId });
    if (!token) token = await resolveTok();
  } catch (err) {
    return { error: { node: 'spawn_generator', message: `prep: ${err.message}` } };
  }

  const prompt = buildGeneratorPrompt(task, { fixMode });

  let result;
  try {
    result = await executor({
      task: { ...task, task_type: 'harness_task' },
      prompt,
      worktreePath,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_task',
        HARNESS_NODE: 'generator',
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_TASK_ID: task.id,
        HARNESS_FIX_MODE: fixMode ? 'true' : 'false',
        GITHUB_TOKEN: token,
        CONTRACT_BRANCH: payload.contract_branch || state.contractBranch || '',
        SPRINT_DIR: payload.sprint_dir || 'sprints',
        BRAIN_URL: 'http://host.docker.internal:5221',
        WORKSTREAM_INDEX: extractWorkstreamIndex(payload),
        WORKSTREAM_COUNT:
          payload.workstream_count !== undefined && payload.workstream_count !== null
            ? String(payload.workstream_count)
            : '',
        PLANNER_BRANCH: payload.planner_branch || '',
      },
    });
  } catch (err) {
    return { error: { node: 'spawn_generator', message: `spawn: ${err.message}` } };
  }

  if (!result || result.exit_code !== 0) {
    const detail = result?.stderr?.slice(0, 500) || `exit_code=${result?.exit_code}`;
    return { error: { node: 'spawn_generator', message: `container: ${detail}` } };
  }

  // 写 callback_queue（失败不污染成功状态）
  try {
    const runId = crypto.randomUUID();
    await writeCb({ ...task, task_type: 'harness_task' }, runId, null, result);
  } catch (err) {
    console.error(`[harness-task.graph] writeDockerCallback failed task=${task.id}: ${err.message}`);
  }

  return {
    generator_output: result.stdout,
    worktreePath,
    githubToken: token,
    cost_usd: result.cost_usd || 0,
  };
}

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
    .addNode('spawn_generator', spawnGeneratorNode)
    .addNode('parse_callback', parseCallbackNode)
    .addNode('poll_ci', pollCiNode)
    .addNode('merge_pr', mergePrNode)
    .addNode('fix_dispatch', fixDispatchNode)
    .addEdge(START, 'spawn_generator')
    .addEdge('spawn_generator', 'parse_callback')
    .addConditionalEdges('parse_callback', routeAfterParse, {
      end: END, no_pr: END, poll: 'poll_ci',
    })
    .addConditionalEdges('poll_ci', routeAfterPoll, {
      end: END, merge: 'merge_pr', fix: 'fix_dispatch', timeout: END, poll: 'poll_ci',
    })
    .addEdge('merge_pr', END)
    .addConditionalEdges('fix_dispatch', routeAfterFix, {
      end: END, failed: END, spawn: 'spawn_generator',
    });
}

export async function compileHarnessTaskGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessTaskGraph().compile({ checkpointer });
}
