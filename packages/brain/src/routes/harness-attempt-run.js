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
import { resolveValidationClock } from '../orchestrator/validation-clock.js';

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

const SHA40 = /^[a-f0-9]{40}$/;

export function createHarnessAttemptRunRouter({
  pool,
  buildDeps = null,
  attemptStoreFactory = null,
  createTaskFn = null,
  sealDepsFactory = null,
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
  let sealDepsPromise = null;
  const getSealDeps = () => {
    sealDepsPromise ??= (async () => {
      if (sealDepsFactory) return sealDepsFactory();
      const { collectApprovedContractArtifacts } = await import('../orchestrator/contract-artifacts.js');
      const { materializeApprovedContract } = await import('../orchestrator/contract-store.js');
      const { readGitArtifact, listGitArtifacts } = await import('../orchestrator/git-artifact-reader.js');
      const repoRoot = process.env.REPO_ROOT || process.cwd();
      return {
        collectArtifacts: (params) => collectApprovedContractArtifacts({
          ...params,
          readGitFile: (sha, filePath, opts = {}) => readGitArtifact(sha, filePath, {
            cwd: repoRoot, repo: opts.repo ?? null,
          }),
          listGitFiles: (sha, prefix, opts = {}) => listGitArtifacts(sha, prefix, {
            cwd: repoRoot, repo: opts.repo ?? null,
          }),
        }),
        materialize: materializeApprovedContract,
      };
    })();
    return sealDepsPromise;
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
      // 第 54 批：keep_open=true 建 orchestrator_host='v4-bridge-shared' 的 run——GET 终态
      // 自动收尾只认 'v4-bridge'，天然跳过共享 run；同阶段多角色（proposer→reviewer）复用
      // 同一 run_id 才能互见 contract_artifacts（金丝雀 #6b 实证），最后由显式 close 口收尾。
      const orchestratorHost = body.keep_open === true ? 'v4-bridge-shared' : 'v4-bridge';
      // v2 run 行有硬约束（migration 375）：current_task_id（FK→tasks.id）与 created_source
      // 非空。task 行必须走正门 createTask（task-creation-inventory 守卫禁止任何模块绕过原子路由仓直写 tasks 表）；status 直接建成 in_progress，tick 不会捡走。source_id 幂等：
      // 同一 run_id 复用同一 task 锚。
      const createTask = createTaskFn
        ?? (await import('../actions.js')).createTask;
      const created = await createTask({
        db: pool,
        source: 'child',
        source_id: `v4-bridge:${runId}`,
        // idx_tasks_dedup_active 对活跃任务按标题去重；锚 task 标题拼 run 短 id 保证唯一
        title: `${title} [${runId.slice(0, 8)}]`,
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
      const createdRunHere = existingRun.length === 0;
      // 第 52 批：派发未 LAUNCHED / 抛错时回滚本次新建的桥接资源，不留孤儿活跃 run
      //（51 批首夜留了 3 条，人工清理过）。只回滚本调用创建的 run/session/task 锚。
      const rollback = async () => {
        if (!createdRunHere) return;
        try {
          await pool.query(
            `UPDATE initiative_runs SET phase='failed', completed_at=NOW()
              WHERE id = $1::uuid AND orchestrator_host IN ('v4-bridge','v4-bridge-shared') AND phase NOT IN ('done','failed')`,
            [runId],
          );
          await pool.query(
            `UPDATE kernel_controller_sessions SET status='closed'
              WHERE run_id = $1::uuid AND source = 'v4-bridge' AND status = 'active'`,
            [runId],
          );
          await pool.query(
            `UPDATE tasks SET status='cancelled', updated_at=NOW()
              WHERE id = $1::uuid AND trigger_source = 'v4_bridge' AND status = 'in_progress'`,
            [taskId],
          );
        } catch { /* 回滚失败不掩盖原始错误 */ }
      };
      if (createdRunHere) {
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
           SELECT $1::uuid, $1::uuid, $2::uuid, 'foreground_handoff', 'gan', 'v2', $4, NOW(),
                  session.id, session.generation, session.lease_expires_at
             FROM kernel_controller_sessions session WHERE session.id = $3`,
          [runId, taskId, sessionId, orchestratorHost],
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

      // 第 56 批：角色续接字段（金丝雀 #7 实证）。dispatcher 用 observed.proposeBranch/
      // proposeBranchSha 决定 reviewer 的 workspace、observed.plannerPrdArtifact 决定
      // proposer 的、observed.candidate 决定 evaluator/judge 的。桥接不透传则续接角色
      // 永远在 main 全新 workspace 里看不到上一角色推的产物。不传时不塞键（避免 null
      // 干扰 dispatcher 的兜底链）。
      const chained = {};
      if (typeof cleanPayload.propose_branch === 'string' && cleanPayload.propose_branch) {
        chained.proposeBranch = cleanPayload.propose_branch;
      }
      if (typeof cleanPayload.propose_branch_sha === 'string' && cleanPayload.propose_branch_sha) {
        chained.proposeBranchSha = cleanPayload.propose_branch_sha;
      }
      if (Number.isInteger(cleanPayload.propose_branch_rn)) {
        chained.proposeBranchRn = cleanPayload.propose_branch_rn;
      }
      if (cleanPayload.planner_prd_artifact && typeof cleanPayload.planner_prd_artifact === 'object') {
        chained.plannerPrdArtifact = cleanPayload.planner_prd_artifact;
      }
      if (cleanPayload.candidate && typeof cleanPayload.candidate === 'object') {
        chained.candidate = cleanPayload.candidate;
      }

      // 第 62 批：fleet 对验证类角色 bundle 硬要求 validation clock（r71 机制）。桥接每
      // 阶段独立 run、无 decisionLog，钟以派发时刻起表（timeout 默认 3600s，可由
      // payload.timeout_seconds 覆盖）。
      let validationClock;
      if (['generator', 'generator-fix', 'evaluator', 'judge'].includes(role)) {
        validationClock = resolveValidationClock({
          action: `spawn:${role}`,
          decisionLog: [],
          intentAt: new Date().toISOString(),
          timeoutSeconds: Number.isInteger(cleanPayload.timeout_seconds) && cleanPayload.timeout_seconds > 0
            ? cleanPayload.timeout_seconds : 3600,
          allowEvaluatorOrigin: true,
        }) ?? undefined;
      }

      const deps = await getDeps();
      let launched;
      // 第 53 批：ctx.taskId / observed.task.id 必须是锚 task id（bundle.inputs.task_id 取自
      // observed.task.id）。拿 runId 冒充会被 migration 428 的回执权威触发器拒
      //（source_task_id ≠ run.current_task_id → planner 回执 500 无限重试），且执行体查
      // /api/brain/tasks/<runId> 404 拿不到 payload。
      try {
        launched = await deps.dispatch(`spawn:${role}`, {
        taskId,
        runId,
        hop: Number(hop),
        ...(validationClock ? { validationClock } : {}),
        decision: { phase: 'gan' },
        observed: {
          task: {
            id: taskId,
            title,
            description: String(body.description ?? body.objective ?? title),
            payload: cleanPayload,
          },
          run: { id: runId, phase: 'gan' },
          // 第 60 批：冻结合同身份（generator/evaluator/judge 装配合同的钥匙——dispatcher
          // 见 row.id 即自动从 git 按 approved_sha 装配冻结产物；缺则 fleet prepare 必 400）
          contract: (typeof cleanPayload.contract_id === 'string' && cleanPayload.contract_id)
            ? {
              approved: true,
              row: {
                id: cleanPayload.contract_id,
                approved_sha: cleanPayload.approved_sha,
                ...(Number.isInteger(cleanPayload.contract_version)
                  ? { version: cleanPayload.contract_version } : {}),
                propose_branch: cleanPayload.branch ?? 'v4-bridge',
              },
            }
            : { row: { propose_branch: cleanPayload.branch ?? 'v4-bridge' } },
          ...chained,
        },
        });
      } catch (dispatchError) {
        await rollback();
        return res.status(500).json({ error: 'attempt_run_failed', detail: String(dispatchError?.message ?? dispatchError) });
      }

      const attemptId = launched?.attempt_id ?? launched?.attemptId ?? null;
      if (launched?.status !== 'LAUNCHED' || !attemptId) {
        await rollback();
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

  // 第 57 批：V4 seal 阶段工具面。Worker（HK，无仓库 checkout）只给坐标，Brain 按
  // approved_sha 从 git 读回合同产物（sprint-prd / contract-draft / contract-dod / tests）
  // 并走 materializeApprovedContract 机械封印——Test Contract 可解析、artifact projection、
  // 防篡改守卫、幂等，全部沿用 kernel 的原子函数。校验拒绝回 409 结构化（Worker 据此
  // blocked 或带原因打回 proposer），不吞成 500。
  router.post('/attempt-run/contract-seal', internalAuthOrLoopback, async (req, res) => {
    try {
      const body = req.body ?? {};
      const runId = String(body.run_id ?? '');
      const sprintDir = String(body.sprint_dir ?? '').replace(/\/$/, '');
      const branch = String(body.branch ?? '');
      const approvedSha = String(body.approved_sha ?? '');
      if (!runId) return res.status(400).json({ error: 'run_id_required' });
      if (!sprintDir) return res.status(400).json({ error: 'sprint_dir_required' });
      if (!branch) return res.status(400).json({ error: 'branch_required' });
      if (!SHA40.test(approvedSha)) return res.status(400).json({ error: 'approved_sha_invalid' });
      const version = Number.isInteger(body.version) && body.version >= 1 ? body.version : 1;
      const sealDeps = await getSealDeps();
      let collected;
      try {
        collected = await sealDeps.collectArtifacts({
          sourceRevision: approvedSha,
          sprintDir,
          repo: typeof body.repo === 'string' && body.repo ? body.repo : null,
        });
      } catch (error) {
        return res.status(409).json({ error: 'contract_seal_rejected', detail: String(error?.message ?? error) });
      }
      try {
        const sealed = await sealDeps.materialize(pool, {
          runId,
          version,
          branch,
          prdContent: collected.prdContent,
          contractContent: collected.contractContent,
          artifacts: collected.artifacts,
          approvalProvenance: typeof body.approval_provenance === 'string'
            ? body.approval_provenance : null,
        });
        return res.json({ ok: true, run_id: runId, version, sealed: sealed ?? null });
      } catch (error) {
        return res.status(409).json({ error: 'contract_seal_rejected', detail: String(error?.message ?? error) });
      }
    } catch (error) {
      return res.status(500).json({ error: 'contract_seal_failed', detail: String(error?.message ?? error) });
    }
  });

  // 第 54 批：显式收尾口——共享 run（keep_open）由调用方在阶段结束时关闭；普通 run 也可提前关。
  router.post('/attempt-run/close', internalAuthOrLoopback, async (req, res) => {
    try {
      const runId = String(req.body?.run_id ?? '');
      if (!runId) return res.status(400).json({ error: 'run_id_required' });
      const { rowCount: runClosed } = await pool.query(
        `UPDATE initiative_runs SET phase='done', completed_at=COALESCE(completed_at, NOW())
          WHERE id = $1::uuid AND orchestrator_host IN ('v4-bridge','v4-bridge-shared')
            AND phase NOT IN ('done','failed')`,
        [runId],
      );
      await pool.query(
        `UPDATE kernel_controller_sessions SET status='closed'
          WHERE run_id = $1::uuid AND source = 'v4-bridge' AND status = 'active'`,
        [runId],
      );
      await pool.query(
        `UPDATE tasks SET status='completed', updated_at=NOW()
          WHERE id = (SELECT current_task_id FROM initiative_runs WHERE id = $1::uuid)
            AND trigger_source = 'v4_bridge' AND status = 'in_progress'`,
        [runId],
      );
      return res.json({ ok: true, run_id: runId, run_closed: runClosed > 0 });
    } catch (error) {
      return res.status(500).json({ error: 'attempt_run_close_failed', detail: String(error?.message ?? error) });
    }
  });

  router.get('/attempt-run/:attemptId', internalAuthOrLoopback, async (req, res) => {
    try {
      const store = await getStore();
      const row = await store.getById(req.params.attemptId);
      if (!row) return res.status(404).json({ error: 'attempt_not_found' });
      // attempt 终态即收尾桥接 run（只动 orchestrator_host='v4-bridge' 的行；created_source 是封闭枚举，取 foreground_handoff）：run→done、
      // session→closed。不留永活 run 干扰监工停摆扫描与「在途禁合 PR」计数。
      // 第 59 批（金丝雀 #13 案卷）：共享 run（keep_open）的收尾必须整体跳过——此前只有
      // run 行带 host 守卫，session/锚 task 没带：proposer 终态被 GET 一碰锚 task 即
      // completed，relay-watchdog house-keeping 按「task 完了」把活跃共享 run 收割为
      // done，级联 cancel 刚起跑的 reviewer（parent_run_terminal）。共享 run 只由显式
      // close 口收尾。
      let terminalRunHost = null;
      if (TERMINAL_ATTEMPT_STATUSES.has(row.status) && row.run_id) {
        const { rows: hostRows } = await pool.query(
          'SELECT orchestrator_host FROM initiative_runs WHERE id = $1::uuid',
          [row.run_id],
        );
        terminalRunHost = hostRows[0]?.orchestrator_host ?? null;
      }
      if (terminalRunHost === 'v4-bridge') {
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
        // 锚 task 一并闭合（52 批漏了这步，data 型 in_progress 锚会永久堆积）。
        // 第 55 批：tasks 表没有 source_id 列，必须经 run.current_task_id 定位。
        await pool.query(
          `UPDATE tasks SET status='completed', updated_at=NOW()
            WHERE id = (SELECT current_task_id FROM initiative_runs WHERE id = $1::uuid)
              AND trigger_source = 'v4_bridge' AND status = 'in_progress'`,
          [row.run_id],
        );
      }
      const out = {};
      for (const key of ATTEMPT_PROJECTION) out[key] = row[key] ?? null;
      // 第 58 批：暴露首次派发冻结的基线（金丝雀 #8：同 run 两次派发各自现解析 main 头，
      // 中间 main 前进 → 合同基线与 reviewer 权威基线必然冲突）。Worker 取此值传给同一
      // workflow run 的所有后续派发（payload.base_sha 显式基线）。bundle 其余内容不泄。
      out.workspace_base_sha = row.task_bundle?.inputs?.workspace_spec?.base_sha ?? null;
      return res.json(out);
    } catch (error) {
      return res.status(500).json({ error: 'attempt_lookup_failed', detail: String(error?.message ?? error) });
    }
  });

  return router;
}

export default createHarnessAttemptRunRouter;
