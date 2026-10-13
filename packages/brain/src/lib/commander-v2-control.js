/** 通用闭环：停止证据→独立核验→最终判定，失败在原task恢复。 */
import { digest, isCommanderV2, PROTOCOL, requireCommander, recoveryAllowed } from './commander-v2-contract.js';
import { transaction, writeControl, event } from './commander-v2-store.js';
import { statusCommander, dispatchCommanderV2, launchCommander } from './commander-v2-dispatch.js';
import { receiveCommanderEvent } from './commander-v2-feedback.js';
import { finishRun } from './task-run.js';
import { releaseTaskLease } from './task-lease.js';
import { releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';
import { finalizeTask, afterTerminalTransition } from './task-terminal.js';
import { recordCommanderFailure } from './commander-v2-failures.js';
import { createRoutedTask } from '../work-routing-store.js';
export function verificationRequest(task, c) {
  const e = c.envelope;
  const fixed = { task_id: task.id, run_id: e.run_id, attempt: e.attempt, definition_sha256: e.definition.snapshot_sha256,
    input_sha256: e.input_sha256, definition: e.definition, input: e.input, contract: e.contract,
    outputs: c.delivery.outputs, evidence: c.delivery.evidence, cleanup: c.delivery.cleanup,
    execution_status: c.delivery.status, effects: c.delivery.effects };
  return { source: 'scheduler', declared_domain: 'research', mutation_intent: 'read_only', source_id: `commander-verify:${e.run_id}`, requested_task_type: 'research',
    title: `独立核验 ${e.workflow_key} ${e.run_id}`, parent_task_id: task.id,
    description: `使用run-verify技能，只读合同和实际产物，不读执行会话，不执行发布或修复。必须独立读取原始来源及outputs、cleanup证据，逐项核实。\n固定材料：${JSON.stringify(fixed)}\n结果写result.workflow_verification={task_id,run_id,attempt,definition_sha256,verdict:"PASS|FAIL|INCONCLUSIVE",assertions:[],evidence:[]}。PASS必须有非空断言和独立证据，收尾须断言name=cleanup、pass=true。失败时须独立读回外部副作用；仅确认未提交或已补偿，才能加入name=effects_safe_to_retry、pass=true断言，禁止依据执行者自述。对delivery中committed/unknown的每个effect，只有独立确认无动作或已补偿，才能附{name:"effect:<key>",pass:true,status:"none|compensated",evidence:[]}逐项读回断言；后续核验补充证据可更新同核验任务结果触发恢复。`,
    metadata: { workflow_verification_of: task.id, workflow_verification: fixed, skill: 'run-verify', model: 'codex' },
    task: { status: 'queued', priority: 'P1', parent_task_id: task.id, created_by: 'workflow-commander-v2', trigger_source: 'brain_auto' } };
}
async function ensureVerification(db, task, c, deps) {
  if (c.verify_task_id) return;
  const created = await (deps.createVerify ?? ((client, spec) => createRoutedTask(client, spec, null, { transaction: 'existing' })))(db, verificationRequest(task, c));
  c.verify_task_id = created.task?.id;
  requireCommander(c.verify_task_id && c.verify_task_id !== task.id, '独立核验建单失败', 409);
}
function readVerification(vt, task, c) {
  if (!vt || !['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(vt.status)) return null;
  const v = vt.result?.workflow_verification, e = c.envelope;
  if (!v || v.task_id !== task.id || v.run_id !== e.run_id || v.attempt !== e.attempt || v.definition_sha256 !== e.definition.snapshot_sha256
      || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(v.verdict) || !Array.isArray(v.assertions) || !Array.isArray(v.evidence)) {
    return { verdict: 'INCONCLUSIVE', reason: '核验身份或证据格式无效', assertions: [], evidence: [] };
  }
  const pass = vt.status.startsWith('completed') && v.assertions.length > 0 && v.assertions.every(a => a.pass === true)
    && v.assertions.some(a => a.name === 'cleanup' && a.pass === true) && v.evidence.length > 0;
  return v.verdict === 'PASS' && !pass ? { ...v, verdict: 'INCONCLUSIVE', reason: 'PASS缺独立断言或收尾证据' } : v;
}
async function requestRecovery(db, task, c, reason, deps) {
  c.failure = { ...await recordCommanderFailure(db, task, c, reason), verification: c.verification ?? null };
  if (recoveryAllowed(c, reason, (deps.now ?? (() => new Date()))())) {
    c.phase = 'recovering'; c.resume_condition = 'verified_deployment_ready'; c.recovery_mode = 'same_verified_implementation_retry';
  } else {
    c.phase = 'blocked'; c.resume_condition = c.delivery?.effects.some(x => !['none', 'compensated'].includes(x.status))
      ? 'independent_effect_readback_or_compensation' : (c.envelope.attempt >= c.envelope.recovery.max_attempts || Date.now() >= Date.parse(c.envelope.deadline_at))
        ? 'recovery_budget_exhausted' : 'no_compatible_verified_fallback';
  }
  await event(db, task.id, 'commander_recovery', { run_id: c.envelope.run_id, phase: c.phase, reason, resume_condition: c.resume_condition });
}
async function advanceStopped(pool, taskId, observed, deps) {
  return transaction(pool, taskId, async (db, task) => {
    const c = task.result?.workflow_control, e = c?.envelope;
    if (!e || observed.run_id !== e.run_id || observed.protocol !== PROTOCOL) return;
    if (observed.execution_stopped !== true) return;
    c.execution_stopped = true;
    if (!c.delivery) { c.phase = 'blocked'; c.resume_condition = 'terminal_delivery_readback'; await writeControl(db, taskId, c); return; }
    if (!['awaiting_verify', 'final', 'recovering'].includes(c.phase)) {
      await (deps.finishRun ?? finishRun)({ runId: e.run_id, status: c.delivery.status === 'completed' ? 'completed' : 'failed', result: { delivery: c.delivery }, error: c.delivery.failure ? JSON.stringify(c.delivery.failure) : undefined }, { pool: db, strict: true, emit: async () => {} });
      await (deps.releaseLease ?? releaseTaskLease)(db, { taskId, claimer: null, reason: 'commander_execution_stopped' });
      await (deps.releaseLock ?? ((id, client) => releaseDeviceLocksHeldBy(id, client)))(taskId, db);
      c.phase = 'awaiting_verify'; c.resume_condition = 'independent_verification';
      // 执行成功与失败都核验实际产物，防止“失败”自述掩盖已产生的副作用。
      await ensureVerification(db, task, c, deps);
      await db.query(`UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('delivery',$2::jsonb) WHERE id=$1`, [taskId, JSON.stringify(c.delivery)]);
      await writeControl(db, taskId, c);
    }
  });
}
async function advanceVerification(pool, taskId, deps) {
  const outcome = await transaction(pool, taskId, async (db, task) => {
    const c = task.result?.workflow_control;
    if (c?.phase !== 'awaiting_verify' && !(c?.phase === 'blocked' && c.verification)) return;
    await ensureVerification(db, task, c, deps);
    const vt = (await db.query('SELECT * FROM tasks WHERE id=$1', [c.verify_task_id])).rows[0];
    const v = readVerification(vt, task, c);
    if (!v) { await writeControl(db, taskId, c); return; }
    if (c.phase === 'blocked' && digest(v) === digest(c.verification)) return;
    c.verification = v;
    if (v.verdict === 'PASS' && c.delivery.status === 'completed' && c.delivery.cleanup.completed && c.delivery.cleanup.evidence.length) {
      c.phase = 'final'; c.verdict = 'PASS'; c.resume_condition = null;
      await writeControl(db, taskId, c);
      await finalizeTask(db, taskId, 'completed', { relay: false, onlyIfStatus: 'in_progress', mergeResult: { workflow_verification: v } });
      await event(db, taskId, 'commander_final', { run_id: c.envelope.run_id, verdict: 'PASS', actor: 'workflow-commander-v2', evidence: v.evidence });
      return { completed: true };
    } else {
      await requestRecovery(db, task, c, c.delivery.status === 'completed' ? 'verification_failed' : 'execution_failed', deps);
      await writeControl(db, taskId, c);
    }
  });
  if (outcome?.completed) await (deps.afterTerminal ?? afterTerminalTransition)(pool, taskId, 'completed');
  return outcome;
}
export async function reconcileCommanderTask(pool, taskId, deps = {}) {
  let task = (await pool.query('SELECT * FROM tasks WHERE id=$1', [taskId])).rows[0];
  if (!isCommanderV2(task) || task.status !== 'in_progress') return;
  const c = task.result?.workflow_control;
  if (!c) return;
  if (c.phase === 'recovering') return dispatchCommanderV2(pool, taskId, deps);
  if (c.phase === 'prepared') return launchCommander(pool, taskId, deps);
  if (c.phase === 'awaiting_verify' || (c.phase === 'blocked' && c.verification)) return advanceVerification(pool, taskId, deps);
  if (c.phase === 'final') return;
  let observed;
  try { observed = await statusCommander(c.envelope, deps); }
  catch {
    await transaction(pool, taskId, async (db, current) => {
      const state = current.result?.workflow_control;
      if (state?.envelope.run_id === c.envelope.run_id && ['running', 'blocked'].includes(state.phase)) {
        state.phase = 'blocked'; state.resume_condition = 'official_child_wait_or_delivery';
        state.failure = { reason: 'liveness_unknown' }; await writeControl(db, taskId, state);
      }
    });
    return;
  }
  requireCommander(observed.protocol === PROTOCOL && observed.run_id === c.envelope.run_id, 'status身份不符', 409);
  for (const feedback of observed.events ?? []) {
    if (feedback.seq <= (c.last_seq ?? 0)) continue;
    await receiveCommanderEvent(pool, taskId, feedback);
  }
  await advanceStopped(pool, taskId, observed, deps);
}
export async function reconcileCommanderV2(pool, deps = {}) {
  const tasks = (await pool.query(`SELECT id FROM tasks WHERE task_type='workflow_dispatch' AND status='in_progress'
    AND payload->>'commander_protocol'='commander-v2' ORDER BY updated_at LIMIT 20`)).rows;
  const out = [];
  for (const task of tasks) {
    try { await reconcileCommanderTask(pool, task.id, deps); out.push({ task_id: task.id, reconciled: true }); }
    catch (err) { out.push({ task_id: task.id, error: err.message }); }
  }
  return out;
}
