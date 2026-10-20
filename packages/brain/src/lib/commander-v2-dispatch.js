/** 正式Brain派发入口：绑定与信封同事务提交，才允许资源/agent副作用。 */
import { execFile, spawn } from 'node:child_process';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { sshWithStdin, sshRun } from './ssh-exec.js';
import { resolvePrimaryWorkerId, sshTargetFor } from '../machine-registry.js';
import { buildRemoteCommand } from '../openclaw-agent-executor.js';
import { startRun } from './task-run.js';
import { getRelease } from './release-index.js';
import { runtimeRootFromRelease, commanderRuntimeRoot, validateExecutionLocation, commanderLaunchMessage } from './commander-runtime-location.js';
import { checkDeviceLockForManualDispatch } from './manual-dispatch-device-gate.js';
import { setBrainLease } from './task-lease.js';
import { transaction, frozenContract, frozenActivityBindings, writeControl, event } from './commander-v2-store.js';
import { makeEnvelope, validateReady, isCommanderV2, requireCommander, bounded } from './commander-v2-contract.js';
const target = deps => deps.target ?? sshTargetFor(resolvePrimaryWorkerId());
const send = (args, input) => sshWithStdin(spawn, args, input);
function executionTarget(e, deps) {
  const host = e.execution_location?.ssh_target ?? target(deps);
  requireCommander(typeof host === 'string' && /^[a-zA-Z0-9_.@-]+$/.test(host), '冻结执行宿主非法');
  return host;
}
export async function readyCommander(e, deps = {}) {
  const runtimeRoot = commanderRuntimeRoot(e);
  if (deps.ready) return deps.ready(e);
  const raw = await (deps.sshDispatch ?? send)([...SSH_BASE_ARGS, executionTarget(e, deps), `${runtimeRoot}/wf-launch.sh --ready`], JSON.stringify({ definition: e.definition, workflow_key: e.workflow_key, ...(e.execution_location ? { execution_location: e.execution_location } : {}) }));
  return JSON.parse(raw);
}
export async function statusCommander(e, deps = {}) {
  const runtimeRoot = commanderRuntimeRoot(e);
  if (deps.status) return deps.status(e);
  requireCommander(/^wfd-[a-f0-9-]+$/.test(e.run_id), 'run_id非法');
  const raw = await (deps.sshProbe ?? (args => sshRun(execFile, args, { timeout: 15000, encoding: 'utf8' })))([...SSH_BASE_ARGS, executionTarget(e, deps), `${runtimeRoot}/wf-status.sh ${e.run_id}`]);
  return JSON.parse(raw);
}
export async function prepareCommander(pool, taskId, deps = {}) {
  return transaction(pool, taskId, async (db, task) => {
    requireCommander(isCommanderV2(task), '协议错误');
    const previous = task.result?.workflow_control;
    if (previous && previous.phase !== 'recovering') return previous;
    requireCommander(task.status === 'queued' || previous?.phase === 'recovering', '任务不可起跑', 409);
    const frozen = previous ? { definition: previous.envelope.definition, contract: previous.envelope.contract } : await (deps.frozenContract ?? frozenContract)(db, task);
    const sourceTask = previous ? { ...task, payload: { ...task.payload, workflow_input: previous.envelope.input } } : task;
    const e = makeEnvelope(sourceTask, frozen.definition, frozen.contract, previous?.envelope, (deps.now ?? (() => new Date()))(), previous);
    const release = frozen.release ?? await getRelease(db, e.definition.release_id);
    const runtime_root = runtimeRootFromRelease(release);
    if (previous) {
      validateExecutionLocation(previous);
      requireCommander(commanderRuntimeRoot(previous.envelope) === runtime_root, '恢复不得改变冻结runtime根', 409);
    }
    e.execution_location = { ssh_target: previous?.execution_location?.ssh_target ?? target(deps),
      run_directory: `~/wf-agent-runs/${e.run_id}`, runtime_root };
    e.activity_bindings = await frozenActivityBindings(db, e.definition);
    bounded(e, 180000, '信封');
    // ready为只读协议握手，实际run binding再次检查数据库当前部署，不能用ready替代release闸。
    validateReady(await readyCommander(e, deps), e.definition);
    await (deps.startRun ?? startRun)({ taskId, runId: e.run_id, source: 'workflow-commander-v2', definition: e.definition, context: { commander_envelope: e } }, { pool, transactionClient: db });
    const c = { phase: 'prepared', envelope: e, execution_location: { ...e.execution_location }, last_seq: 0, execution_stopped: false, launch_state: 'pending',
      history: previous ? [...(previous.history ?? []), { run_id: previous.envelope.run_id, attempt: previous.envelope.attempt, verification: previous.verification, failure: previous.failure }] : [] };
    await writeControl(db, taskId, c);
    await db.query(`UPDATE tasks SET status='in_progress',claimed_by='workflow-commander-v2',claimed_at=NOW(),started_at=COALESCE(started_at,NOW()),executor_kind='openclaw-agent',
      payload=COALESCE(payload,'{}'::jsonb)||jsonb_build_object('run_id',$2::text) WHERE id=$1`, [taskId, e.run_id]);
    await event(db, taskId, 'commander_prepared', { run_id: e.run_id, input_sha256: e.input_sha256, definition: e.definition });
    return c;
  });
}
export async function launchCommander(pool, taskId, deps = {}) {
  return transaction(pool, taskId, async (db, task) => {
    const c = task.result?.workflow_control, e = c?.envelope;
    if (c?.phase !== 'prepared' || c.launch_state !== 'pending') return { waiting: true };
    validateExecutionLocation(c);
    requireCommander(Date.now() < Date.parse(e.deadline_at), '起跑预算已耗尽', 409);
    validateReady(await readyCommander(e, deps), e.definition);
    if (e.contract.resources.device_serial) {
      const gate = await (deps.lockGate ?? (t => checkDeviceLockForManualDispatch(t, 'workflow-commander-v2')))({ ...task, payload: { ...task.payload,
        device_serial: e.contract.resources.device_serial, device_ttl_minutes: Math.ceil((Date.parse(e.cleanup_deadline_at) - Date.now()) / 60000) } });
      if (!gate.pass) return { waiting: true, gate };
    }
    await (deps.setLease ?? setBrainLease)(db, taskId, Math.max(30, Math.ceil((Date.parse(e.cleanup_deadline_at) - Date.now()) / 1000)));
    // 同任务事务锁覆盖SSH，竞争tick不能同时派；远端同run幂等处理崩溃后的重放。
    c.launch_state = 'sent'; c.phase = 'running';
    try {
      const launch = buildRemoteCommand({ runId: e.run_id, department: 'work-commander', taskId,
        timeoutSec: Math.max(1, Math.floor((Date.parse(e.deadline_at) - Date.now()) / 1000)) });
      // 原executor的pid检查不是原子操作；v2用不可复用的运行目录抢一次起跑权。
      const command = `mkdir -p ~/brain-runs; if mkdir ~/brain-runs/${e.run_id}.dispatch 2>/dev/null; then ${launch}; else cat >/dev/null; echo ALREADY; fi`;
      const raw = await (deps.sshDispatch ?? send)([...SSH_BASE_ARGS, executionTarget(e, deps), command], commanderLaunchMessage(e));
      requireCommander(/DISPATCHED|ALREADY/.test(raw), '起跑回执未知', 409);
    } catch (err) {
      c.phase = 'blocked'; c.resume_condition = 'official_child_wait_or_delivery'; c.failure = { reason: 'launch_unknown', message: err.message };
    }
    await writeControl(db, taskId, c);
    await event(db, taskId, 'commander_launch', { run_id: e.run_id, phase: c.phase });
    return { dispatched: c.phase === 'running', waiting: c.phase === 'blocked' };
  });
}
export async function dispatchCommanderV2(pool, taskId, deps = {}) {
  await prepareCommander(pool, taskId, deps);
  return launchCommander(pool, taskId, deps);
}
