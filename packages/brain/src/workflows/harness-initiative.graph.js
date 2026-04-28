/**
 * Harness v2 — Initiative Runner（阶段 A 入口 + 阶段 C 推进）
 *
 * PRD: docs/design/harness-v2-prd.md §3.1 阶段 A/C · §5.1 Planner · §5.7 Final E2E · §6.3 失败归因
 * Milestone: M2 (phase A) + M5 (phase C)
 *
 * 调用路径：
 *   - executor.js `task.task_type === 'harness_initiative'` → runInitiative(task)  — 阶段 A
 *   - Brain tick / executor.js 派发 harness_final_e2e 任务时 → runPhaseCIfReady(initiativeTaskId)
 *
 * 阶段 A 流程：
 *   1. 调 Planner — 产 sprint-prd.md + task-plan.json
 *   2. parseTaskPlan → 校验
 *   3. 跑 GAN 合同循环（Proposer ↔ Reviewer）→ approved contract_content
 *   4. 事务内 upsertTaskPlan — 建 subtasks + pr_plans + task_dependencies
 *   5. 建 initiative_contracts 行（status='approved', prd_content + contract_content + review_rounds, approved_at=NOW()）
 *   6. 建 initiative_runs 行（phase='B_task_loop', deadline_at=NOW()+timeout）
 *
 * 阶段 C 流程（runPhaseCIfReady）：
 *   1. 查子任务状态，未全部 completed → 返回 not_ready（由 tick 层保底轮询）
 *   2. 查最新 approved 合同，取 e2e_acceptance
 *   3. 调 runFinalE2E → verdict PASS | FAIL
 *   4. PASS → initiative_runs.phase='done' + completed_at=NOW()
 *   5. FAIL → attributeFailures → 为每个可疑 Task 建 harness_task(fix mode) + fix_round++
 *           fix_round > MAX_FIX_ROUNDS → phase='failed'，写 failure_reason
 */

import pool from '../db.js';
import { spawn } from '../spawn/index.js';
import { parseDockerOutput, loadSkillContent } from '../harness-shared.js';
import { parseTaskPlan, upsertTaskPlan } from '../harness-dag.js';
import { runFinalE2E, attributeFailures } from '../harness-final-e2e.js';
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
// 走 C3 shim (../harness-gan-graph.js) 而非直连 workflows/harness-gan.graph.js，
// 保持测试 vi.mock('../../harness-gan-graph.js') 路径兼容。
// Phase C7 清 shim 前不改。
import { runGanContractGraph } from '../harness-gan-graph.js';

const DEFAULT_TIMEOUT_SEC = 21600; // 6h，对齐 initiative_contracts.timeout_sec 默认
const DEFAULT_BUDGET_USD = 10;
const MAX_FIX_ROUNDS = 3; // fix_round > 3 → phase='failed'（PRD §6.3）

/**
 * 运行一个 Initiative 的阶段 A：规划 + 合同起草 + 运行态登记。
 *
 * @param {object} task                  Brain task 行（必须含 id、description/title）
 * @param {object} [opts]
 * @param {Function} [opts.dockerExecutor]  自定义 Docker 执行器（测试注入）
 * @param {object}   [opts.pool]            pg pool（测试注入）
 * @param {number}   [opts.timeoutSec]      覆盖默认 6h
 * @param {number}   [opts.budgetUsd]       覆盖默认 10 USD
 * @returns {Promise<{
 *   success: boolean,
 *   taskId: string,
 *   initiativeId: string,
 *   contractId?: string,
 *   runId?: string,
 *   insertedTaskIds?: string[],
 *   idMap?: Record<string,string>,
 *   error?: string,
 * }>}
 */
export async function runInitiative(task, opts = {}) {
  if (!task || !task.id) throw new Error('runInitiative: task.id required');

  const dbPool = opts.pool || pool;
  const executor = opts.executor || opts.dockerExecutor || spawn;
  const timeoutSec = opts.timeoutSec || DEFAULT_TIMEOUT_SEC;
  const budgetUsd = opts.budgetUsd || DEFAULT_BUDGET_USD;

  // initiative_id 来源：task.payload.initiative_id 或 task.id（兜底）
  const initiativeId =
    task.payload?.initiative_id ||
    task.initiative_id ||
    task.id;

  console.log(`[harness-initiative-runner] starting task=${task.id} initiative=${initiativeId}`);

  // ── 1. 调 Planner 节点 ────────────────────────────────────────────────
  const sprintDir = task.payload?.sprint_dir || 'sprints';
  const skillContent = loadSkillContent('harness-planner');
  const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${task.description || task.title || ''}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 在 stdout 末尾输出 task-plan.json（符合 harness-planner SKILL.md 定义的 schema）
3. task-plan.json 必须被 \`\`\`json ... \`\`\` 代码块包裹便于提取`;

  // ── Prep：挂载 worktree + 注入 GitHub token（Harness v2 container mount）──
  let worktreePath;
  let githubToken;
  try {
    worktreePath = await ensureHarnessWorktree({ taskId: task.id, initiativeId });
    githubToken = await resolveGitHubToken();
  } catch (err) {
    console.error(`[harness-initiative-runner] prep failed task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, initiativeId, error: err.message };
  }

  let plannerOutput = '';
  let plannerError = null;
  try {
    const result = await executor({
      task: { ...task, task_type: 'harness_planner' },
      prompt,
      worktreePath,
      env: {
        // CECELIA_CREDENTIALS 不传 → spawn() middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        GITHUB_TOKEN: githubToken,
      },
    });
    if (result.exit_code !== 0 || result.timed_out) {
      plannerError = result.timed_out
        ? 'Docker timeout'
        : `Docker exit=${result.exit_code}: ${(result.stderr || '').slice(-500)}`;
    } else {
      plannerOutput = parseDockerOutput(result.stdout);
    }
  } catch (err) {
    plannerError = err.message;
  }

  if (plannerError) {
    console.error(`[harness-initiative-runner] planner failed task=${task.id}: ${plannerError}`);
    return { success: false, taskId: task.id, initiativeId, error: plannerError };
  }

  // ── 2. 提取 + 校验 task-plan.json ────────────────────────────────────
  let taskPlan;
  try {
    // Planner 的 stdout 会同时含 PRD 正文 + task-plan.json
    // parseTaskPlan 自身支持 code fence / JSON 嵌入 / 纯 JSON
    taskPlan = parseTaskPlan(plannerOutput);
  } catch (err) {
    console.error(`[harness-initiative-runner] parseTaskPlan failed task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, initiativeId, error: `parseTaskPlan: ${err.message}` };
  }

  // Planner 输出的 initiative_id 可能是 'pending' 占位 — 用 runtime 真实值覆盖
  if (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id) {
    taskPlan.initiative_id = initiativeId;
  }

  // ── Phase A — GAN 合同循环（PR-4）──────────────────────────────────────
  // plannerOutput 是 Planner stdout 元数据（含"Push failed"等废话），真 PRD 在 sprints/sprint-prd.md
  let prdContent = plannerOutput;
  try {
    const fsPromises = await import('node:fs/promises');
    const pathMod = (await import('node:path')).default;
    prdContent = await fsPromises.readFile(pathMod.join(worktreePath, sprintDir, 'sprint-prd.md'), 'utf8');
  } catch (err) {
    console.error(`[harness-initiative-runner] read sprint-prd.md failed (${err.message}), falling back to planner stdout`);
  }

  let ganResult;
  try {
    ganResult = await runGanContractGraph({
      taskId: task.id,
      initiativeId,
      sprintDir,
      prdContent,
      executor,
      worktreePath,
      githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer: opts.checkpointer,
    });
  } catch (err) {
    console.error(`[harness-initiative-runner] GAN failed task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, initiativeId, error: `gan: ${err.message}` };
  }

  // ── 3,4,5. 单事务：upsertTaskPlan + initiative_contracts + initiative_runs ─
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId,
      initiativeTaskId: task.id,
      taskPlan,
      client,
      contractBranch: ganResult.propose_branch || null,
    });

    // 建 initiative_contracts（approved 版，GAN 循环已产出 contract_content）
    // branch 列（migration 246）= GAN propose_branch，Phase B 用此分支创 PR。
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, branch, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [initiativeId, plannerOutput, ganResult.contract_content, ganResult.rounds, budgetUsd, timeoutSec, ganResult.propose_branch || null]
    );
    const contractId = contractInsert.rows[0].id;

    // 建 initiative_runs（phase='B_task_loop'，阶段 A 已结束）
    const runInsert = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, contract_id, phase,
         deadline_at
       )
       VALUES ($1::uuid, $2::uuid, 'B_task_loop',
         NOW() + ($3 || ' seconds')::interval
       )
       RETURNING id`,
      [initiativeId, contractId, String(timeoutSec)]
    );
    const runId = runInsert.rows[0].id;

    await client.query('COMMIT');

    console.log(
      `[harness-initiative-runner] success task=${task.id} ` +
      `inserted=${insertedTaskIds.length} contract=${contractId} run=${runId}`
    );

    return {
      success: true,
      taskId: task.id,
      initiativeId,
      contractId,
      runId,
      insertedTaskIds,
      idMap,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error(`[harness-initiative-runner] tx failed task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, initiativeId, error: `tx: ${err.message}` };
  } finally {
    client.release();
  }
}

// ─── @deprecated 阶段 C — Final E2E + 失败归因 ──────────────────────────────
// Sprint 1: checkAllTasksCompleted / createFixTask / runPhaseCIfReady 这三个函数
// 被顶层 buildHarnessFullGraph 的 fanout / runSubTask / join / finalE2eNode 节点取代。
// ─────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Sprint 1: 由 graph fanout/runSubTask/join 替代。
 *
 * 查询 Initiative 下所有 harness_task 子任务是否全部 completed（供 tick 判阶段切换）。
 *
 * @param {string} initiativeTaskId  parent harness_initiative task UUID
 * @param {object} client             pg client
 * @returns {Promise<{all: boolean, total: number, completed: number, remaining: number}>}
 */
export async function checkAllTasksCompleted(initiativeTaskId, client) {
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS cnt
     FROM tasks
     WHERE task_type = 'harness_task'
       AND payload->>'parent_task_id' = $1
     GROUP BY status`,
    [String(initiativeTaskId)]
  );
  let total = 0;
  let completed = 0;
  for (const r of rows) {
    total += r.cnt;
    if (r.status === 'completed') completed += r.cnt;
  }
  return {
    all: total > 0 && completed === total,
    total,
    completed,
    remaining: total - completed,
  };
}

/**
 * 为失败的 Task 建 fix-mode 子任务（同 parent_task_id，携带 fix_round + 失败证据）。
 *
 * 注：PRD §5.4 Generator Fix 模式的语义是"同分支多 commit"。这里建的 `harness_task`
 *    承载 fix 指令；Generator 节点读 payload.fix_mode 决定走新建还是 fix 路径。
 *
 * @param {object} p
 * @param {string} p.initiativeId
 * @param {string} p.initiativeTaskId
 * @param {string} p.taskId            被归因失败的 task UUID（保留原 Task 信息）
 * @param {number} p.fixRound          新 fix_round（已 +1）
 * @param {Array}  p.failureScenarios  attributeFailures 返回的 scenarios 数组
 * @param {object} p.client
 * @returns {Promise<string>}           新建 harness_task 的 UUID
 */
export async function createFixTask({
  initiativeId,
  initiativeTaskId,
  taskId,
  fixRound,
  failureScenarios,
  client,
}) {
  // Sprint 1 full graph (2026-04-28): runPhaseCIfReady / createFixTask 路径
  // 已被 LangGraph full graph 的 joinNode + finalE2eNode 替代，不再通过 DB 任务行驱动。
  // 提前返回 noop UUID，避免 INSERT retired harness_task → 立即 failed。
  const noopId = crypto.randomUUID();
  console.warn(`[createFixTask] retired — returning noop id=${noopId} (full graph handles fix inline)`);
  return noopId;

  // 取原 Task 的关键字段（title / scope / files）用于 fix 描述
  const { rows } = await client.query(
    `SELECT title, description, payload FROM tasks WHERE id = $1::uuid`,
    [taskId]
  );
  const src = rows[0] || {};
  const srcPayload = src.payload || {};

  const fixDescription = `[FIX round ${fixRound}] ${src.description || ''}\n\n` +
    `归因自 Final E2E 失败场景:\n` +
    failureScenarios.map((s) => `- ${s.name} (exit=${s.exitCode})`).join('\n');

  const payload = {
    fix_mode: true,
    fix_round: fixRound,
    original_task_id: taskId,
    logical_task_id: srcPayload.logical_task_id,
    initiative_id: initiativeId,
    parent_task_id: initiativeTaskId,
    files: srcPayload.files || [],
    dod: srcPayload.dod || [],
    failure_scenarios: failureScenarios,
  };

  const ins = await client.query(
    `INSERT INTO tasks (task_type, title, description, status, priority, payload)
     VALUES ('harness_task', $1, $2, 'queued', 'P2', $3::jsonb)
     RETURNING id`,
    [
      `[fix-r${fixRound}] ${src.title || 'unknown'}`,
      fixDescription,
      JSON.stringify(payload),
    ]
  );
  return ins.rows[0].id;
}

/**
 * 阶段 C 推进器 —— Initiative 所有子 Task 完成 + 合同已 approved 时调用。
 *
 * 语义：
 *   - not_ready: 子任务未全完成，tick 稍后重试
 *   - e2e_pass : Final E2E 全绿，initiative_runs.phase='done'
 *   - e2e_fail : 部分 scenario 失败，建 fix 子任务；若 fix_round > MAX_FIX_ROUNDS 则 phase='failed'
 *
 * @param {string} initiativeTaskId   parent harness_initiative task UUID
 * @param {object} [opts]
 * @param {object} [opts.pool]         pg pool 注入（测试用）
 * @param {Function} [opts.runE2E]     runFinalE2E 替换（测试用）
 * @param {number} [opts.maxFixRounds=3]
 * @param {object} [opts.now]          Date 替换（测试用，不常用）
 * @returns {Promise<{
 *   status: 'not_ready'|'e2e_pass'|'e2e_fail'|'e2e_failed_terminal'|'no_contract'|'error',
 *   initiativeId?: string,
 *   runId?: string,
 *   verdict?: 'PASS'|'FAIL',
 *   fixTaskIds?: string[],
 *   failureAttribution?: Array<{task_id:string, failureCount:number}>,
 *   error?: string,
 * }>}
 */
export async function runPhaseCIfReady(initiativeTaskId, opts = {}) {
  if (!initiativeTaskId) throw new Error('runPhaseCIfReady: initiativeTaskId required');

  const dbPool = opts.pool || pool;
  const runE2E = opts.runE2E || runFinalE2E;
  const maxFixRounds = Number.isFinite(opts.maxFixRounds) ? opts.maxFixRounds : MAX_FIX_ROUNDS;

  const client = await dbPool.connect();
  try {
    // 1. 查父任务的 initiative_id
    const parentQ = await client.query(
      `SELECT id, payload FROM tasks WHERE id = $1::uuid`,
      [initiativeTaskId]
    );
    if (parentQ.rows.length === 0) {
      return { status: 'error', error: 'parent initiative task not found' };
    }
    const parent = parentQ.rows[0];
    const initiativeId = parent.payload?.initiative_id || parent.id;

    // 2. 所有 harness_task 必须 completed
    const taskStatus = await checkAllTasksCompleted(initiativeTaskId, client);
    if (!taskStatus.all) {
      return {
        status: 'not_ready',
        initiativeId,
        completed: taskStatus.completed,
        total: taskStatus.total,
      };
    }

    // 3. 取最新 approved 合同
    const contractQ = await client.query(
      `SELECT id, e2e_acceptance
       FROM initiative_contracts
       WHERE initiative_id = $1::uuid AND status = 'approved'
       ORDER BY version DESC LIMIT 1`,
      [initiativeId]
    );
    if (contractQ.rows.length === 0 || !contractQ.rows[0].e2e_acceptance) {
      return { status: 'no_contract', initiativeId };
    }
    const contract = contractQ.rows[0];

    // 4. 取 initiative_runs 行（阶段 A 创建的）
    const runQ = await client.query(
      `SELECT id, phase FROM initiative_runs
       WHERE initiative_id = $1::uuid
       ORDER BY started_at DESC LIMIT 1`,
      [initiativeId]
    );
    if (runQ.rows.length === 0) {
      return { status: 'error', initiativeId, error: 'initiative_runs row missing' };
    }
    const runId = runQ.rows[0].id;

    // 5. 推进到 phase='C_final_e2e'
    await client.query(
      `UPDATE initiative_runs SET phase='C_final_e2e', updated_at=NOW() WHERE id=$1::uuid`,
      [runId]
    );

    // 6. 跑 E2E
    const e2e = await runE2E(initiativeId, contract);

    if (e2e.verdict === 'PASS') {
      await client.query(
        `UPDATE initiative_runs
         SET phase='done', completed_at=NOW(), updated_at=NOW()
         WHERE id=$1::uuid`,
        [runId]
      );
      return { status: 'e2e_pass', initiativeId, runId, verdict: 'PASS' };
    }

    // 7. FAIL → 归因 + 建 fix task
    const attribution = attributeFailures(e2e.failedScenarios);
    const fixTaskIds = [];
    const failureAttribution = [];

    let anyExceededRounds = false;

    for (const [failedTaskId, info] of attribution.entries()) {
      // 取当前 fix_round：从 original task 查现存 fix 子任务计数
      const roundQ = await client.query(
        `SELECT COALESCE(MAX((payload->>'fix_round')::int), 0) AS max_round
         FROM tasks
         WHERE task_type='harness_task'
           AND payload->>'parent_task_id' = $1
           AND payload->>'original_task_id' = $2`,
        [String(initiativeTaskId), String(failedTaskId)]
      );
      const nextRound = (roundQ.rows[0]?.max_round || 0) + 1;

      failureAttribution.push({
        task_id: failedTaskId,
        failureCount: info.failureCount,
        nextRound,
      });

      if (nextRound > maxFixRounds) {
        anyExceededRounds = true;
        continue; // 不再建 fix task（terminal fail 已触发）
      }

      const newId = await createFixTask({
        initiativeId,
        initiativeTaskId,
        taskId: failedTaskId,
        fixRound: nextRound,
        failureScenarios: info.scenarios,
        client,
      });
      fixTaskIds.push(newId);
    }

    if (anyExceededRounds) {
      const reason = `Final E2E FAIL: ${failureAttribution
        .map((a) => `task=${a.task_id}(r=${a.nextRound})`)
        .join(', ')}`;
      await client.query(
        `UPDATE initiative_runs
         SET phase='failed', failure_reason=$1, completed_at=NOW(), updated_at=NOW()
         WHERE id=$2::uuid`,
        [reason, runId]
      );
      return {
        status: 'e2e_failed_terminal',
        initiativeId,
        runId,
        verdict: 'FAIL',
        fixTaskIds,
        failureAttribution,
        error: reason,
      };
    }

    // 未超 fix round：退回到 B_task_loop 等 fix task 走完
    await client.query(
      `UPDATE initiative_runs
       SET phase='B_task_loop', updated_at=NOW()
       WHERE id=$1::uuid`,
      [runId]
    );
    return {
      status: 'e2e_fail',
      initiativeId,
      runId,
      verdict: 'FAIL',
      fixTaskIds,
      failureAttribution,
    };
  } catch (err) {
    console.error(`[harness-initiative-runner] phase C error: ${err.message}`);
    return { status: 'error', error: err.message };
  } finally {
    client.release();
  }
}

// ─── Brain v2 C8a — LangGraph 真图实现（阶段 A）────────────────────────
// harness_initiative 任务的唯一执行路径（dispatcher → executor → compileHarnessFullGraph）。
//
// 节点拓扑：START → prep → planner → parsePrd → ganLoop → dbUpsert → END
//                    ↓error  ↓error    ↓error    ↓error
//                    └────────┴──────────┴─────────┴──────→ END (条件 edge)
//
// 每节点首句幂等门防 LangGraph resume 重 spawn（C6 smoke 教训）。
// PRD: docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
// 注：上方 imports 已含 spawn / parseDockerOutput / loadSkillContent / parseTaskPlan /
// upsertTaskPlan / ensureHarnessWorktree / resolveGitHubToken / runGanContractGraph

export const InitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
});

// 节点 stub — Task 2-6 逐个填充。
export async function prepInitiativeNode(state) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    const initiativeId = state.task?.payload?.initiative_id || state.task?.initiative_id || state.task?.id;
    const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId });
    const githubToken = await resolveGitHubToken();
    return { worktreePath, githubToken, initiativeId };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
export async function runPlannerNode(state, opts = {}) {
  if (state.plannerOutput) return { plannerOutput: state.plannerOutput };
  try {
    const executor = opts.executor || spawn;
    const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
    const skillContent = loadSkillContent('harness-planner');
    const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${state.task.id}
**initiative_id**: ${state.initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task.description || state.task.title || ''}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 在 stdout 末尾输出 task-plan.json
3. task-plan.json 必须被 \`\`\`json ... \`\`\` 代码块包裹便于提取`;

    const result = await executor({
      task: { ...state.task, task_type: 'harness_planner' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: state.initiativeId,
        GITHUB_TOKEN: state.githubToken,
      },
    });
    if (result.exit_code !== 0 || result.timed_out) {
      const msg = result.timed_out
        ? 'Docker timeout'
        : `Docker exit=${result.exit_code}: ${(result.stderr || '').slice(-500)}`;
      return { error: { node: 'planner', message: msg } };
    }
    const plannerOutput = parseDockerOutput(result.stdout);
    return { plannerOutput };
  } catch (err) {
    return { error: { node: 'planner', message: err.message } };
  }
}
export async function parsePrdNode(state) {
  if (state.taskPlan && state.prdContent) {
    return { taskPlan: state.taskPlan, prdContent: state.prdContent };
  }
  let taskPlan;
  try {
    taskPlan = parseTaskPlan(state.plannerOutput);
  } catch (err) {
    return { error: { node: 'parsePrd', message: `parseTaskPlan: ${err.message}` } };
  }
  if (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id) {
    taskPlan.initiative_id = state.initiativeId;
  }
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  let prdContent = state.plannerOutput;
  try {
    const fsPromises = await import('node:fs/promises');
    const pathMod = (await import('node:path')).default;
    prdContent = await fsPromises.readFile(
      pathMod.join(state.worktreePath, sprintDir, 'sprint-prd.md'),
      'utf8'
    );
  } catch (err) {
    console.error(`[harness-initiative-graph] read sprint-prd.md failed (${err.message}), falling back to planner stdout`);
  }
  return { taskPlan, prdContent };
}
export async function runGanLoopNode(state, opts = {}) {
  if (state.ganResult) return { ganResult: state.ganResult };
  try {
    const executor = opts.executor || spawn;
    const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
    const budgetUsd = state.task?.payload?.budget_usd || DEFAULT_BUDGET_USD;
    const ganResult = await runGanContractGraph({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer: opts.checkpointer,
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
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, branch, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec, state.ganResult.propose_branch || null]
    );
    const contractId = contractInsert.rows[0].id;
    const runInsert = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, contract_id, phase,
         deadline_at
       )
       VALUES ($1::uuid, $2::uuid, 'B_task_loop',
         NOW() + ($3 || ' seconds')::interval
       )
       RETURNING id`,
      [state.initiativeId, contractId, String(timeoutSec)]
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

function stateHasError(state) { return state.error ? 'error' : 'ok'; }

export function buildHarnessInitiativeGraph() {
  return new StateGraph(InitiativeState)
    .addNode('prep', prepInitiativeNode)
    .addNode('planner', runPlannerNode)
    .addNode('parsePrd', parsePrdNode)
    .addNode('ganLoop', runGanLoopNode)
    .addNode('dbUpsert', dbUpsertNode)
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
    .addEdge('dbUpsert', END);
}

export async function compileHarnessInitiativeGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessInitiativeGraph().compile({ checkpointer });
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

import { Send } from '@langchain/langgraph';
import { buildHarnessTaskGraph as _buildTaskGraph } from './harness-task.graph.js';
import {
  runScenarioCommand,
  bootstrapE2E,
  teardownE2E,
  normalizeAcceptance,
} from '../harness-final-e2e.js';

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
export async function inferTaskPlanNode(state, opts = {}) {
  const existing = state?.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }

  const executor = opts.executor || spawn;
  const prdContent = state?.prdContent || '';
  const contractContent = state?.ganResult?.contract_content || '';
  if (!prdContent && !contractContent) {
    return {};
  }

  const prompt = `你是 task plan inferrer。根据下方 Sprint PRD + Contract，
拆 1-5 个独立可并行的 sub_task，每个 sub_task 是一个原子 PR 单位。
输出 task-plan.json，被 \`\`\`json ... \`\`\` 包裹，schema 见 harness-planner SKILL
（task_id/title/scope/dod/files/depends_on/complexity/estimated_minutes）。

## PRD
${prdContent}

## Contract
${contractContent}`;

  let stdout;
  try {
    const result = await executor({
      task: { ...(state.task || {}), task_type: 'harness_planner' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'infer_task_plan',
        HARNESS_INITIATIVE_ID: state.initiativeId,
        GITHUB_TOKEN: state.githubToken,
      },
    });
    if (result.exit_code !== 0 || result.timed_out) {
      console.warn(`[infer_task_plan] LLM exit=${result.exit_code} timed_out=${result.timed_out}`);
      return {};
    }
    stdout = parseDockerOutput(result.stdout);
  } catch (err) {
    console.warn(`[infer_task_plan] spawn failed: ${err.message}`);
    return {};
  }

  let plan;
  try {
    plan = parseTaskPlan(stdout);
  } catch (err) {
    console.warn(`[infer_task_plan] parseTaskPlan failed: ${err.message}`);
    return {};
  }
  if (plan.initiative_id === 'pending' || !plan.initiative_id) {
    plan.initiative_id = state.initiativeId;
  }

  // 把 task_plan 行字段映射成 sub_task 形态（fanout/runSubTask 期望 id/title/description/payload）
  const subTasks = plan.tasks.map((t) => ({
    id: t.task_id,
    title: t.title,
    description: t.scope,
    payload: { dod: t.dod, files: t.files, depends_on: t.depends_on },
  }));

  return {
    taskPlan: { ...plan, tasks: subTasks },
  };
}

/**
 * fanoutSubTasksNode: 用作 conditional edge 的路由函数（不是 graph node）。
 * 返回 Send[] 让 LangGraph runtime 并行调度 N 个 run_sub_task 实例。
 * 注：函数名保留 ...Node 后缀仅为方便 import；实际作为 router 用，调用时签名 (state) => Send[].
 */
export function fanoutSubTasksNode(state) {
  const tasks = state.taskPlan?.tasks || [];
  if (tasks.length === 0) {
    // 无 sub_task → 直接跳 join（join 处理空 sub_tasks 路径）
    return ['join'];
  }
  return tasks.map((t) => new Send('run_sub_task', {
    sub_task: t,
    initiativeId: state.initiativeId,
    worktreePath: state.worktreePath,
    githubToken: state.githubToken,
    contractBranch: state.ganResult?.propose_branch || state.contractBranch || null,
  }));
}

/**
 * fanoutPassthroughNode: 真正的 graph node — 占位，让 conditional edge 有源头。
 */
export async function fanoutPassthroughNode(_state) { return {}; }

let _taskGraphCompiledCache = null;
function _getTaskGraphCompiled() {
  if (_taskGraphCompiledCache) return _taskGraphCompiledCache;
  _taskGraphCompiledCache = _buildTaskGraph().compile();
  return _taskGraphCompiledCache;
}

export async function runSubTaskNode(state, opts = {}) {
  const subTask = state.sub_task;
  if (!subTask) return {};
  const compiled = opts.compiledTaskGraph || _getTaskGraphCompiled();
  let final;
  try {
    final = await compiled.invoke(
      {
        task: { id: subTask.id, title: subTask.title, description: subTask.description, payload: subTask.payload || {} },
        initiativeId: state.initiativeId,
        worktreePath: state.worktreePath,
        githubToken: state.githubToken,
        contractBranch: state.contractBranch,
      },
      { configurable: { thread_id: `harness-task:${state.initiativeId}:${subTask.id}` }, recursionLimit: 200 }
    );
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

export async function joinSubTasksNode(state) {
  const subs = state.sub_tasks || [];
  if (subs.length === 0) {
    return { all_sub_tasks_done: false };
  }
  const allMerged = subs.every((s) => s.status === 'merged');
  if (!allMerged) {
    const failed = subs.filter((s) => s.status !== 'merged').map((s) => s.id);
    console.warn(`[harness-initiative.graph] join: ${failed.length} sub-tasks not merged → FAIL final E2E`);
    return {
      all_sub_tasks_done: false,
      final_e2e_verdict: 'FAIL',
      final_e2e_failed_scenarios: failed.map((id) => ({
        name: `sub_task ${id} did not merge`,
        covered_tasks: [id],
        exitCode: 1,
        output: '',
      })),
    };
  }
  return { all_sub_tasks_done: true };
}

function _collectCoveredTasks(scenarios) {
  const set = new Set();
  for (const s of scenarios) for (const t of s.covered_tasks || []) set.add(t);
  return [...set];
}

export async function finalE2eNode(state, opts = {}) {
  // join 已 FAIL 短路：不跑 E2E
  if (state.final_e2e_verdict === 'FAIL') {
    return { final_e2e_verdict: 'FAIL' };
  }
  const contract = state.contract || {};
  const acceptance = contract.e2e_acceptance || state.taskPlan?.e2e_acceptance;
  if (!acceptance) {
    // 无 e2e_acceptance → 视为 PASS（向后兼容老 PRD 不强制）
    return { final_e2e_verdict: 'PASS' };
  }

  let scenarios;
  try {
    ({ scenarios } = normalizeAcceptance(acceptance));
  } catch (err) {
    return { error: { node: 'final_e2e', message: err.message }, final_e2e_verdict: 'FAIL' };
  }

  const runScenario = opts.runScenario || runScenarioCommand;
  const bootstrap = opts.bootstrap || bootstrapE2E;
  const teardown = opts.teardown || teardownE2E;
  const skipBootstrap = opts.skipBootstrap === true;

  if (!skipBootstrap) {
    const bs = bootstrap();
    if (bs.exitCode !== 0) {
      return {
        final_e2e_verdict: 'FAIL',
        final_e2e_failed_scenarios: [{
          name: `bootstrap failure`,
          covered_tasks: _collectCoveredTasks(scenarios),
          output: bs.output, exitCode: bs.exitCode,
        }],
      };
    }
  }

  const failed = [];
  for (const sc of scenarios) {
    let f = null;
    for (const cmd of sc.commands) {
      const r = await runScenario(cmd, { scenarioName: sc.name, coveredTasks: sc.covered_tasks });
      if (r.exitCode !== 0) {
        f = { name: sc.name, covered_tasks: [...sc.covered_tasks], output: r.output, exitCode: r.exitCode };
        break;
      }
    }
    if (f) failed.push(f);
  }

  if (!skipBootstrap) {
    try { teardown(); } catch { /* ignore */ }
  }

  return {
    final_e2e_verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    final_e2e_failed_scenarios: failed,
  };
}

export async function reportNode(state, opts = {}) {
  const dbPool = opts.pool || pool;
  const reportContent = JSON.stringify({
    initiativeId: state.initiativeId,
    sub_tasks: state.sub_tasks || [],
    final_e2e_verdict: state.final_e2e_verdict,
    failed_scenarios: state.final_e2e_failed_scenarios || [],
    cost_usd: (state.sub_tasks || []).reduce((a, s) => a + (s.cost_usd || 0), 0),
    completed_at: new Date().toISOString(),
  }, null, 2);
  // 写 initiative_runs phase=done/failed
  try {
    const phase = state.final_e2e_verdict === 'PASS' ? 'done' : 'failed';
    const reason = `Final E2E ${state.final_e2e_verdict}: ${(state.final_e2e_failed_scenarios || []).map(s => s.name).join('; ').slice(0, 500)}`;
    await dbPool.query(
      `UPDATE initiative_runs SET phase=$2, completed_at=NOW(), updated_at=NOW(),
        failure_reason=CASE WHEN $2='failed' THEN $3 ELSE failure_reason END
       WHERE initiative_id=$1::uuid`,
      [state.initiativeId, phase, reason]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
  return { report_path: reportContent };
}

// ──────────────────────────────────────────────────────────────────────────
// 完整 graph：Phase A + B + C 全程 LangGraph

function _routeAfterJoin(state) {
  if (state.error) return 'end';
  return 'final_e2e'; // 即便 FAIL 也进 final_e2e（短路 verdict=FAIL，不再跑 scenarios）
}

function _routeAfterFinalE2E(state) {
  if (state.error) return 'end';
  return 'report';
}

export function buildHarnessFullGraph() {
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode)
    .addNode('planner', runPlannerNode)
    .addNode('parsePrd', parsePrdNode)
    .addNode('ganLoop', runGanLoopNode)
    .addNode('dbUpsert', dbUpsertNode)
    .addNode('inferTaskPlan', inferTaskPlanNode)
    .addNode('fanout', fanoutPassthroughNode)
    .addNode('run_sub_task', runSubTaskNode)
    .addNode('join', joinSubTasksNode)
    .addNode('final_e2e', finalE2eNode)
    .addNode('report', reportNode)
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
    .addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'inferTaskPlan' })
    .addConditionalEdges('inferTaskPlan', stateHasError, { error: END, ok: 'fanout' })
    // fanout 是 passthrough node；conditional edge 的路由函数 fanoutSubTasksNode
    // 返回 Send[]，LangGraph runtime 并行调 run_sub_task。
    .addConditionalEdges('fanout', fanoutSubTasksNode, ['run_sub_task', 'join'])
    .addEdge('run_sub_task', 'join')
    .addConditionalEdges('join', _routeAfterJoin, { end: END, final_e2e: 'final_e2e' })
    .addConditionalEdges('final_e2e', _routeAfterFinalE2E, { end: END, report: 'report' })
    .addEdge('report', END);
}

export async function compileHarnessFullGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessFullGraph().compile({ checkpointer });
}
