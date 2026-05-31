/**
 * Harness v2 — Initiative Graph（Phase A + B LangGraph 实现）
 *
 * 唯一执行路径：executor.js harness_initiative → compileHarnessFullGraph()
 * Phase A: prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert
 * Phase B: pick_sub_task → run_sub_task（loop）→ report
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import pool from '../db.js';
import { spawn } from '../spawn/index.js';
import { spawnDockerDetached } from '../spawn/detached.js';
import { resolveAccount } from '../spawn/middleware/account-rotation.js';
import { parseDockerOutput, loadSkillContent } from '../harness-shared.js';
import { parseTaskPlan, upsertTaskPlan } from '../harness-dag.js';
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
// B17 + B32: brain 代为 push 用 execFile（B17 加 final_evaluate PR_BRANCH fallback，B32 加 propose_branch fallback）
const execFileDefault = promisify(execFileCb);
const execFile = execFileDefault;
// 走 C3 shim (../harness-gan-graph.js) 而非直连 workflows/harness-gan.graph.js，
// 保持测试 vi.mock('../../harness-gan-graph.js') 路径兼容。
// Phase C7 清 shim 前不改。
import { runGanContractGraph } from '../harness-gan-graph.js';
import { killInitiativeContainers } from '../harness-container-cleanup.js';

const DEFAULT_TIMEOUT_SEC = 21600; // 6h，对齐 initiative_contracts.timeout_sec 默认
const DEFAULT_BUDGET_USD = 10;

/** 生成 goal-based Stop hook settings JSON（与 executor.js buildGoalSettings 相同格式） */
function buildHarnessGoalSettings(goalCondition) {
  if (!goalCondition) return null;
  return JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{
          type: 'prompt',
          prompt: `Has the following goal been achieved based on the conversation? Goal: ${goalCondition}\n\nAnswer YES only if you can confirm from the conversation that the goal is met. Answer NO otherwise.`,
          model: 'claude-haiku-4-5-20251001',
        }],
      }],
    },
  });
}

const HARNESS_PHASE_GOALS = {
  planner:  'The task-plan.json file has been written to the sprint directory and all workstreams are defined',
  evaluate: 'The evaluation is complete and .brain-result.json has been written with verdict=PASS or FAIL',
  generator: 'The workstream implementation PR has been created and pushed to GitHub',
};

// ─── Brain v2 C8a — LangGraph 真图实现（阶段 A）────────────────────────
// harness_initiative 任务的唯一执行路径（dispatcher → executor → compileHarnessFullGraph）。
//
// 节点拓扑：START → prep → planner → parsePrd → ganLoop → dbUpsert → END
//                    ↓error  ↓error    ↓error    ↓error
//                    └────────┴──────────┴─────────┴──────→ END (条件 edge)
//
// 每节点首句幂等门防 LangGraph resume 重 spawn（C6 smoke 教训）。
// PRD: docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md

import { StateGraph, Annotation, START, END, interrupt } from '@langchain/langgraph';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import { LLM_RETRY, DB_RETRY, NO_RETRY } from './retry-policies.js';
// 注：上方 imports 已含 spawn / parseDockerOutput / loadSkillContent / parseTaskPlan /
// upsertTaskPlan / ensureHarnessWorktree / resolveGitHubToken / runGanContractGraph

async function emitLangGraphStep(dbPool, taskId, payload) {
  if (!taskId) return;
  try {
    await dbPool.query(
      `INSERT INTO cecelia_events (event_type, source, task_id, payload)
       VALUES ('langgraph_step', 'harness-initiative', $1::uuid, $2::jsonb)`,
      [taskId, JSON.stringify(payload)]
    );
  } catch (err) {
    console.warn('[harness-initiative] emitLangGraphStep failed:', err.message);
  }
}

export const InitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  sprintDir:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
  planner_session:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluator_session: Annotation({ reducer: (_o, n) => n, default: () => null }),
});

// 节点 stub — Task 2-6 逐个填充。
export async function prepInitiativeNode(state) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    const initiativeId = state.task?.payload?.initiative_id || state.task?.initiative_id || state.task?.id;
    const baseRepo = state.task?.payload?.base_repo || undefined;
    const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId, baseRepo });
    const githubToken = await resolveGitHubToken();
    return { worktreePath, githubToken, initiativeId };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
export async function runPlannerNode(state, opts = {}) {
  // 幂等门：已有 plannerOutput 直接 passthrough（resume 后重跑此节点时）
  if (state.plannerOutput) return { plannerOutput: state.plannerOutput };
  // 幂等门：已 spawn 过（有 containerId）说明在等 callback，重新 interrupt
  if (state.planner_container_id) {
    const callbackPayload = interrupt({
      type: 'wait_planner_callback',
      containerId: state.planner_container_id,
    });
    const { exit_code, stdout, error: cbErr } = callbackPayload || {};
    if (exit_code !== 0) {
      const detail = cbErr || (stdout || '').slice(-300);
      return { error: { node: 'planner', message: `Planner exit=${exit_code}: ${detail}` } };
    }
    const plannerOutput = parseDockerOutput(stdout ?? '');
    return { plannerOutput };
  }

  const spawnFn = opts.spawnDetached || spawnDockerDetached;
  const dbPool = opts.pool || opts.poolOverride || pool;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  const initiativeId = state.initiativeId || state.task?.id;
  const skillContent = loadSkillContent('harness-planner');

  const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${state.task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task.description || state.task.title || ''}

## PrepPRD（产品语言，用户确认过的需求文档）
${state.task?.payload?.prep_prd_body || '（未提供，Planner 从 sprint-prd.md 推断）'}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. sprint-prd.md 写完后，在最后一行输出：{"verdict":"DONE","sprint_dir":"${sprintDir}"}` ;

  const rand = crypto.randomUUID().slice(0, 8);
  const safeTaskId = String(state.task?.id || initiativeId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
  const containerId = `harness-planner-${safeTaskId}-${rand}`;
  // thread_id 优先用 opts.configurable.thread_id（LangGraph 运行时注入），兜底用计算值
  const threadId = opts.configurable?.thread_id || `harness-initiative:${initiativeId}:planner`;

  const acctOpts = { task: { ...state.task, task_type: 'harness_planner' }, env: {} };
  try {
    await resolveAccount(acctOpts, { taskId: state.task.id });
  } catch (err) {
    console.warn(`[harness-initiative] resolveAccount failed: ${err.message}`);
  }

  try {
    await spawnFn({
      task: { ...state.task, task_type: 'harness_planner' },
      prompt,
      worktreePath: state.worktreePath,
      containerId,
      env: {
        ...acctOpts.env,
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        CECELIA_JOURNEY_ID: state.task?.payload?.journey_id || '',
        GITHUB_TOKEN: state.githubToken,
        HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
        ...(buildHarnessGoalSettings(HARNESS_PHASE_GOALS.planner)
          ? { CECELIA_GOAL_SETTINGS: buildHarnessGoalSettings(HARNESS_PHASE_GOALS.planner) }
          : {}),
      },
    });
  } catch (err) {
    return { error: { node: 'planner', message: `spawn: ${err.message}` } };
  }

  try {
    await dbPool.query(
      `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
       VALUES ($1, $2, 'harness-initiative', 'spawning')
       ON CONFLICT (container_id) DO NOTHING`,
      [containerId, threadId]
    );
  } catch (err) {
    console.warn(`[harness-initiative] thread_lookup INSERT failed cid=${containerId}: ${err.message}`);
  }

  const callbackPayload = interrupt({
    type: 'wait_planner_callback',
    containerId,
  });

  const { exit_code, stdout, error: callbackError } = callbackPayload || {};
  if (exit_code !== 0) {
    const detail = callbackError || (stdout || '').slice(-300);
    return { error: { node: 'planner', message: `Planner exit=${exit_code}: ${detail}` } };
  }
  const plannerOutput = parseDockerOutput(stdout ?? '');
  return { plannerOutput, planner_container_id: containerId };
}
export async function parsePrdNode(state) {
  if (state.taskPlan && state.prdContent) {
    return { taskPlan: state.taskPlan, prdContent: state.prdContent, sprintDir: state.sprintDir };
  }
  let taskPlan = null;
  try {
    taskPlan = parseTaskPlan(state.plannerOutput);
  } catch (err) {
    // Planner v8 does not output task-plan.json — that is OK, inferTaskPlanNode reads from propose branch
    console.warn(`[harness-initiative-graph] parsePrd: parseTaskPlan returned null/error (${err.message}), will infer from propose branch`);
    taskPlan = null;
  }
  if (taskPlan && (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id)) {
    taskPlan.initiative_id = state.initiativeId;
  }
  let sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  // B35+B36: 从 planner verdict JSON 提取 sprint_dir，取最后一个（verdict 在输出末尾）
  const sprintDirMatches = [...(state.plannerOutput || '').matchAll(/"sprint_dir"\s*:\s*"([^"]+)"/g)];
  if (sprintDirMatches.length > 0) sprintDir = sprintDirMatches.at(-1)[1];
  // B37+B40: 检测 planner 实际新建的 sprint 目录
  // git log 覆盖 origin/main..HEAD 整条历史（比 git diff HEAD 更可靠，HEAD 可能是 GAN propose 分支）
  if (state.worktreePath) {
    try {
      const { stdout: logOut } = await execFile('git',
        ['log', '--diff-filter=A', '--name-only', '--format=', 'origin/main..HEAD', '--', 'sprints/'],
        { cwd: state.worktreePath }
      );
      const allMatches = [...logOut.matchAll(/sprints\/([^/\n]+)\//g)];
      const newSprintMatch = allMatches.at(-1);
      if (newSprintMatch) {
        sprintDir = `sprints/${newSprintMatch[1]}`;
      } else if (!logOut.trim()) {
        // B40: git log 无新增文件（未 commit），fallback 到文件系统检测
        try {
          const { stdout: findOut } = await execFile('find',
            [path.join(state.worktreePath, 'sprints'), '-maxdepth', '1', '-mindepth', '1', '-type', 'd'],
            { cwd: state.worktreePath }
          );
          const dirs = findOut.trim().split('\n').filter(Boolean);
          if (dirs.length === 1) {
            sprintDir = path.relative(state.worktreePath, dirs[0]);
          } else if (dirs.length > 1) {
            console.warn(`[parsePrdNode] B40: found ${dirs.length} sprint subdirs, cannot auto-detect. Keeping ${sprintDir}`);
          }
        } catch { /* sprints/ 子目录未找到，保持已有 sprintDir */ }
      }
    } catch { /* git log 失败，保持已有 sprintDir */ }
  }
  let prdContent = state.plannerOutput || '';
  try {
    prdContent = await readFile(
      path.join(state.worktreePath, sprintDir, 'sprint-prd.md'),
      'utf8'
    );
  } catch {
    // B34: defense-in-depth — planner may create sprints/{name}/ subdirectory.
    try {
      const entries = await readdir(path.join(state.worktreePath, sprintDir), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          prdContent = await readFile(
            path.join(state.worktreePath, sprintDir, entry.name, 'sprint-prd.md'),
            'utf8'
          );
          sprintDir = path.join(sprintDir, entry.name);
          break;
        } catch { /* keep scanning */ }
      }
      if (prdContent === state.plannerOutput || prdContent === '') {
        // Still not found in subdir, log error and fallback
        console.error(`[harness-initiative-graph] read sprint-prd.md failed in all subdirs, falling back to planner stdout`);
      }
    } catch (readdirErr) {
      console.error(`[harness-initiative-graph] readdir failed (${readdirErr.message}), falling back to planner stdout`);
    }
  }
  return { taskPlan, prdContent, sprintDir };  // taskPlan may be null — that is OK
}
export async function runGanLoopNode(state, opts = {}) {
  if (state.ganResult) return { ganResult: state.ganResult };
  const dbPool = opts.pool || pool;
  await emitLangGraphStep(dbPool, state.initiativeId, { node: 'proposer', status: 'started' });
  try {
    const executor = opts.executor || spawn;
    const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
    const budgetUsd = state.task?.payload?.budget_usd || DEFAULT_BUDGET_USD;
    // LangGraph runtime 不会把父 graph 的 checkpointer 注入子节点 opts；
    // 当 opts.checkpointer 缺失（生产实际场景）时，自己 getPgCheckpointer 兜底。
    // Stream 2 v1.229.0 起 runGanContractGraph fail-fast if !checkpointer，
    // 必须显式传，否则 ganLoop 直接 throw "checkpointer is required"。
    const checkpointer = opts.checkpointer || await getPgCheckpointer();
    const ganResult = await runGanContractGraph({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      plannerOutput: state.plannerOutput || '',
      budgetCapUsd: budgetUsd,
      checkpointer,
      baseRepo: state.task?.payload?.base_repo || undefined,
    });
    await emitLangGraphStep(dbPool, state.initiativeId, {
      node: 'reviewer',
      review_round: ganResult.rounds || 1,
      review_verdict: ganResult.verdict || null,
    });
    return { ganResult };
  } catch (err) {
    return { error: { node: 'gan', message: err.message } };
  }
}
export async function dbUpsertNode(state, opts = {}) {
  if (state.result?.contractId) return { result: state.result };
  const dbPool = opts.pool || pool;
  const timeoutSec = state.task?.payload?.timeout_sec || DEFAULT_TIMEOUT_SEC;
  const budgetUsd = state.task?.payload?.budget_usd || DEFAULT_BUDGET_USD;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: state.initiativeId,
      initiativeTaskId: state.task.id,
      taskPlan: state.taskPlan,
      client,
      contractBranch: state.ganResult.propose_branch || null,
    });
    // B40: 把运行时检测到的 sprint_dir 写入子任务 payload，确保 Brain 重启后 dispatcher 从 DB dispatch 时路径正确
    const effectiveSprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
    if (insertedTaskIds?.length > 0 && effectiveSprintDir !== 'sprints') {
      await client.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
         WHERE id = ANY($1::uuid[])`,
        [insertedTaskIds, JSON.stringify({ sprint_dir: effectiveSprintDir })]
      );
    }
    // ON CONFLICT (B13): dbUpsertNode 是 graph 节点，restart resume 时 retry 必须幂等。
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, branch, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (initiative_id, version) DO UPDATE SET
         status = EXCLUDED.status,
         prd_content = EXCLUDED.prd_content,
         contract_content = EXCLUDED.contract_content,
         review_rounds = EXCLUDED.review_rounds,
         budget_cap_usd = EXCLUDED.budget_cap_usd,
         timeout_sec = EXCLUDED.timeout_sec,
         branch = EXCLUDED.branch,
         approved_at = NOW()
       RETURNING id`,
      [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec, state.ganResult.propose_branch || null]
    );
    const contractId = contractInsert.rows[0].id;
    const journeyType = state.taskPlan?.journey_type || 'autonomous';
    const journeyId = state.task?.payload?.journey_id || null;
    const runInsert = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, contract_id, phase,
         deadline_at, journey_type, journey_id
       )
       VALUES ($1::uuid, $2::uuid, 'B_task_loop',
         NOW() + ($3 || ' seconds')::interval,
         $4, $5
       )
       RETURNING id`,
      [state.initiativeId, contractId, String(timeoutSec), journeyType, journeyId]
    );
    const runId = runInsert.rows[0].id;
    await client.query('COMMIT');
    return {
      result: {
        success: true,
        taskId: state.task.id,
        initiativeId: state.initiativeId,
        contractId,
        runId,
        insertedTaskIds,
        idMap,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    return { error: { node: 'dbUpsert', message: `tx: ${err.message}` } };
  } finally {
    client.release();
  }
}

export function stateHasError(state) { return state.error ? 'error' : 'ok'; }

export function buildHarnessInitiativeGraph() {
  return new StateGraph(InitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
    .addEdge('dbUpsert', END);
}

export async function compileHarnessInitiativeGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessInitiativeGraph().compile({ checkpointer, durability: 'sync' });
}

// ─── Sprint 1: 全图（Phase A+B+C 一个 graph 跑到底） ─────────────────────
//
// 在 C8a Phase A graph 之上扩 fanout/run_sub_task/join/final_e2e/report 节点。
// 砍 Phase B/C 的 6 个 procedural module（harness-task-dispatch / harness-watcher /
// harness-phase-advancer / harness-final-e2e.runFinalE2E 编排 / harness-initiative-runner.runPhaseCIfReady /
// shepherd 中 harness 分支）+ 4 task_type（harness_task / harness_ci_watch / harness_fix / harness_final_e2e）。
//
// Spec: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md
// Plan: docs/superpowers/plans/2026-04-26-harness-langgraph-full-graph.md

import { buildHarnessTaskGraph as _buildTaskGraph } from './harness-task.graph.js';

/**
 * Full Initiative State：复用 InitiativeState 字段 + sub_tasks (merge by id) +
 * final_e2e_verdict + final_e2e_failed_scenarios + report_path。
 *
 * 注：sub_task (单数) 字段用于 Send fanout 把子状态注入 run_sub_task node。
 * sub_tasks (复数) 是累计聚合，reducer = mergeBy id。
 */
export const FullInitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  sprintDir:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
  contract:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  contractBranch: Annotation({ reducer: (_o, n) => n, default: () => null }),

  // Send fanout 注入子状态
  sub_task:       Annotation({ reducer: (_o, n) => n, default: () => null }),

  // 累计：merge by id
  sub_tasks: Annotation({
    reducer: (curr, upd) => {
      if (!Array.isArray(upd) || upd.length === 0) return curr || [];
      const map = new Map((curr || []).map((s) => [s.id, s]));
      for (const s of upd) map.set(s.id, { ...(map.get(s.id) || {}), ...s });
      return [...map.values()];
    },
    default: () => [],
  }),
  all_sub_tasks_done: Annotation({ reducer: (_o, n) => n, default: () => false }),
  final_e2e_verdict: Annotation({ reducer: (_o, n) => n, default: () => null }),
  final_e2e_failed_scenarios: Annotation({ reducer: (_o, n) => n, default: () => [] }),
  report_path: Annotation({ reducer: (_o, n) => n, default: () => null }),
  // Serial evaluate loop state
  task_loop_index:    Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  task_loop_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  evaluate_verdict:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluate_feedback:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  final_e2e_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
});

/**
 * inferTaskPlanNode: graph node — 在 fanout 前保证 state.taskPlan.tasks 非空。
 *
 * 幂等：state.taskPlan?.tasks?.length >= 1 → passthrough。
 * Fallback: spawn 一个 docker LLM 子任务，喂 PRD + Contract，让其拆 task-plan.json。
 *           失败时 passthrough（不阻断 graph，让下游 join 走自然 FAIL 路径）。
 *
 * 解决：Planner SKILL 没输出合规 task_plan 时，fanout 看不到 tasks 直接跳 join，
 *      Final E2E 找不到 sub_task 报 FAIL（Sprint 1 E2E-v10 真实根因）。
 *
 * @param {object} state  FullInitiativeState
 * @param {object} [opts]
 * @param {Function} [opts.executor]  spawn 替代（测试注入）
 * @returns {Promise<object>}  state delta（{} 或 { taskPlan: {...} }）
 */
export async function inferTaskPlanNode(state, _opts = {}) {
  const existing = state?.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }

  const proposeBranch = state?.ganResult?.propose_branch;
  const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';

  if (!proposeBranch) {
    console.warn('[infer_task_plan] no propose_branch in ganResult, cannot read task-plan.json');
    return {};
  }

  // B32: verify propose_branch 真在 origin。LLM 工艺不稳定（W42 proposer container
  // exit=0 但 git push 没真跑），brain 必须 verify 关键 side effect。
  // 如果 origin 没这个 branch，brain 代为 push（worktree 内 commits 已在）。
  // 通用模式：LLM action + brain verify + brain fallback execute。
  if (state.worktreePath) {
    try {
      const { stdout: lsRemote } = await execFile(
        'git',
        ['ls-remote', '--heads', 'origin', proposeBranch],
        { cwd: state.worktreePath, timeout: 30_000 }
      );
      if (!lsRemote.trim()) {
        console.warn(`[infer_task_plan] B32 propose_branch ${proposeBranch} 不在 origin，brain 代为 push`);
        try {
          await execFile(
            'git',
            ['push', 'origin', proposeBranch],
            { cwd: state.worktreePath, timeout: 60_000 }
          );
          console.log(`[infer_task_plan] B32 brain 代 push 成功: ${proposeBranch}`);
        } catch (pushErr) {
          // push 失败（branch 不存在 / 权限等）→ 让 ContractViolation 走原路径
          console.error(`[infer_task_plan] B32 brain 代 push 失败: ${pushErr.message}`);
        }
      }
    } catch (lsErr) {
      // ls-remote 失败（网络/credentials）→ silent fail，让原 fetchAndShowOriginFile 继续尝试
      console.warn(`[infer_task_plan] B32 ls-remote 失败: ${lsErr.message}（继续尝试 fetch）`);
    }
  }

  try {
    // 防御：proposer 在 task container 内 git push 后，brain 容器本地 origin tracking 不会自动更新。
    // fetchAndShowOriginFile 内部用 refspec `origin/<branch>:refs/remotes/origin/<branch>` 显式更新，
    // 修 PR #2838 的 `git fetch origin <branch>` 只更新 FETCH_HEAD 不更新 remote ref 的 bug。
    const json = await fetchAndShowOriginFile(
      state.worktreePath,
      proposeBranch,
      `${sprintDir}/task-plan.json`
    );
    let plan;
    try {
      plan = parseTaskPlan(json);
    } catch (err) {
      console.warn(`[infer_task_plan] parseTaskPlan failed: ${err.message}`);
      return {};
    }
    if (plan.initiative_id === 'pending' || !plan.initiative_id) {
      plan.initiative_id = state.initiativeId;
    }
    console.log(`[infer_task_plan] read ${plan.tasks?.length || 0} tasks from ${proposeBranch}:${sprintDir}/task-plan.json`);
    return { taskPlan: plan };
  } catch (err) {
    const msg = `[infer_task_plan] git show origin/${proposeBranch}:${sprintDir}/task-plan.json failed: ${err.message}`;
    console.error(msg);
    return { error: msg };  // 走 stateHasError → error → END，触发 alert（不再静默"软坏"）
  }
}


// Layer 3: sub-graph 现在用 interrupt()，必须传 checkpointer。否则 invoke() 抛
// "No checkpointer set"。这里用 PG checkpointer（生产）；测试可以注 opts.compiledTaskGraph。
let _taskGraphCompiledCache = null;
let _taskGraphCompilePromise = null;
async function _getTaskGraphCompiled() {
  if (_taskGraphCompiledCache) return _taskGraphCompiledCache;
  if (_taskGraphCompilePromise) return _taskGraphCompilePromise;
  _taskGraphCompilePromise = (async () => {
    const checkpointer = await getPgCheckpointer();
    _taskGraphCompiledCache = _buildTaskGraph().compile({ checkpointer, durability: 'sync' });
    return _taskGraphCompiledCache;
  })();
  return _taskGraphCompilePromise;
}

// 测试 hook
export function _resetTaskGraphCacheForTests() {
  _taskGraphCompiledCache = null;
  _taskGraphCompilePromise = null;
}

/**
 * Layer 3：sub-graph 现在是 spawn-and-interrupt 模式（spawn 节点 detached docker run -d 后
 * await_callback 节点 interrupt() yield）。compiled.invoke() 返回时 sub-graph 通常停在
 * await_callback（next=['await_callback']），此时 final.status 是 undefined。
 *
 * runSubTaskNode 必须等 callback router 收到容器 POST → Command(resume) 把 sub-graph
 * 推到 END 才能拿到真实 final.status。这里走 polling getState 直到 next=[]。
 *
 * 超时：max 90 min（兼容老 executor 行为；env override CECELIA_SUBGRAPH_WAIT_MS）。
 *
 * 注意：runSubTaskNode 自己仍然是阻塞节点（在父 fanout 内 Send 派一个实例）。把父 graph
 * 也改成 spawn-and-interrupt 是 Layer 4 范畴。Layer 3 只解决子 graph 层面 spawn 不阻塞 +
 * brain restart 持久化（sub-graph 持久化在 PG checkpointer 上，runSubTaskNode 重启后会
 * 重新 poll）。
 */
const SUBGRAPH_WAIT_MS = parseInt(process.env.CECELIA_SUBGRAPH_WAIT_MS || `${90 * 60 * 1000}`, 10);
const SUBGRAPH_POLL_INTERVAL_MS = parseInt(process.env.CECELIA_SUBGRAPH_POLL_MS || '30000', 10);

// 默认每 12 次 poll（12 × 5s = 60s）做一次容器 liveness check
const LIVENESS_CHECK_EVERY_N = parseInt(process.env.CECELIA_LIVENESS_CHECK_N || '12', 10);

/**
 * 检查 Docker 容器是否仍在 running。
 * 如果容器 exited / dead，或 docker inspect 失败（容器不存在），视为死亡返回非空错误字符串。
 * 容器仍在 running 返回 null。
 *
 * @param {string} containerId
 * @returns {Promise<string|null>}  死亡原因描述 or null（还活着）
 */
async function _checkContainerLiveness(containerId) {
  return new Promise((resolve) => {
    execFileCb('docker', ['inspect', '--format', '{{.State.Status}}', containerId], (err, stdout) => {
      if (err) {
        // 只有明确"容器不存在"才视为死亡，其他错误保守返回 null 避免误判
        if (err.message && (err.message.includes('No such') || err.message.includes('not found'))) {
          resolve(`container_inspect_failed: ${err.message}`);
        } else {
          resolve(null);
        }
        return;
      }
      const status = (stdout || '').trim();
      resolve((status === 'exited' || status === 'dead') ? `container_${status}_without_callback` : null);
    });
  });
}

/**
 * 检查 GitHub PR 是否已 merged。
 * B1 fix: container 死亡时先验 PR 状态，防止已完成 WS 被误标 failed。
 *
 * @param {string} prUrl
 * @returns {Promise<boolean>}
 */
async function _checkPrMerged(prUrl) {
  return new Promise((resolve) => {
    execFileCb('gh', ['pr', 'view', prUrl, '--json', 'state', '-q', '.state'], (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve((stdout || '').trim().toUpperCase() === 'MERGED');
    });
  });
}

/**
 * 等待 sub-graph 完成（轮询 getState 直到 next=[]）。
 *
 * 增加容器活性检测（B2/B3 修复）：每 livenessCheckEveryN 次 poll 检查一次
 * sub-graph state 里的 containerId 是否仍在 running。如果容器已死亡（exited/dead/不存在），
 * 主动通过 compiled.invoke({resume:{status:'failed',...}}, config) 唤醒 sub-graph，
 * 避免傻等 90min 超时。
 *
 * @param {object} compiled          LangGraph compiled graph
 * @param {object} config            LangGraph config（含 thread_id）
 * @param {number} timeoutMs         最长等待时间（默认 90min）
 * @param {object} [opts]            测试注入选项
 * @param {number} [opts.pollIntervalMs]     轮询间隔（默认 SUBGRAPH_POLL_INTERVAL_MS）
 * @param {number} [opts.livenessCheckEveryN] 每 N 次 poll 做一次 liveness check（默认 12）
 */
export async function _waitForSubGraphCompletion(compiled, config, timeoutMs, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs ?? SUBGRAPH_POLL_INTERVAL_MS;
  const livenessCheckEveryN = opts.livenessCheckEveryN ?? LIVENESS_CHECK_EVERY_N;
  // B42: 允许测试注入，避免在生产代码里 mock 全局函数
  const checkLiveness = opts._checkLiveness ?? _checkContainerLiveness;
  const checkPrMerged = opts._checkPrMerged ?? _checkPrMerged;

  const deadline = Date.now() + timeoutMs;
  let pollCount = 0;

  while (Date.now() < deadline) {
    const state = await compiled.getState(config);
    if (!state.next || state.next.length === 0) {
      return state.values;
    }

    // ── 容器活性检测（B2/B3）──────────────────────────────────────────────
    // 每 livenessCheckEveryN 次 poll 检查一次容器是否还活着
    // B42 guard: 仅在 sub-graph 停在 await_callback 时才触发
    // 容器 exit(0) 后 sub-graph 已离开 await_callback 继续运行时，不误判为死亡
    const isAwaitingCallback = Array.isArray(state.next) && state.next.includes('await_callback');
    if (isAwaitingCallback && pollCount % livenessCheckEveryN === 0) {
      const containerId = state.values?.containerId;
      if (containerId) {
        const deathReason = await checkLiveness(containerId);
        if (deathReason) {
          // B1 fix: 先验 PR 是否已 merged，已 merged → success，不走 failure
          const prUrl = state.values?.pr_url;
          if (prUrl) {
            const alreadyMerged = await checkPrMerged(prUrl);
            if (alreadyMerged) {
              console.log(
                `[harness-liveness] Container ${containerId} exited after PR merged (${prUrl}), treating as success`
              );
              return { ...(state.values), status: 'merged' };
            }
          }
          // 容器已死，主动 resume sub-graph 走 failure 路径
          console.warn(
            `[harness-liveness] Container ${containerId} died (${deathReason}), resuming sub-graph with failure`
          );
          try {
            await compiled.invoke(
              { resume: { status: 'failed', error: deathReason } },
              config
            );
          } catch (resumeErr) {
            // resume 失败时记录警告（sub-graph 可能已经在 END 了）
            console.warn(`[harness-liveness] resume invoke failed: ${resumeErr.message}`);
          }
          // resume 后 getState 拿最新状态
          const finalState = await compiled.getState(config);
          return { ...(finalState.values || {}), status: finalState.values?.status || 'failed' };
        }
      }
    }

    pollCount++;
    // 还在中间节点（通常 await_callback interrupt） — 等下一轮 poll
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  // 超时 — 拿当前 state 当 final（status 可能 undefined → join 视作 failed）
  const state = await compiled.getState(config);
  return { ...(state.values || {}), status: state.values?.status || 'failed' };
}

export async function runSubTaskNode(state, opts = {}) {
  const subTask = state.sub_task;
  if (!subTask) return {};
  const _runDbPool = opts.pool || pool;
  await emitLangGraphStep(_runDbPool, state.initiativeId, {
    node: 'generator',
    sub_task_id: subTask.id,
    task_index: state.task_loop_index ?? 0,
  });
  const fixCount = state.task_loop_fix_count ?? 0;
  const feedback = state.evaluate_feedback;
  const taskForGraph = {
    id: subTask.id,
    title: subTask.title,
    description: subTask.description,
    payload: {
      ...subTask.payload,
      // 注入 logical_task_id（如 "ws1"）让 spawnNode extractWorkstreamIndex 解出 WORKSTREAM_INDEX。
      // generator skill 检测到 WORKSTREAM_INDEX 空就 ABORT（dispatch 协议 fail）。
      logical_task_id: subTask.id,
      // B38: 用 parsePrdNode/B37 修正后的 sprintDir 覆盖 subTask.payload.sprint_dir。
      // subTask.payload.sprint_dir = 原始 payload 顶级值（如 "sprints"），未经 git diff 修正。
      // generator spawnNode 读 task.payload.sprint_dir → SPRINT_DIR env，
      // 不覆盖导致 generator 写到顶级 sprints/ 而非正确子目录（W49 实证 B38 根因）。
      ...(state.sprintDir ? { sprint_dir: state.sprintDir } : {}),
      ...(fixCount > 0 && feedback ? { fix_round: fixCount, evaluator_feedback: feedback } : {}),
    },
  };
  const compiled = opts.compiledTaskGraph || await _getTaskGraphCompiled();
  // final_e2e_fix_count 追加到 thread_id：final_evaluate FAIL 重跑时用 fresh checkpoint，避免旧状态污染
  // thread_id 含 fix_count 保证 evaluate_contract FAIL 重试时用 fresh checkpoint
  const config = { configurable: { thread_id: `harness-task:${state.initiativeId}:${subTask.id}:fix${state.final_e2e_fix_count ?? 0}` }, recursionLimit: 200 };
  const waitMs = opts.waitMs !== undefined ? opts.waitMs : SUBGRAPH_WAIT_MS;
  let final;
  try {
    const firstResult = await compiled.invoke(
      {
        task: taskForGraph,
        initiativeId: state.initiativeId,
        // 不传 state.worktreePath — initiative worktree HEAD 在 contract branch（GAN proposer push）。
        // sub_task generator 期待 fresh worktree off main，让 sub-graph spawnNode 自己
        // ensureHarnessWorktree 建独立 worktree（用 sub_task.id 作 key）。
        // worktreePath: state.worktreePath,
        githubToken: state.githubToken,
        contractBranch: state.contractBranch || state.ganResult?.propose_branch || null,
        baseRepo: state.task?.payload?.base_repo || undefined,
        prdContent: state.prdContent || null,
      },
      config
    );
    // Layer 3：sub-graph 可能停在 await_callback interrupt — poll 直到 END
    if (firstResult && firstResult.status && firstResult.status !== 'queued') {
      // Sub-graph 直接走完（无 interrupt 路径，比如 mock spawn 立即返回 generator_output 时）
      final = firstResult;
    } else {
      // sub-graph 大概率停在 await_callback interrupt — poll getState 等到 END
      // opts.waitOpts 供测试注入 pollIntervalMs / livenessCheckEveryN
      final = await _waitForSubGraphCompletion(compiled, config, waitMs, opts.waitOpts || {});
    }
  } catch (err) {
    final = { status: 'failed', error: { node: 'sub_graph', message: err.message } };
  }
  return {
    sub_tasks: [{
      id: subTask.id,
      title: subTask.title,
      status: final.status,
      pr_url: final.pr_url,
      fix_round: final.fix_round,
      cost_usd: final.cost_usd,
      ci_fail_type: final.ci_fail_type,
    }],
  };
}
export async function reportNode(state, opts = {}) {
  // 幂等门：节点重放时 short circuit（state.report_path 已写过 → 已 UPDATE initiative_runs，
  // 重入会重复 UPDATE，虽语义等幂但增加 DB 负载且 completed_at 会刷新）。
  if (state.report_path) return { report_path: state.report_path };
  const dbPool = opts.pool || pool;
  await emitLangGraphStep(dbPool, state.initiativeId, {
    node: 'report',
    evaluator_verdict: state.final_e2e_verdict || null,
    workstreams: (state.sub_tasks || []).map(s => s.id),
    pr_urls: (state.sub_tasks || []).filter(s => s.pr_url).map(s => s.pr_url),
    ws_verdicts: (state.sub_tasks || []).map(s => s.status),
  });

  // Compute step_timing from task_events graph_node_update events (same logic as /detail endpoint)
  let step_timing = [];
  try {
    const { rows: evtRows } = await dbPool.query(
      `SELECT payload, created_at
       FROM task_events
       WHERE task_id = $1::uuid AND event_type = 'graph_node_update'
       ORDER BY created_at ASC`,
      [state.initiativeId]
    );
    for (let i = 0; i < evtRows.length; i++) {
      const p = evtRows[i].payload || {};
      const started_at = new Date(evtRows[i].created_at).toISOString();
      const nextTs = evtRows[i + 1]?.created_at;
      const duration_ms = nextTs
        ? new Date(nextTs).getTime() - new Date(evtRows[i].created_at).getTime()
        : null;
      step_timing.push({ node: p.nodeName || 'unknown', started_at, duration_ms });
    }
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode step_timing query failed: ${err.message}`);
  }

  // Compute ws_issues from sub_tasks (evaluator_feedback + ci_fail_type)
  const ws_issues = (state.sub_tasks || [])
    .filter(s => s.ci_fail_type || s.evaluator_feedback)
    .map(s => ({
      ws_id: s.id,
      feedback: s.evaluator_feedback || null,
      ci_fail_type: s.ci_fail_type || null,
    }));

  // Compute ws_costs from sub_tasks (ws_id + cost_usd)
  const ws_costs = (state.sub_tasks || []).map(s => ({
    ws_id: s.id,
    cost_usd: s.cost_usd || 0,
  }));

  // B45 Fix1: final_e2e_verdict 没有节点主动写时，从 sub_tasks 状态推导
  // 单一 evaluator pre-merge gate 设计：每个 ws evaluate_contract PASS 才能 merge
  // 所以全部 merged = 等价于 Final E2E PASS
  const computedVerdict = state.final_e2e_verdict ||
    ((state.sub_tasks?.length > 0 && state.sub_tasks.every(s => s.status === 'merged'))
      ? 'PASS' : 'FAIL');

  const reportContent = JSON.stringify({
    initiativeId: state.initiativeId,
    sub_tasks: state.sub_tasks || [],
    final_e2e_verdict: computedVerdict,
    failed_scenarios: state.final_e2e_failed_scenarios || [],
    step_timing,
    ws_issues,
    ws_costs,
    cost_usd: (state.sub_tasks || []).reduce((a, s) => a + (s.cost_usd || 0), 0),
    completed_at: new Date().toISOString(),
  }, null, 2);
  // 写 initiative_runs phase=done/failed
  try {
    const phase = computedVerdict === 'PASS' ? 'done' : 'failed';
    if (computedVerdict === 'FAIL') {
      // B45: 使用 computedVerdict（可从 sub_tasks 推导）
      console.error(`[reportNode] computedVerdict=FAIL initiative=${state.initiativeId} → 标 phase='failed'，executor 会标 task.status='failed'`);
    }
    const reason = `Final E2E ${computedVerdict}: ${(state.final_e2e_failed_scenarios || []).map(s => s.name).join('; ').slice(0, 500)}`;
    // B45: 使用 pool.connect() → client.query 确保测试 mock 可验证、支持连接复用
    const client = await dbPool.connect();
    try {
      await client.query(
        `UPDATE initiative_runs SET phase=$2, completed_at=NOW(), updated_at=NOW(),
          failure_reason=CASE WHEN $2='failed' THEN $3 ELSE failure_reason END
         WHERE initiative_id=$1::uuid`,
        [state.initiativeId, phase, reason]
      );
      // B1: 同时回写 tasks.status — 否则 task 永卡 in_progress（graph 不经 executor.js
      // 这条 happy path，注释 line 1107 "executor 会标 task.status='failed'" 仅 FAIL 路径
      // 的 ws-level fallback，PASS 路径无人回写）。W28 实证：13 个 checkpoint 全跑过
      // prep→...→report 但 tasks.status 仓 in_progress。Walking Skeleton P1 修补点。
      const taskStatus = computedVerdict === 'PASS' ? 'completed' : 'failed';
      await client.query(
        `UPDATE tasks SET status=$2::text, completed_at=NOW(), updated_at=NOW(),
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('report_content', $4::jsonb),
          error_message=CASE WHEN $2::text='failed' THEN $3::text ELSE error_message END
         WHERE id=$1::uuid`,
        [state.initiativeId, taskStatus, reason, reportContent]
      );
    } finally {
      client.release();
    }
    // B2 fix: initiative 终态 → 主动 kill 关联容器（zombie 防治）
    killInitiativeContainers(state.initiativeId).catch(err2 =>
      console.warn(`[reportNode] container cleanup failed: ${err2.message}`)
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
  // 派 harness_report 子任务（6 步交付：Notion / 飞书 / harness-report.md）
  try {
    await dbPool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       VALUES ($1, $2, 'harness_report', 'queued', 'P2', $3::jsonb)`,
      [
        `[Harness Report] ${state.task?.title || state.initiativeId}`,
        `Auto-spawned by reportNode for initiative ${state.initiativeId}`,
        JSON.stringify({
          initiative_id: state.initiativeId,
          final_e2e_verdict: state.final_e2e_verdict,
          sprint_dir: state.sprintDir,
          journey_id: state.task?.payload?.journey_id,
          feature_id: state.task?.payload?.feature_id,
          feature_name: state.task?.payload?.feature_name || state.task?.title || '',
          pr_url: (state.sub_tasks || [])[0]?.pr_url || '',
          pr_urls: (state.sub_tasks || []).map((t) => t.pr_url).filter(Boolean),
          sub_tasks: state.sub_tasks || [],
        }),
      ]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode spawn harness_report failed: ${err.message}`);
  }
  return { report_path: reportContent };
}

// ──────────────────────────────────────────────────────────────────────────
// Serial evaluate loop nodes (Change 4)

export async function pickSubTaskNode(state) {
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index ?? 0;
  if (idx >= tasks.length) {
    return { sub_task: null };
  }
  const t = tasks[idx];
  return {
    sub_task: {
      id: t.id || t.task_id,
      title: t.title,
      description: t.scope || t.description,
      payload: { dod: t.dod, files: t.files, depends_on: t.depends_on },
    },
    task_loop_fix_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}

export async function advanceTaskIndexNode(state) {
  // Serial merge gate: 刚完成的 sub-task (tasks[idx]) 必须 merged 才能推进
  const subTasks = state.sub_tasks || [];
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index ?? 0;
  if (subTasks.length > 0 && idx < tasks.length) {
    const currentTask = tasks[idx];
    const currentId = currentTask?.id || currentTask?.task_id;
    const record = subTasks.find((s) => s.id === currentId);
    if (record && record.status !== 'merged') {
      return {
        error: {
          node: 'advance',
          message: `Serial gate: sub-task ${currentId} did not merge (status=${record.status ?? 'undefined'}). Next workstream blocked.`,
        },
      };
    }
  }
  return {
    task_loop_index: idx + 1,
    task_loop_fix_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}

export async function retryTaskNode(state) {
  return {
    task_loop_fix_count: (state.task_loop_fix_count ?? 0) + 1,
    evaluate_verdict: null,
    // Keep evaluate_feedback — run_sub_task will use it as fix context
  };
}

export async function terminalFailNode(state, opts = {}) {
  // 幂等门：节点重放时 short circuit（已写过 initiative_runs phase='failed'，
  // 重入会再次刷 completed_at，不必要的 DB 负载）。
  if (state.error?.node === 'terminal_fail') return { error: state.error };
  const dbPool = opts.pool || pool;
  const reason = `Evaluator FAIL on task index ${state.task_loop_index ?? 0}: ${(state.evaluate_feedback || '').slice(0, 300)}`;
  try {
    await dbPool.query(
      `UPDATE initiative_runs SET phase='failed', failure_reason=$1, completed_at=NOW(), updated_at=NOW() WHERE initiative_id=$2::uuid`,
      [reason.slice(0, 500), state.initiativeId]
    );
    // B2 fix: terminal fail → 主动 kill 关联容器
    killInitiativeContainers(state.initiativeId).catch(err2 =>
      console.warn(`[terminalFailNode] container cleanup failed: ${err2.message}`)
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] terminalFailNode db update failed: ${err.message}`);
  }
  return { error: { node: 'terminal_fail', message: reason } };
}

// Change 5: New routing functions

export function routeFromPickSubTask(state) {
  if (state.error) return 'end';
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index ?? 0;
  if (idx >= tasks.length) return 'report';
  return 'run_sub_task';
}
// ──────────────────────────────────────────────────────────────────────────
// 完整 graph：Phase A + B + C 全程 LangGraph

export function _routeAfterFinalE2E(state) {
  if (state.error) return 'report';
  if (state.final_e2e_verdict === 'PASS' || state.final_e2e_verdict === 'PASS_WITH_OVERRIDE') return 'report';
  return 'pick_sub_task'; // FAIL → 重跑所有 sub-tasks
}

export function buildHarnessFullGraph(nodeOverrides = {}) {
  const {
    runSubTaskFn = runSubTaskNode,
  } = nodeOverrides;
  // 节点级 RetryPolicy（W2）—— 见 packages/brain/src/workflows/retry-policies.js
  // LLM_RETRY: planner / ganLoop / run_sub_task
  // DB_RETRY:  dbUpsert / report
  // NO_RETRY:  prep / parsePrd / inferTaskPlan / pick_sub_task / advance
  // 单一 evaluator 设计：per-task evaluate_contract 节点（IS_FINAL_E2E=true）在 harness-task.graph.js
  // 子图内完成 pre-merge 全量 E2E 验收，initiative graph 不再有独立 final_evaluate 节点。
  // 对齐 Anthropic 官方 Harness 设计（单 evaluator pre-merge 迭代循环）。
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('inferTaskPlan', inferTaskPlanNode, { retryPolicy: NO_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addNode('pick_sub_task', pickSubTaskNode, { retryPolicy: NO_RETRY })
    .addNode('run_sub_task', runSubTaskFn, { retryPolicy: LLM_RETRY })
    .addNode('advance', advanceTaskIndexNode, { retryPolicy: NO_RETRY })
    .addNode('report', reportNode, { retryPolicy: DB_RETRY })
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'inferTaskPlan' })
    .addConditionalEdges('inferTaskPlan', stateHasError, { error: END, ok: 'dbUpsert' })
    .addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'pick_sub_task' })
    .addConditionalEdges('pick_sub_task', routeFromPickSubTask, { run_sub_task: 'run_sub_task', report: 'report', end: END })
    .addEdge('run_sub_task', 'advance')
    .addConditionalEdges('advance', stateHasError, { error: 'report', ok: 'pick_sub_task' })
    .addEdge('report', END);
}

export async function compileHarnessFullGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessFullGraph().compile({ checkpointer, durability: 'sync' });
}
