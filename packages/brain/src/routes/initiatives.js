/**
 * Harness v2 Initiative 路由（M6）
 *
 * PRD: docs/design/harness-v2-prd.md §6.7 Initiative Dashboard
 *
 * GET /api/brain/initiatives/:id/dag
 *   聚合一个 Initiative 的全视图：
 *     - phase + timing（从 initiative_runs）
 *     - prd_content / contract_content / e2e_acceptance（最新 contract）
 *     - tasks（tasks 表 harness_task 子任务 + 合并 pr_plans.pr_url / fix_rounds）
 *     - dependencies（task_dependencies 边 + edge_type）
 *     - cost（runs.cost_usd 汇总 + by_task 分布）
 *
 * :id 视为 harness_initiative 任务 ID（也是 initiative_id — initiative-runner
 * 兜底语义：task.id 同时用作 initiative_id）。若找不到任何 task/contract/run
 * 则返回 404。
 *
 * 读-only，非 LLM 节点。
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function safeGet(obj, key, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  const v = obj[key];
  return v === undefined || v === null ? fallback : v;
}

router.get('/:id/dag', async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.length > 64) {
    return res.status(400).json({ error: 'invalid id' });
  }

  try {
    // 1. initiative_runs（最新一条）
    const runQ = await pool.query(
      `SELECT id, phase, cost_usd, started_at, deadline_at, completed_at,
              current_task_id, merged_task_ids, failure_reason, contract_id
       FROM initiative_runs
       WHERE initiative_id::text = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );
    const run = runQ.rows[0] || null;

    // 2. initiative_contracts（优先 approved，否则最新 version）
    const contractQ = await pool.query(
      `SELECT id, version, status, prd_content, contract_content,
              e2e_acceptance, budget_cap_usd, timeout_sec, review_rounds,
              approved_at, created_at
       FROM initiative_contracts
       WHERE initiative_id::text = $1
       ORDER BY
         (CASE WHEN status = 'approved' THEN 0 ELSE 1 END),
         version DESC
       LIMIT 1`,
      [id]
    );
    const contract = contractQ.rows[0] || null;

    // 3. subtasks（harness_task，payload.parent_task_id = id）
    // tasks.pr_url 是官方字段（migration 130）；depends_on 从 pr_plans 拿
    const tasksQ = await pool.query(
      `SELECT t.id AS task_id,
              t.title,
              t.status,
              t.pr_url,
              t.created_at,
              t.started_at,
              t.completed_at,
              t.payload,
              pp.depends_on AS pp_depends_on
       FROM tasks t
       LEFT JOIN pr_plans pp ON pp.id::text = t.payload->>'pr_plan_id'
       WHERE t.task_type = 'harness_task'
         AND t.payload->>'parent_task_id' = $1
       ORDER BY t.created_at ASC`,
      [id]
    );

    const taskRows = tasksQ.rows;
    const taskIds = taskRows.map((t) => t.task_id);

    // 4. task_dependencies 边（子任务内部）
    let dependencies = [];
    if (taskIds.length > 0) {
      const depQ = await pool.query(
        `SELECT from_task_id AS "from", to_task_id AS "to", edge_type
         FROM task_dependencies
         WHERE from_task_id = ANY($1::uuid[])`,
        [taskIds]
      );
      dependencies = depQ.rows;
    }

    // 5. 全空 → 404
    if (!run && !contract && taskRows.length === 0) {
      return res.status(404).json({ error: 'initiative not found', id });
    }

    // 6. 组装 tasks
    const tasks = taskRows.map((r) => {
      const payload = r.payload || {};
      const prUrl = r.pr_url || safeGet(payload, 'pr_url') || null;
      const fixRounds =
        Number(safeGet(payload, 'fix_rounds', 0)) ||
        Number(safeGet(payload, 'evaluator_rounds', 0)) ||
        0;
      const dependsOn = Array.isArray(r.pp_depends_on) ? r.pp_depends_on : [];
      const costUsd = Number(safeGet(payload, 'cost_usd', 0)) || 0;
      return {
        task_id: r.task_id,
        title: r.title,
        status: r.status,
        pr_url: prUrl,
        depends_on: dependsOn,
        fix_rounds: fixRounds,
        cost_usd: costUsd,
        started_at: r.started_at,
        completed_at: r.completed_at,
      };
    });

    // 7. cost 汇总
    const totalUsd = run
      ? Number(run.cost_usd || 0)
      : tasks.reduce((s, t) => s + (t.cost_usd || 0), 0);
    const byTask = tasks.map((t) => ({ task_id: t.task_id, usd: t.cost_usd }));

    // 8. phase 兜底
    const phase = run
      ? run.phase
      : contract && contract.status === 'approved'
        ? 'B_task_loop'
        : 'A_contract';

    return res.json({
      initiative_id: id,
      phase,
      prd_content: contract ? contract.prd_content : null,
      contract_content: contract ? contract.contract_content : null,
      e2e_acceptance: contract ? contract.e2e_acceptance : null,
      contract: contract
        ? {
            id: contract.id,
            version: contract.version,
            status: contract.status,
            review_rounds: contract.review_rounds,
            budget_cap_usd: contract.budget_cap_usd,
            timeout_sec: contract.timeout_sec,
            approved_at: contract.approved_at,
          }
        : null,
      tasks,
      dependencies,
      cost: {
        total_usd: Number(totalUsd.toFixed(2)),
        by_task: byTask,
      },
      timing: {
        started_at: run ? run.started_at : null,
        current_phase_started_at: run ? run.started_at : null,
        deadline_at: run ? run.deadline_at : null,
        completed_at: run ? run.completed_at : null,
      },
      run: run
        ? {
            id: run.id,
            current_task_id: run.current_task_id,
            merged_task_ids: run.merged_task_ids || [],
            failure_reason: run.failure_reason,
          }
        : null,
    });
  } catch (err) {
    console.error('[GET /initiatives/:id/dag]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
