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

const TERMINAL_ATTEMPT_STATUSES = new Set([
  'completed', 'completed_with_concerns', 'failed', 'cancelled', 'blocked', 'needs_context',
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
      // 非空。task 行必须走正门 createTask（task-creation-inventory 守卫禁止任何模块绕过原子路由仓直写 tasks 表）；status 直接建成 in_progress，tick 不会捡走。source_id 幂等：
      // 同一 run_id 复用同一 task 锚。
      const createTask = createTaskFn
        ?? (await import('../actions.js')).createTask;
      const created = await createTask({
        db: pool,
        source: 'child',
        source_id: `v4-bridge:${runId}`,
        title,
        description: String(body.description ?? body.objective ?? title),
        // task_type 受 tasks_task_type_check 枚举约束，无法新增专用值；锚 task 建成
        // in_progress 永不被 tick 派发，选惰性合法类型 data。
        task_type: 'data',
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
      // 主权闸（migration 423）：活跃 v2 run 必须挂 active controller 会话且租约字段与
      // 会话逐位一致。桥接自己充当 controller：session（2h 租约）→ run（租约从 session
      // 行复制，保证 IS NOT DISTINCT FROM）→ 回填 session.run_id。
      const { rows: existingRun } = await pool.query(
        'SELECT id FROM initiative_runs WHERE id = $1::uuid', [runId],
      );
      if (existingRun.length === 0) {
        const sessionId = uuid();
        await pool.query(
          `INSERT INTO kernel_controller_sessions
             (id, run_id, task_id, generation, source, status, last_heartbeat_at, lease_expires_at)
           VALUES ($1, NULL, $2::uuid, 1, 'v4-bridge', 'active', NOW(), NOW() + INTERVAL '2 hours')`,
          [sessionId, taskId],
        );
        await pool.query(
          `INSERT INTO initiative_runs
             (id, initiative_id, current_task_id, created_source, phase,
              orchestrator_version, orchestrator_host, started_at,
              controller_session_id, controller_generation, controller_lease_expires_at)
           SELECT $1::uuid, $1::uuid, $2::uuid, 'foreground_handoff', 'gan', 'v2', 'v4-bridge', NOW(),
                  session.id, session.generation, session.lease_expires_at
             FROM kernel_controller_sessions session WHERE session.id = $3`,
          [runId, taskId, sessionId],
        );
        await pool.query(
          'UPDATE kernel_controller_sessions SET run_id = $1::uuid WHERE id = $2',
          [runId, sessionId],
        );
      }
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
      // attempt 终态即收尾桥接 run（只动 orchestrator_host='v4-bridge' 的行；created_source 是封闭枚举，取 foreground_handoff）：run→done、
      // session→closed。不留永活 run 干扰监工停摆扫描与「在途禁合 PR」计数。
      if (TERMINAL_ATTEMPT_STATUSES.has(row.status) && row.run_id) {
        await pool.query(
          `UPDATE initiative_runs SET phase='done', completed_at=COALESCE(completed_at, NOW())
            WHERE id = $1::uuid AND orchestrator_host = 'v4-bridge' AND phase NOT IN ('done','failed')`,
          [row.run_id],
        );
        await pool.query(
          `UPDATE kernel_controller_sessions SET status='closed'
            WHERE run_id = $1::uuid AND source = 'v4-bridge' AND status = 'active'`,
          [row.run_id],
        );
      }
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
