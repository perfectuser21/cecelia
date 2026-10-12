/** 固定用途工厂路由开关。任务 80f10a59：不提供任意 brain_config setter。 */
import { computeCodeVerdict } from './factory-judge.js';

export const FACTORY_COMMANDER_ROUTE_KEY = 'factory_commander_route_enabled';
const WORKFLOW = 'douyin_video_publish.android';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = value => typeof value === 'string' && UUID.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const enabledValue = value => ['true', '"true"', '1', 'on'].includes(String(value ?? '').trim().toLowerCase());
function requireEvidence(condition, detail) {
  if (!condition) throw Object.assign(new Error(detail), { status: 409, code: 'FACTORY_ROUTE_EVIDENCE_INVALID' });
}
export function validateFactoryCommanderRoute(input) {
  const allowed = ['enabled', 'actor', 'reason', 'evidence_task_id'];
  if (!object(input) || Object.keys(input).some(key => !allowed.includes(key))
      || typeof input.enabled !== 'boolean' || !nonempty(input.actor) || input.actor.length > 160
      || !nonempty(input.reason) || input.reason.length > 2000
      || (input.enabled && !uuid(input.evidence_task_id))
      || (input.evidence_task_id != null && !uuid(input.evidence_task_id))) {
    throw Object.assign(new Error('只接受 enabled:boolean、actor、reason；启用必须指定 evidence_task_id UUID'), { status: 400, code: 'INVALID_INPUT' });
  }
}

export async function readFactoryCommanderRoute(db) {
  const { rows } = await db.query('SELECT value,metadata,updated_at FROM brain_config WHERE key=$1', [FACTORY_COMMANDER_ROUTE_KEY]);
  return { enabled: enabledValue(rows[0]?.value), metadata: rows[0]?.metadata ?? null, updated_at: rows[0]?.updated_at ?? null };
}

async function verifyEnableEvidence(db, taskId) {
  const task = (await db.query('SELECT id,task_type,status,payload,result FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rows[0];
  requireEvidence(task?.task_type === 'workflow_dispatch' && task.status === 'completed', '证据必须为已完成的 workflow_dispatch');
  const p = task.payload ?? {}, r = task.result ?? {}, d = r.delivery ?? {}, runId = p.run_id;
  requireEvidence(p.workflow_key === WORKFLOW && d.workflow_key === WORKFLOW && d.contract_key === 'douyin_video_publish', '工作流不符');
  requireEvidence(nonempty(runId) && d.run_id === runId && d.task_id === task.id && d.source === 'wf-agent-run', '缺少同任务同 run 的真实外壳交付');
  requireEvidence(r.receipt?.exit === 0 && r.commander_result?.status === 'completed' && r.commander_result?.launch_exit === 0, 'Brain 收割/Commander 终态不符');
  requireEvidence(d.shell?.preflight?.ok === true && d.shell.preflight.lock_acquired === true, '外壳预检未通过');
  requireEvidence(d.shell?.cleanup?.ok === true && d.shell.cleanup.app_closed === true && d.shell.cleanup.lock_status === 'free'
    && d.shell.cleanup.outward_attempts === 1 && d.readback?.publish_attempts === 1, '外壳收尾或系统动作账不符');
  requireEvidence(d.agent?.delivery_found === true && [0, '0'].includes(d.agent?.exit), '业务执行未正常交付');
  for (const key of ['preflight', 'prepare', 'publish', 'verify', 'cleanup']) {
    const activity = Array.isArray(d.activities) && d.activities.find(a => a?.key === key);
    requireEvidence(activity?.by === (['preflight', 'cleanup'].includes(key) ? 'shell' : 'agent')
      && activity.readback?.type === 'evidence' && activity.evidence_files?.includes(`${runId}-${key}-original.json`), `缺活动 ${key} 系统证据`);
  }
  for (const key of ['lock-acquire', 'lock-release', 'outward-ledger']) {
    requireEvidence(Array.isArray(d.final_evidence) && d.final_evidence.includes(`${runId}-${key}`), `缺 ${key} 系统证据`);
  }
  const code = computeCodeVerdict({ taskStatus: task.status, delivery: d, expectedOutward: 1, requireEvidence: true, requireActivities: true });
  requireEvidence(code.verdict === 'pass', '现有 Brain 代码裁判未通过');
  const reaped = (await db.query(`SELECT payload FROM task_events WHERE task_id=$1 AND event_type='workflow_dispatch_reaped'
    AND payload->>'run_id'=$2 ORDER BY created_at DESC LIMIT 1`, [taskId, runId])).rows[0]?.payload;
  requireEvidence(reaped?.delivery === 'shell' && reaped.status === 'completed' && reaped.exit === 0, '缺 Brain 实际外壳收割事件');
  // 独立 acceptance_run 不经 factory_judge；复用同 run 的正式 run-verify 任务，绝不解析自由文本断言。
  const verificationTask = (await db.query(`SELECT id,status,payload,result FROM tasks
    WHERE payload->>'factory_verify_of'=$1 AND payload->>'factory_verify_run_id'=$2
    ORDER BY updated_at DESC,id DESC LIMIT 1 FOR SHARE`, [taskId, runId])).rows[0];
  const verification = verificationTask?.result?.verification;
  requireEvidence(verificationTask?.status === 'completed' && verificationTask.payload?.skill === 'run-verify'
    && nonempty(verificationTask.result?.actor) && verification?.stage === 'verify' && verification.run_id === runId
    && verification.verdict === 'pass' && verification.overreach === '无' && Array.isArray(verification.missing) && verification.missing.length === 0
    && verification.claimed_result === 'success' && verification.agrees_with_claim === true
    && Array.isArray(verification.assertions) && verification.assertions.length > 0
    && verification.assertions.every(a => a?.result === 'pass' && nonempty(a.claim) && nonempty(a.basis)), '缺少完整的正式独立核验记录');
  if (r.factory_judge != null) {
    const judge = r.factory_judge;
    requireEvidence(judge.state === 'final' && judge.verdict === 'pass' && judge.run_id === runId
      && judge.code?.verdict === 'pass' && judge.visual?.verdict === 'pass' && judge.verify_task_id === verificationTask.id, '既有工厂裁判尚未最终通过');
  }
  return { evidence_task_id: taskId, verification_task_id: verificationTask.id, verification_actor: verificationTask.result.actor, run_id: runId, workflow_key: WORKFLOW };
}

export async function updateFactoryCommanderRoute(pool, input) {
  validateFactoryCommanderRoute(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // advisory lock 同时覆盖配置行尚不存在的首次并发启用；已有行再 FOR UPDATE。
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [FACTORY_COMMANDER_ROUTE_KEY]);
    const previous = (await db.query('SELECT value,metadata,updated_at FROM brain_config WHERE key=$1 FOR UPDATE', [FACTORY_COMMANDER_ROUTE_KEY])).rows[0];
    const previousEnabled = enabledValue(previous?.value);
    const proof = input.enabled ? await verifyEnableEvidence(db, input.evidence_task_id) : {};
    if (previousEnabled === input.enabled) {
      await db.query('COMMIT');
      return { enabled: previousEnabled, changed: false, previous_enabled: previousEnabled, metadata: previous?.metadata ?? null, updated_at: previous?.updated_at ?? null };
    }
    const metadata = { actor: input.actor.trim(), reason: input.reason.trim(), previous_enabled: previousEnabled, ...proof };
    await db.query(`INSERT INTO brain_config(key,value,metadata,updated_at) VALUES($1,$2,$3,NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,metadata=EXCLUDED.metadata,updated_at=NOW()`,
    [FACTORY_COMMANDER_ROUTE_KEY, String(input.enabled), metadata]);
    await db.query(`INSERT INTO cecelia_events(event_type,source,payload)
      VALUES('factory_commander_route_changed','factory-commander-route-api',$1)`,
    [{ key: FACTORY_COMMANDER_ROUTE_KEY, enabled: input.enabled, ...metadata }]);
    const readback = await readFactoryCommanderRoute(db);
    requireEvidence(readback.enabled === input.enabled, '配置回读不符');
    await db.query('COMMIT');
    return { ...readback, changed: true, previous_enabled: previousEnabled };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}
