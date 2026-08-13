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
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import {
  createKernelRun,
  loadKernelRunById,
  patchLegacyKernelRunByInitiative,
  patchKernelRunById,
} from '../orchestrator/kernel-run-store.js';
import { COMMANDER_MODES } from '../orchestrator/commander-contract.js';

const router = Router();
const initiativeHistoryRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

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

// task_id 过滤参数校验（issue a638f840）
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/brain/orchestrator/relay-runs
 *
 * 列出 orchestrator_version='v2' 的 initiative_runs，按 started_at DESC 排序
 * 支持 ?limit=N 参数（默认 20，最大 100）
 * 支持 ?phase=<phase> 参数过滤（枚举白名单，来自 migration 312）
 * 支持 ?task_id=<uuid> 参数过滤（issue a638f840）
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

  // 解析并校验 task_id 参数（issue a638f840：report TOTAL_COST 按 task 求和）
  const rawTaskId = req.query.task_id;
  if (rawTaskId !== undefined && !UUID_RE.test(rawTaskId)) {
    return res.status(400).json({ error: 'task_id 参数必须为合法 UUID' });
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

      if (rawTaskId !== undefined) {
        params.push(rawTaskId);
        conditions.push(`current_task_id = $${params.length}`);
      }

      params.push(limit);
      const limitParam = `$${params.length}`;

      return { conditions, params, limitParam };
    }

    try {
      const { conditions, params, limitParam } = buildConditionsAndParams();
      result = await pool.query(
        `SELECT id, initiative_id, phase, current_task_id,
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
          `SELECT id, initiative_id, phase, current_task_id,
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
      `WITH phase_counts AS (
         SELECT phase, record_trust_status, COUNT(*) AS count
           FROM initiative_runs
          WHERE orchestrator_version = 'v2'
          GROUP BY phase, record_trust_status
       ),
       latest_trusted_task_runs AS (
         SELECT DISTINCT ON (current_task_id)
                current_task_id, phase
           FROM initiative_runs
          WHERE orchestrator_version = 'v2'
            AND record_trust_status = 'trusted'
            AND current_task_id IS NOT NULL
          ORDER BY current_task_id, started_at DESC, id DESC
       ),
       slo AS (
         SELECT COUNT(*) FILTER (WHERE phase IN ('done','failed')) AS trusted_total,
                COUNT(*) FILTER (WHERE phase = 'done') AS trusted_done
           FROM latest_trusted_task_runs
       )
       SELECT p.phase, p.record_trust_status, p.count,
              s.trusted_total, s.trusted_done
         FROM slo s
         LEFT JOIN phase_counts p ON TRUE`
    );
    const phases = Object.fromEntries(PHASE_KEYS.map(k => [k, 0]));
    const trust = {
      trusted: 0,
      reconstructed: 0,
      untrusted: 0,
    };
    for (const row of result.rows) {
      const count = Number(row.count);
      if (Object.prototype.hasOwnProperty.call(phases, row.phase)) {
        phases[row.phase] += count;
      }
      const trustStatus = row.record_trust_status || 'untrusted';
      if (Object.prototype.hasOwnProperty.call(trust, trustStatus)) {
        trust[trustStatus] += count;
      }
    }
    const total = Object.values(phases).reduce((a, b) => a + b, 0);
    const trustedTotal = Number(result.rows[0]?.trusted_total ?? 0);
    const trustedDone = Number(result.rows[0]?.trusted_done ?? 0);
    return res.json({
      phases,
      total,
      trust,
      slo: {
        trusted_total: trustedTotal,
        trusted_done: trustedDone,
        trusted_success_rate: trustedTotal === 0
          ? null
          : trustedDone / trustedTotal,
      },
    });
  } catch (err) {
    console.error('[GET /orchestrator/relay-runs/summary]', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

const CREATE_PHASES = ['planning', 'gan', 'generate', 'evaluate'];
const CREATE_COMMANDER_MODES = new Set(COMMANDER_MODES);

async function createRelayRun(req, res, legacyInitiativeId = null) {
  const body = req.body || {};
  const initiativeId = legacyInitiativeId ?? body.initiative_id;
  const taskId = body.current_task_id;
  const createdSource = body.created_source;
  const startPhase = body.phase || 'planning';
  const commanderMode = body.commander_mode === undefined
    ? 'kernel-only'
    : body.commander_mode;

  if (
    !UUID_RE.test(initiativeId ?? '')
    || !UUID_RE.test(taskId ?? '')
    || typeof createdSource !== 'string'
    || createdSource.length === 0
  ) {
    return res.status(400).json({
      error: 'initiative_id, current_task_id and created_source are required',
    });
  }
  if (!CREATE_PHASES.includes(startPhase)) {
    return res.status(400).json({
      error: 'invalid phase',
      allowed: CREATE_PHASES,
    });
  }
  if (!CREATE_COMMANDER_MODES.has(commanderMode)) {
    return res.status(400).json({
      error: 'invalid commander_mode',
      allowed: COMMANDER_MODES,
    });
  }

  try {
    const requestPool = req.app.get('pool') || pool;
    const result = await createKernelRun(requestPool, {
      taskId,
      initiativeId,
      phase: startPhase,
      journeyId: body.journey_id ?? null,
      abilityId: null,
      host: 'foreground',
      deadlineHours: 6,
      createdSource,
      commanderMode,
      predecessorRunId: body.predecessor_run_id ?? null,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    if (
      err.message?.startsWith('invalid Kernel run')
      || err.message?.startsWith('explicit recovery predecessor')
    ) {
      return res.status(400).json({ error: err.message });
    }
    if (
      err.message?.includes('not eligible')
      || err.message?.includes('initiative mismatch')
    ) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[POST /orchestrator/relay-runs]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
}

/**
 * Canonical foreground handoff. The caller must carry both aggregate and task
 * identity; the response always returns the authoritative run_id.
 */
router.post('/relay-runs', (req, res) => createRelayRun(req, res));

/**
 * Legacy compatibility adapter. PR2 removes initiative-addressed mutation
 * after every Controller has switched to the canonical run_id contract.
 */
router.post(
  '/relay-runs/:initiative_id',
  (req, res) => createRelayRun(req, res, req.params.initiative_id),
);

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

function validateRunPatchBody(body) {
  const { phase, failure_reason, pr_url } = body || {};
  const allowed = ['planning', 'gan', 'generate', 'evaluate', 'done', 'failed'];
  if (!allowed.includes(phase)) {
    return {
      error: { status: 400, body: { error: 'invalid phase', allowed } },
    };
  }
  if (
    pr_url !== undefined
    && pr_url !== null
    && (
      typeof pr_url !== 'string'
      || pr_url === ''
      || !pr_url.startsWith('https://github.com/')
    )
  ) {
    return {
      error: {
        status: 400,
        body: { error: 'pr_url 非法，须以 https://github.com/ 开头' },
      },
    };
  }
  const parsed = parseVerdictCostFields(body);
  return {
    patch: {
      phase,
      failureReason: failure_reason || null,
      prUrl: pr_url || null,
      evaluateVerdict: parsed.evaluateVerdict,
      judgeVerdict: parsed.judgeVerdict,
      costUsd: parsed.costUsd,
    },
    warnings: parsed.warnings,
  };
}

router.get('/relay-runs/by-id/:run_id', async (req, res) => {
  const { run_id: runId } = req.params;
  if (!UUID_RE.test(runId)) {
    return res.status(400).json({ error: 'run_id must be a valid UUID' });
  }
  try {
    const requestPool = req.app.get('pool') || pool;
    const run = await loadKernelRunById(requestPool, runId);
    if (!run) return res.status(404).json({ error: 'run not found' });
    return res.json(run);
  } catch (err) {
    console.warn('[GET /orchestrator/relay-runs/by-id/:run_id]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.patch('/relay-runs/by-id/:run_id', async (req, res) => {
  const { run_id: runId } = req.params;
  if (!UUID_RE.test(runId)) {
    return res.status(400).json({ error: 'run_id must be a valid UUID' });
  }
  const parsed = validateRunPatchBody(req.body);
  if (parsed.error) {
    return res.status(parsed.error.status).json(parsed.error.body);
  }
  try {
    const requestPool = req.app.get('pool') || pool;
    const run = await patchKernelRunById(requestPool, {
      runId,
      ...parsed.patch,
    });
    if (!run) return res.status(404).json({ error: 'run not found' });
    return res.json(
      parsed.warnings.length ? { ...run, warnings: parsed.warnings } : run,
    );
  } catch (err) {
    if (
      err.message?.includes('terminal outcome conflict')
      || err.message?.includes('parent task missing')
      || err.message?.includes('identity changed')
    ) {
      return res.status(409).json({ error: err.message });
    }
    console.warn('[PATCH /orchestrator/relay-runs/by-id/:run_id]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.get(
  '/relay-initiatives/:initiative_id/runs',
  initiativeHistoryRateLimit,
  async (req, res) => {
  const { initiative_id: initiativeId } = req.params;
  if (!UUID_RE.test(initiativeId)) {
    return res.status(400).json({ error: 'initiative_id must be a valid UUID' });
  }
  try {
    const requestPool = req.app.get('pool') || pool;
    const { rows } = await requestPool.query(
      `SELECT id, initiative_id, current_task_id, phase,
              orchestrator_version, orchestrator_heartbeat_at,
              orchestrator_pid, orchestrator_host, started_at, updated_at,
              deadline_at, completed_at, failure_reason, pr_url,
              evaluate_verdict, judge_verdict, cost_usd, created_source,
              record_trust_status, record_trust_reason, predecessor_run_id
         FROM initiative_runs
        WHERE initiative_id = $1
          AND orchestrator_version = 'v2'
        ORDER BY started_at DESC, id DESC`,
      [initiativeId],
    );
    return res.json(rows);
  } catch (err) {
    console.warn(
      '[GET /orchestrator/relay-initiatives/:initiative_id/runs]',
      err.message,
    );
    return res.status(500).json({ error: 'internal error' });
  }
  },
);

/**
 * PATCH /api/brain/orchestrator/relay-runs/:initiative_id
 *
 * Deprecated compatibility adapter. It may delegate only when the supplied
 * initiative identity resolves to exactly one historical v2 run. Ambiguity is
 * a 409 and can never be resolved by recency.
 */
router.patch('/relay-runs/:initiative_id', async (req, res) => {
  const { initiative_id: rawId } = req.params;
  if (!UUID_RE.test(rawId) && !/^[0-9a-f]{8}$/i.test(rawId)) {
    return res.status(400).json({ error: 'invalid id format' });
  }
  const parsed = validateRunPatchBody(req.body);
  if (parsed.error) {
    return res.status(parsed.error.status).json(parsed.error.body);
  }
  const requestPool = req.app.get('pool') || pool;
  try {
    const result = await patchLegacyKernelRunByInitiative(requestPool, {
      rawId,
      patch: parsed.patch,
    });
    if (result.candidateCount === 0) {
      return res.status(404).json({
        error: `v2 run not found for legacy identifier: ${rawId}`,
      });
    }
    if (result.candidateCount > 1) {
      return res.status(409).json({
        error: 'ambiguous_legacy_run',
        candidate_count: result.candidateCount,
        canonical_endpoint: '/api/brain/orchestrator/relay-runs/by-id/:run_id',
      });
    }
    const { run } = result;
    const response = {
      ...run,
      canonical_run_id: run.id,
      deprecated: true,
    };
    if (parsed.warnings.length) response.warnings = parsed.warnings;
    return res.json(response);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (
      err.message?.includes('terminal outcome conflict')
      || err.message?.includes('parent task missing')
      || err.message?.includes('identity changed')
    ) {
      return res.status(409).json({ error: err.message });
    }
    console.warn('[PATCH /orchestrator/relay-runs/:id] update error', rawId, err.message);
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
