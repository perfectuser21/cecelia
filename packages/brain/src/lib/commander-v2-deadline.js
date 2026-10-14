/** 总期限结束撤销推进权；收尾未知仍保留事实与锁，不伪报停止。 */
import { spawn } from 'node:child_process';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { sshWithStdin } from './ssh-exec.js';
import { requireCommander, PROTOCOL, validateDelivery, digest } from './commander-v2-contract.js';
import { transaction, writeControl, event } from './commander-v2-store.js';
import { finishRun } from './task-run.js';
import { finalizeTask, afterTerminalTransition } from './task-terminal.js';
import { releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';
import { releaseTaskLease } from './task-lease.js';
import { statusCommander } from './commander-v2-dispatch.js';

export function deadlineExceeded(control, now = new Date()) {
  return control?.envelope && now.getTime() >= Date.parse(control.envelope.deadline_at);
}
export async function fenceCommander(control, reason, deps = {}) {
  const e = control.envelope;
  if (deps.fence) return deps.fence(e, reason);
  requireCommander(/^wfd-[a-f0-9-]+$/.test(e.run_id), '隔离run_id非法');
  const command = `python3 ~/.openclaw/commander/wf-v2-gateway.py fence ~/wf-agent-runs/${e.run_id}/envelope.json`;
  const raw = await (deps.sshDispatch ?? ((args, input) => sshWithStdin(spawn, args, input, 15000)))(
    [...SSH_BASE_ARGS, control.execution_location.ssh_target, command], JSON.stringify({ reason, task_id: e.task_id, run_id: e.run_id, owner_epoch: e.owner_epoch }));
  const result = JSON.parse(raw);
  requireCommander(result.protocol === PROTOCOL && result.task_id === e.task_id && result.run_id === e.run_id && result.owner_epoch === e.owner_epoch, '隔离回执身份不符', 409);
  return result;
}
export async function expireCommanderTask(pool, taskId, observed, deps = {}) {
  const outcome = await transaction(pool, taskId, async (db, task) => {
    const c = task.result?.workflow_control, e = c?.envelope, now = (deps.now ?? (() => new Date()))();
    if (!e || c.phase === 'final' || !deadlineExceeded(c, now)) return;
    c.execution_fenced = true; c.fenced_owner_epoch = e.owner_epoch;
    c.phase = 'stopping'; c.resume_condition = 'deadline_stop_and_cleanup_readback';
    c.failure = { ...c.failure, reason: 'execution_deadline_exceeded' };
    if (c.remote_execution_fenced !== true) {
      try {
        const fenced = await fenceCommander(c, c.failure.reason, deps);
        requireCommander(fenced?.execution_fenced === true, '运行端未确认隔离', 409);
        c.remote_execution_fenced = true; c.fence_receipt = fenced;
      } catch (error) {
        c.remote_execution_fenced = false; c.fence_error = { message: error.message, observed_at: now.toISOString() };
      }
    }
    if (observed?.protocol === PROTOCOL && observed.run_id === e.run_id && observed.execution_stopped === true) c.execution_stopped = true;
    c.cleanup = { completed: false, status: 'unresolved', evidence: c.delivery?.cleanup?.evidence ?? [],
      ...(observed?.cleanup ? { official_readback: observed.cleanup } : {}) };
    if (now.getTime() >= Date.parse(e.cleanup_deadline_at)) {
      const verifiedCleanup = c.execution_stopped === true && c.delivery?.cleanup?.completed === true
        && c.delivery.cleanup.evidence?.length > 0 && c.verification?.evidence?.length > 0
        && c.verification.assertions?.some(a => a.name === 'cleanup' && a.pass === true);
      c.cleanup.completed = Boolean(verifiedCleanup); c.cleanup.status = verifiedCleanup ? 'verified' : 'unresolved';
      c.phase = 'final'; c.verdict = verifiedCleanup ? 'FAIL' : 'INCONCLUSIVE'; c.terminal_status = 'failed';
      c.resume_condition = null; c.failure.reason = 'cleanup_deadline_exceeded';
      await (deps.finishRun ?? finishRun)({ runId: e.run_id, status: 'timeout', error: c.failure.reason,
        result: { execution_stopped: c.execution_stopped === true, remote_execution_fenced: c.remote_execution_fenced, cleanup: c.cleanup, deadline_exceeded: true } }, { pool: db, strict: true, emit: async () => {} });
      await writeControl(db, taskId, c);
      const finalized = await finalizeTask(db, taskId, 'failed', { relay: false, onlyIfStatus: 'in_progress', mergeResult: { commander_terminal: { verdict: c.verdict, cleanup: c.cleanup } } });
      requireCommander(finalized.rowCount === 1, '超期终判未能落原任务', 409);
      await event(db, taskId, 'commander_final', { run_id: e.run_id, verdict: c.verdict, terminal_status: 'failed',
        execution_stopped: c.execution_stopped, remote_execution_fenced: c.remote_execution_fenced, cleanup: c.cleanup, actor: 'workflow-commander-v2' });
      return { failed: true };
    }
    await writeControl(db, taskId, c);
  });
  if (outcome?.failed) await (deps.afterTerminal ?? afterTerminalTransition)(pool, taskId, 'failed');
  return outcome;
}
export async function reconcileFinalCleanup(pool, taskId, deps = {}) {
  return transaction(pool, taskId, async (db, task) => {
    const c = task.result?.workflow_control, e = c?.envelope;
    if (task.status !== 'failed' || c?.phase !== 'final' || c.cleanup_verification?.confirmed === true) return;
    let observed;
    try { observed = await statusCommander(e, deps); }
    catch (error) {
      c.cleanup_readback_error = { reason: 'official_status_unavailable', message: error.message };
      await writeControl(db, taskId, c); return { isolated: true };
    }
    requireCommander(observed.protocol === PROTOCOL && observed.run_id === e.run_id, '收尾status身份不符', 409);
    if (observed.execution_stopped !== true || !observed.delivery?.cleanup?.completed || !observed.delivery.cleanup.evidence?.length) return { isolated: true };
    validateDelivery(observed.delivery, e);
    c.execution_stopped = true;
    const original = c.delivery;
    c.delivery = original ? { ...original, cleanup: observed.delivery.cleanup } : observed.delivery;
    c.cleanup = { ...observed.delivery.cleanup, status: 'verified' };
    c.cleanup_verification = { confirmed: true, source: 'official_status', evidence: observed.delivery.cleanup.evidence };
    await writeControl(db, taskId, c);
    await event(db, taskId, 'commander_final_cleanup_readback', { run_id: e.run_id, actor: 'workflow-commander-v2',
      original_delivery_sha256: original ? digest(original) : null, official_delivery_sha256: digest(observed.delivery),
      verdict_preserved: c.verdict, cleanup: c.cleanup, evidence: c.cleanup_verification.evidence });
    await (deps.releaseLock ?? ((id, client) => releaseDeviceLocksHeldBy(id, client)))(taskId, db);
    await (deps.releaseLease ?? releaseTaskLease)(db, { taskId, claimer: null, reason: 'commander_final_cleanup_verified' });
    c.lock_released = true; await writeControl(db, taskId, c);
    return { cleanup_verified: true, verdict: c.verdict };
  });
}
