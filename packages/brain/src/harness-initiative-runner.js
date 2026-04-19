/**
 * Harness v2 — Initiative Runner（阶段 A 入口）
 *
 * PRD: docs/design/harness-v2-prd.md §3.1 阶段 A · §5.1 Planner
 * Milestone: M2
 *
 * 调用路径：executor.js `task.task_type === 'harness_initiative'` → runInitiative(task)
 *
 * 流程：
 *   1. 调 Planner（Docker 节点，复用 executeInDocker）— 产 sprint-prd.md + task-plan.json
 *   2. parseTaskPlan → 校验
 *   3. 事务内 upsertTaskPlan — 建 subtasks + pr_plans + task_dependencies
 *   4. 建 initiative_contracts 行（status='draft', prd_content=...）
 *   5. 建 initiative_runs 行（phase='A_contract', deadline_at=NOW()+timeout）
 *
 * M2 不触 Proposer / Reviewer / Generator / Evaluator（M3/M4）。
 */

import pool from './db.js';
import { executeInDocker } from './docker-executor.js';
import { parseDockerOutput, loadSkillContent } from './harness-graph.js';
import { parseTaskPlan, upsertTaskPlan } from './harness-dag.js';

const DEFAULT_TIMEOUT_SEC = 21600; // 6h，对齐 initiative_contracts.timeout_sec 默认
const DEFAULT_BUDGET_USD = 10;

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
  const executor = opts.dockerExecutor || executeInDocker;
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

  let plannerOutput = '';
  let plannerError = null;
  try {
    const result = await executor({
      task: { ...task, task_type: 'harness_planner' },
      prompt,
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
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

  // ── 3,4,5. 单事务：upsertTaskPlan + initiative_contracts + initiative_runs ─
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId,
      initiativeTaskId: task.id,
      taskPlan,
      client,
    });

    // 建 initiative_contracts（draft 版，Proposer/Reviewer 会在 M3 写 contract_content）
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, budget_cap_usd, timeout_sec
       )
       VALUES ($1::uuid, 1, 'draft', $2, $3, $4)
       RETURNING id`,
      [initiativeId, plannerOutput, budgetUsd, timeoutSec]
    );
    const contractId = contractInsert.rows[0].id;

    // 建 initiative_runs（phase='A_contract'）
    const runInsert = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, contract_id, phase,
         deadline_at
       )
       VALUES ($1::uuid, $2::uuid, 'A_contract',
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
