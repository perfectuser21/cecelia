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
              current_task_id, merged_task_ids, failure_reason, contract_id,
              journey_type
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
      journey_type: run?.journey_type || 'autonomous',
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

/**
 * phase 枚举白名单（来自 migration 312 CHECK 约束）
 */
const ALLOWED_PHASES = [
  'A_planning',
  'A_contract',
  'B_task_loop',
  'C_final_e2e',
  'done',
  'failed',
  'planning',
  'gan',
  'generate',
  'evaluate',
];

/**
 * GET /api/brain/orchestrator/relay-runs
 *
 * 列出 orchestrator_version='v2' 的 initiative_runs，按 started_at DESC 排序
 * 支持 ?limit=N 参数（默认 20，最大 100）
 * 支持 ?phase=<phase> 参数过滤（枚举白名单，来自 migration 312）
 */
router.get('/relay-runs', async (req, res) => {
  // 解析并校验 limit 参数
  const rawLimit = req.query.limit;
  let limit = 20;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || isNaN(parsed) || String(parsed) !== String(rawLimit)) {
      return res.status(400).json({ error: 'limit 参数必须为正整数' });
    }
    limit = Math.min(parsed, 100);
  }

  // 解析并校验 phase 参数
  const rawPhase = req.query.phase;
  if (rawPhase !== undefined && !ALLOWED_PHASES.includes(rawPhase)) {
    return res.status(400).json({
      error: `phase 参数非法，合法值：${ALLOWED_PHASES.join(',')}`,
      allowed: ALLOWED_PHASES,
    });
  }

  // 解析并校验 since 参数（FR-19/FR-22/FR-23）
  const rawSince = req.query.since;
  let sinceDate = null;
  if (rawSince !== undefined) {
    // 空字符串 → 400（FR-23）
    if (rawSince === '') {
      return res.status(400).json({ error: 'Invalid since parameter: must be ISO8601 format' });
    }
    const d = new Date(rawSince);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Invalid since parameter: must be ISO8601 format' });
    }
    sinceDate = rawSince;
  }

  try {
    // 构建动态 WHERE 条件数组（conditions + params）
    let result;

    function buildConditionsAndParams() {
      const conditions = ["orchestrator_version = 'v2'"];
      const params = [];

      if (sinceDate !== null) {
        params.push(sinceDate);
        conditions.push(`started_at >= $${params.length}`);
      }

      if (rawPhase !== undefined) {
        params.push(rawPhase);
        conditions.push(`phase = $${params.length}`);
      }

      params.push(limit);
      const limitParam = `$${params.length}`;

      return { conditions, params, limitParam };
    }

    try {
      const { conditions, params, limitParam } = buildConditionsAndParams();
      result = await pool.query(
        `SELECT id, initiative_id, phase,
                orchestrator_heartbeat_at, orchestrator_host,
                pr_url, started_at, deadline_at,
                evaluate_verdict, judge_verdict, cost_usd, completed_at, failure_reason
         FROM initiative_runs
         WHERE ${conditions.join(' AND ')}
         ORDER BY started_at DESC
         LIMIT ${limitParam}`,
        params
      );
    } catch (colErr) {
      if (colErr.message && colErr.message.includes('pr_url')) {
        // pr_url 列不存在，回退（FR-24：回退路径中 since 条件同样生效）
        const { conditions, params, limitParam } = buildConditionsAndParams();
        result = await pool.query(
          `SELECT id, initiative_id, phase,
                  orchestrator_heartbeat_at, orchestrator_host,
                  started_at, deadline_at,
                  evaluate_verdict, judge_verdict, cost_usd, completed_at, failure_reason
           FROM initiative_runs
           WHERE ${conditions.join(' AND ')}
           ORDER BY started_at DESC
           LIMIT ${limitParam}`,
          params
        );
      } else {
        throw colErr;
      }
    }

    return res.json(result.rows);
  } catch (err) {
    console.error('[GET /orchestrator/relay-runs]', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

/**
 * GET /api/brain/orchestrator/relay-runs/summary
 *
 * 返回各 phase 的 v2 relay run 计数，供 dashboard 全局分布展示。
 * 无数据时返回六个 phase 全 0（不报错）。
 * 必须注册在 :initiative_id 路由之前，防止 "summary" 被当作 UUID 匹配。
 */
router.get('/relay-runs/summary', async (req, res) => {
  const PHASE_KEYS = ['planning', 'gan', 'generate', 'evaluate', 'done', 'failed'];
  try {
    const result = await pool.query(
      `SELECT phase, COUNT(*) AS count
         FROM initiative_runs
        WHERE orchestrator_version = 'v2'
        GROUP BY phase`
    );
    const phases = Object.fromEntries(PHASE_KEYS.map(k => [k, 0]));
    for (const row of result.rows) {
      if (Object.prototype.hasOwnProperty.call(phases, row.phase)) {
        phases[row.phase] = Number(row.count);
      }
    }
    const total = Object.values(phases).reduce((a, b) => a + b, 0);
    return res.json({ phases, total });
  } catch (err) {
    console.error('[GET /orchestrator/relay-runs/summary]', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

/**
 * GET /api/brain/orchestrator/relay-runs/:initiative_id
 *
 * 查询指定 initiative_id 的最新 v2 run 详情（含全量字段）
 * 找到 → 200 + 完整对象
 * 不找到 → 404 + { error: "not found" }
 * DB 失败 → 500 + { error: err.message }
 */
/**
 * POST /api/brain/orchestrator/relay-runs/:initiative_id — 前台点火建档。
 * 人工前台接管 controller 时没有 Brain spawnSkillRelaySession 的 INSERT（Issue 968b6f58），
 * 进度上报/PR 回写全 404。本端点补建档：幂等（已有 v2 非终态行则返回现有行），
 * orchestrator_host='foreground'（relay-watchdog 对该 host 跳过重点火——前台无 relay 容器，
 * "容器消失=死跑"判据对它恒真，会 spawn 无头容器与前台会话双跑）。
 * 列对齐 harness-skill-relay.js spawnSkillRelaySession 的 INSERT。
 */
router.post('/relay-runs/:initiative_id', async (req, res) => {
  const { initiative_id } = req.params;
  const { phase, journey_id } = req.body || {};
  const ALLOWED = ['planning', 'gan', 'generate', 'evaluate'];
  const startPhase = phase || 'planning';
  if (!ALLOWED.includes(startPhase)) {
    return res.status(400).json({ error: 'invalid phase', allowed: ALLOWED });
  }
  try {
    const taskQ = await pool.query(`SELECT id, task_type, payload FROM tasks WHERE id = $1`, [initiative_id]);
    const task = taskQ.rows[0];
    if (!task || task.task_type !== 'harness_initiative') {
      return res.status(404).json({ error: 'harness_initiative task not found' });
    }
    const existing = await pool.query(
      `SELECT id, initiative_id, phase, orchestrator_host, started_at
         FROM initiative_runs
        WHERE initiative_id = $1 AND orchestrator_version = 'v2'
          AND phase NOT IN ('done','failed')
        LIMIT 1`,
      [initiative_id]
    );
    if (existing.rows.length > 0) {
      return res.json({ created: false, run: existing.rows[0] });
    }
    const journeyId = journey_id || task.payload?.journey_id || null;
    const ins = await pool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at)
       VALUES ($1, $2, $3, 'v2', 'foreground', NOW() + INTERVAL '6 hours')
       RETURNING id, initiative_id, phase, orchestrator_host, started_at, deadline_at`,
      [initiative_id, startPhase, journeyId]
    );
    return res.status(201).json({ created: true, run: ins.rows[0] });
  } catch (err) {
    console.error('[POST /orchestrator/relay-runs/:id]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ---- verdict/cost best-effort 归一（P1 裁决结构化回写）----
// 铁律：非法值忽略+warn，绝不 400——400 会连带打回 phase=done 终态写入，
// watchdog（phase NOT IN done/failed 判据）会把已完成 run 重新点火（spec BLOCKER-1）。
function parseVerdictCostFields(body) {
  const warnings = [];
  const normVerdict = (raw, allowed, field) => {
    if (raw === undefined || raw === null) return null;
    const v = String(raw).trim().toUpperCase();
    if (allowed.includes(v)) return v;
    console.warn(`[PATCH /orchestrator/relay-runs] ${field} 非法值被忽略: ${JSON.stringify(raw)}`);
    warnings.push(`${field}_ignored`);
    return null;
  };
  const judgeVerdict = normVerdict(body?.verdict, ['PASS', 'FAIL'], 'verdict');
  const evaluateVerdict = normVerdict(body?.evaluate_verdict, ['PASS', 'FAIL', 'FIXED'], 'evaluate_verdict');
  let costUsd = null;
  const rawCost = body?.cost;
  if (rawCost !== undefined && rawCost !== null) {
    const n = Number(rawCost);
    if (Number.isFinite(n) && n >= 0) {
      costUsd = n;
    } else {
      console.warn(`[PATCH /orchestrator/relay-runs] cost 非法值被忽略: ${JSON.stringify(rawCost)}`);
      warnings.push('cost_ignored');
    }
  }
  return { warnings, evaluateVerdict, judgeVerdict, costUsd };
}

/**
 * PATCH /api/brain/orchestrator/relay-runs/:initiative_id
 *
 * controller session report 步骤回写终态（skill v1.1.0 配套；治巡逻 Stuck 误报）。
 * 只接受 phase ∈ {done, failed}（中间态由 v2 观测从外部真相推导，不接受写入）；
 * 只允许改 orchestrator_version='v2' 的行；failed 可带 failure_reason。
 */
router.patch('/relay-runs/:initiative_id', async (req, res) => {
  const { initiative_id } = req.params;
  const { phase, failure_reason, pr_url } = req.body || {};
  // 中间态 = controller 每棒完成后的进度上报（migration 312 枚举预留；进度条数据源）
  const ALLOWED = ['planning', 'gan', 'generate', 'evaluate', 'done', 'failed'];
  if (!ALLOWED.includes(phase)) {
    return res.status(400).json({ error: 'invalid phase', allowed: ALLOWED });
  }
  // pr_url 可选：非空必须以 https://github.com/ 开头
  if (pr_url !== undefined && pr_url !== null) {
    if (typeof pr_url !== 'string' || pr_url === '' || !pr_url.startsWith('https://github.com/')) {
      return res.status(400).json({ error: 'pr_url 非法，须以 https://github.com/ 开头' });
    }
  }
  const { warnings, evaluateVerdict, judgeVerdict, costUsd } = parseVerdictCostFields(req.body);
  try {
    const result = await pool.query(
      `UPDATE initiative_runs
         SET phase = $2,
             completed_at = CASE WHEN $2 IN ('done','failed') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
             failure_reason = COALESCE($3, failure_reason),
             pr_url = COALESCE($4, pr_url),
             evaluate_verdict = COALESCE($5, evaluate_verdict),
             judge_verdict = COALESCE($6, judge_verdict),
             cost_usd = COALESCE($7, cost_usd)
       WHERE initiative_id = $1 AND orchestrator_version = 'v2'
       RETURNING id, initiative_id, phase, completed_at, failure_reason, pr_url,
                 evaluate_verdict, judge_verdict, cost_usd`,
      [initiative_id, phase, failure_reason || null, pr_url || null, evaluateVerdict, judgeVerdict, costUsd]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'v2 run not found for initiative_id' });
    }
    return res.json(warnings.length ? { ...result.rows[0], warnings } : result.rows[0]);
  } catch (err) {
    // 500 不暴露内部 err.message（信息卫生，run-2 同规矩）
    console.error('[PATCH /orchestrator/relay-runs/:id]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.get('/relay-runs/:initiative_id', async (req, res) => {
  const { initiative_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, initiative_id, phase, started_at, deadline_at, completed_at,
              failure_reason, orchestrator_version, orchestrator_heartbeat_at,
              orchestrator_host, orchestrator_pid, pr_url, round,
              evaluate_verdict, judge_verdict, cost_usd
       FROM initiative_runs
       WHERE initiative_id = $1 AND orchestrator_version = 'v2'
       LIMIT 1`,
      [initiative_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /orchestrator/relay-runs/:initiative_id]', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
