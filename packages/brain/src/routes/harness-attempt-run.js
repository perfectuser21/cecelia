/**
 * harness-attempt-run.js —— V4 画布 Worker 的单角色 attempt 接线（第 51 批，决策 bc242b62）。
 *
 * 背景：coding 工作流迁到 OpenClaw×n8n V4 骨架后，阶段内的真实执行仍要用 Brain 的
 * fleet 派发（角色容器、凭据签发、attempt 回执）。此前不存在任何 HTTP 面能
 * 「派发一个角色 attempt 并取回 harness_attempts.result」——attempt-telemetry 刻意
 * 剔除 result。本路由是唯一接线：
 *   POST /api/brain/harness/attempt-run          异步派发（202），复用 buildRealDeps().dispatch
 *   GET  /api/brain/harness/attempt-run/:id      轮询结构化结果（含 result/failure_class）
 *
 * 关键设计：
 * - 鉴权 internalAuthOrLoopback：HK 的 V4 Worker 走 Bearer CECELIA_INTERNAL_TOKEN。
 * - observed.task 不带 task_type / payload.work_kind → assertDispatchRoutingReceipt
 *   直接放行（dispatcher.js:47 的既有口子），不牵扯 work_routing_receipts / impact contract。
 * - run 行按 attempt-store 的硬要求写 orchestrator_version='v2'（v1 会被
 *   「Kernel run is terminal or missing」拒掉——冒烟脚本里的 v1 写法照抄会翻车）。
 * - 允许复用 run_id（同一 V4 run 的多个阶段共享一条 initiative_runs 行）。
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

export const ALLOWED_ROLES = Object.freeze([
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
]);

const ATTEMPT_PROJECTION = Object.freeze([
  'id', 'run_id', 'role', 'status', 'result', 'failure_class', 'error_code',
  'error_message', 'provider', 'account_id', 'requested_machine_id',
  'actual_machine_id', 'execution_transport', 'machine_attestation_status',
  'started_at', 'completed_at', 'created_at', 'updated_at',
]);

export function createHarnessAttemptRunRouter({
  pool,
  buildDeps = null,
  attemptStoreFactory = null,
  createTaskFn = null,
  uuid = randomUUID,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createHarnessAttemptRunRouter requires a pool');
  }
  const router = Router();
  let depsPromise = null;
  const getDeps = () => {
    depsPromise ??= (async () => {
      if (buildDeps) return buildDeps();
      const { buildRealDeps } = await import('../orchestrator/run.js');
      return buildRealDeps({ pool });
    })();
    return depsPromise;
  };
  let storePromise = null;
  const getStore = () => {
    storePromise ??= (async () => {
      if (attemptStoreFactory) return attemptStoreFactory();
      const { createAttemptStore } = await import('../orchestrator/attempt-store.js');
      return createAttemptStore(pool);
    })();
    return storePromise;
  };

  router.post('/attempt-run', internalAuthOrLoopback, async (req, res) => {
    try {
      const body = req.body ?? {};
      const role = String(body.role ?? '');
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ error: 'role_not_allowed', allowed: ALLOWED_ROLES });
      }
      const title = String(body.title ?? '').trim();
      if (!title) return res.status(400).json({ error: 'title_required' });
      const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
      const sprintDir = String(payload.sprint_dir ?? '').trim();
      if (!sprintDir) return res.status(400).json({ error: 'payload.sprint_dir_required' });
      // 铁律：本路由绝不携带会触发 routing receipt 硬闸的字段（那套闸属于 kernel 全链）。
      const cleanPayload = { ...payload };
      delete cleanPayload.work_kind;

      const runId = typeof body.run_id === 'string' && body.run_id ? body.run_id : uuid();
      // v2 run 行有硬约束（migration 375）：current_task_id（FK→tasks.id）与 created_source
      // 非空。task 行必须走正门 createTask（task-creation-inventory 守卫禁止任何模块直接
      // INSERT INTO tasks）；status 直接建成 in_progress，tick 不会捡走。source_id 幂等：
      // 同一 run_id 复用同一 task 锚。
      const createTask = createTaskFn
        ?? (await import('../actions.js')).createTask;
      const created = await createTask({
        db: pool,
        source: 'child',
        source_id: `v4-bridge:${runId}`,
        title,
        description: String(body.description ?? body.objective ?? title),
        task_type: 'v4_stage',
        status: 'in_progress',
        priority: 'P2',
        trigger_source: 'v4_bridge',
        allow_unscoped: true,
        payload: cleanPayload,
      });
      const taskId = created?.task?.id ?? null;
      if (!created?.success || !taskId) {
        return res.status(502).json({ error: 'task_anchor_failed', detail: created?.error ?? 'createTask returned no task id' });
      }
      await pool.query(
        `INSERT INTO initiative_runs
           (id, initiative_id, current_task_id, created_source, phase,
            orchestrator_version, orchestrator_host, started_at)
         VALUES ($1::uuid, $1::uuid, $2::uuid, 'v4-bridge', 'gan', 'v2', 'v4-bridge', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [runId, taskId],
      );
      const { rows: [{ hop }] } = await pool.query(
        'SELECT COALESCE(MAX(hop), 0) + 1 AS hop FROM harness_attempts WHERE run_id = $1',
        [runId],
      );

      const deps = await getDeps();
      const launched = await deps.dispatch(`spawn:${role}`, {
        taskId: runId,
        runId,
        hop: Number(hop),
        decision: { phase: 'gan' },
        observed: {
          task: {
            id: runId,
            title,
            description: String(body.description ?? body.objective ?? title),
            payload: cleanPayload,
          },
          run: { id: runId, phase: 'gan' },
          contract: { row: { propose_branch: cleanPayload.branch ?? 'v4-bridge' } },
        },
      });

      const attemptId = launched?.attempt_id ?? launched?.attemptId ?? null;
      if (launched?.status !== 'LAUNCHED' || !attemptId) {
        return res.status(502).json({
          error: 'dispatch_not_launched',
          status: launched?.status ?? null,
          control_status: launched?.control_status ?? null,
          detail: launched?.detail ?? launched?.fallback_reason ?? null,
        });
      }
      return res.status(202).json({
        status: 'LAUNCHED',
        run_id: runId,
        attempt_id: attemptId,
        role,
        lease_owner: launched.lease_owner ?? launched.leaseOwner ?? null,
      });
    } catch (error) {
      return res.status(500).json({ error: 'attempt_run_failed', detail: String(error?.message ?? error) });
    }
  });

  router.get('/attempt-run/:attemptId', internalAuthOrLoopback, async (req, res) => {
    try {
      const store = await getStore();
      const row = await store.getById(req.params.attemptId);
      if (!row) return res.status(404).json({ error: 'attempt_not_found' });
      const out = {};
      for (const key of ATTEMPT_PROJECTION) out[key] = row[key] ?? null;
      return res.json(out);
    } catch (error) {
      return res.status(500).json({ error: 'attempt_lookup_failed', detail: String(error?.message ?? error) });
    }
  });

  return router;
}

export default createHarnessAttemptRunRouter;
