/** 状态只存在tasks.result；运行事实继续走task-run唯一入口。 */
import { getRelease } from './release-index.js';
import { requireCommander, digest } from './commander-v2-contract.js';
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
export function checkFence(task, input) {
  const c = task.result?.workflow_control, e = c?.envelope;
  requireCommander(e && task.status === 'in_progress' && c.phase !== 'final', '运行不接收反馈', 409);
  for (const k of ['protocol', 'run_id', 'attempt', 'owner_epoch']) requireCommander(input[k] === e[k], `过期反馈:${k}`, 409);
  return c;
}
export async function duplicateEvent(db, taskId, input) {
  const rows = (await db.query(`SELECT payload FROM task_events WHERE task_id=$1 AND event_type='commander_feedback'
    AND payload->>'run_id'=$2 AND payload->>'seq'=$3 ORDER BY created_at LIMIT 1`, [taskId, input.run_id, String(input.seq)])).rows;
  if (!rows.length) return false;
  requireCommander(rows[0].payload.sha256 === digest(input), '相同序号内容冲突', 409); return true;
}
