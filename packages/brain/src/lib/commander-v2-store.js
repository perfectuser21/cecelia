/** 状态只存在tasks.result；运行事实继续走task-run唯一入口。 */
import { getRelease } from './release-index.js';
import { requireCommander, digest } from './commander-v2-contract.js';
import { pairedImplementations, primaryImplementation } from './commander-v2-implementation.js';
export async function transaction(pool, taskId, work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,716))', [taskId]);
    const task = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0];
    requireCommander(task, '任务不存在', 404);
    const result = await work(db, task);
    await db.query('COMMIT'); return result;
  } catch (err) { await db.query('ROLLBACK'); throw err; }
  finally { db.release(); }
}
export async function writeControl(db, taskId, control) {
  await db.query(`UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('workflow_control',$2::jsonb),updated_at=NOW() WHERE id=$1`, [taskId, JSON.stringify(control)]);
}
export async function event(db, taskId, kind, data) {
  await db.query('INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES($1,$2,$3::jsonb,NOW())', [taskId, kind, JSON.stringify(data)]);
}
export async function frozenContract(db, task) {
  const definition = task.payload.workflow_definition;
  requireCommander(definition && typeof definition === 'object', '缺workflow_definition');
  const release = await getRelease(db, definition.release_id);
  const workflow = release.payload.workflows.find(w => w.id === definition.workflow_definition_version_id && w.workflow_id === definition.workflow_id);
  requireCommander(workflow && workflow.payload_sha256 === definition.snapshot_sha256, '冻结定义摘要不符');
  const contract = workflow.payload.contract;
  requireCommander(contract && [contract.key, contract.workflow, workflow.payload.key].includes(task.payload.workflow_key), 'workflow_key与冻结合同不符');
  return { definition, contract, release };
}
/** 语义key只来自release冻结引用及步骤；definition的严格UUID schema保持原样。 */
export function activityBindings(definition, release) {
  const workflow = release.payload.workflows.find(w => w.id === definition.workflow_definition_version_id && w.workflow_id === definition.workflow_id);
  requireCommander(workflow?.payload_sha256 === definition.snapshot_sha256, '活动映射冻结定义摘要不符');
  const refs = workflow.payload.activities, path = definition.expected_path;
  requireCommander(Array.isArray(path) && path.length > 0, '活动映射缺路径');
  const keys = new Set(), covered = new Set(), result = [];
  for (const entry of path.filter(p => !p.step_id)) {
    const ref = refs.find(r => r.reference_id === entry.reference_id);
    const activity = release.payload.activities.find(a => a.id === ref?.activity_version_id);
    requireCommander(ref && activity && entry.activity_id === ref.activity_id && activity.activity_id === ref.activity_id
      && entry.activity_definition_version_id === activity.id, '活动映射路径身份不符');
    requireCommander(typeof ref.slot_key === 'string' && ref.slot_key.length > 0 && !keys.has(ref.slot_key), '活动映射key缺失或重复');
    keys.add(ref.slot_key);
    const stepKeys = new Set(), steps = [];
    for (const step of activity.payload.steps ?? []) {
      requireCommander(step.step_id && step.locator?.activity_id === activity.activity_id, '冻结步骤路径身份缺失');
      requireCommander(typeof step.locator.step_key === 'string' && step.locator.step_key.length > 0 && !stepKeys.has(step.locator.step_key), '冻结步骤key缺失或重复');
      stepKeys.add(step.locator.step_key);
      steps.push({ key: step.locator.step_key, step_id: step.step_id });
    }
    for (const stepId of [undefined, ...steps.map(s => s.step_id)]) {
      const matches = path.filter(p => p.reference_id === ref.reference_id && p.step_id === stepId
        && p.activity_id === activity.activity_id && p.activity_definition_version_id === activity.id);
      const identity = `${ref.reference_id}:${stepId ?? ''}`;
      requireCommander(matches.length === 1 && !covered.has(identity), '冻结路径缺失或重复');
      covered.add(identity);
    }
    const implementations = pairedImplementations(activity);
    const primary = primaryImplementation(activity, implementations);
    result.push({ key: ref.slot_key, reference_id: ref.reference_id, activity_id: activity.activity_id,
      activity_definition_version_id: activity.id, steps, ...(implementations ? { implementations } : {}),
      ...(primary ? { primary_implementation: primary } : {}) });
  }
  requireCommander(result.length === refs.length && covered.size === path.length, '冻结路径未完整覆盖');
  return result;
}
export async function frozenActivityBindings(db, definition) {
  return activityBindings(definition, await getRelease(db, definition.release_id));
}
export function checkFence(task, input) {
  const c = task.result?.workflow_control, e = c?.envelope;
  requireCommander(e && task.status === 'in_progress' && c.phase !== 'final', '运行不接收反馈', 409);
  requireCommander(c.execution_fenced !== true, '执行权已隔离，不接收迟到反馈', 409);
  for (const k of ['protocol', 'run_id', 'attempt', 'owner_epoch']) requireCommander(input[k] === e[k], `过期反馈:${k}`, 409);
  return c;
}
export async function duplicateEvent(db, taskId, input) {
  const rows = (await db.query(`SELECT payload FROM task_events WHERE task_id=$1 AND event_type='commander_feedback'
    AND payload->>'run_id'=$2 AND payload->>'seq'=$3 ORDER BY created_at LIMIT 1`, [taskId, input.run_id, String(input.seq)])).rows;
  if (!rows.length) return false;
  requireCommander(rows[0].payload.sha256 === digest(input), '相同序号内容冲突', 409); return true;
}
