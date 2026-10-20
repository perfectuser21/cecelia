/** Commander 独立核验的受限运输合同；不改变普通research或qiumi任务。 */
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { commanderRuntimeHelpers, validateExecutionLocation } from './commander-runtime-location.js';
export const VERIFICATION_TRANSPORT = 'openclaw-agent-v1';
export const VERIFICATION_MODEL = 'openai/gpt-6.1-sol';
export const isCommanderVerification = task => task?.task_type === 'research' && task.payload?.verification_transport === VERIFICATION_TRANSPORT;
export function verificationTaskSql(alias = '') {
  if (!['', 't'].includes(alias)) throw Error('invalid task alias');
  const p = alias ? `${alias}.` : '';
  return `(${p}task_type='research' AND ${p}payload->>'verification_transport'='${VERIFICATION_TRANSPORT}')`;
}
export function verificationMetadata(fixed, now = Date.now()) {
  return { workflow_verification_of: fixed.task_id, workflow_verification: fixed, skill: 'run-verify',
    verification_transport: VERIFICATION_TRANSPORT, verification_agent: 'skill-factory', model: VERIFICATION_MODEL,
    run_id: `wfv-${randomUUID()}`, verification_deadline_at: new Date(now + 900000).toISOString() };
}
function requireVerification(ok, reason) { if (!ok) throw Error(`commander_verification_rejected: ${reason}`); }
export async function verificationLaunch(pool, task, now = Date.now()) {
  const p = task.payload, fixed = p?.workflow_verification;
  requireVerification(isCommanderVerification(task) && p.verification_agent === 'skill-factory' && p.model === VERIFICATION_MODEL
    && /^wfv-[0-9a-f-]{36}$/.test(p.run_id) && p.run_id !== fixed?.run_id && p.workflow_verification_of === fixed?.task_id, '运输身份');
  const remaining = Math.floor((Date.parse(p.verification_deadline_at) - now) / 1000);
  requireVerification(Number.isFinite(remaining) && remaining >= 60 && remaining <= 900, '核验预算已耗尽或越界');
  const parent = (await pool.query('SELECT * FROM tasks WHERE id=$1', [p.workflow_verification_of])).rows[0];
  const c = parent?.result?.workflow_control, e = c?.envelope;
  requireVerification(parent?.status === 'in_progress' && c?.verify_task_id === task.id && task.id !== parent.id, '父控制器未绑定该独立核验任务');
  requireVerification(fixed.task_id === parent.id && fixed.run_id === e.run_id && fixed.attempt === e.attempt
    && fixed.definition_sha256 === e.definition.snapshot_sha256 && fixed.input_sha256 === e.input_sha256, '固定主run身份不符');
  for (const key of ['input', 'definition', 'contract']) requireVerification(isDeepStrictEqual(fixed[key], e[key]), `固定${key}不符`);
  for (const key of ['outputs', 'evidence', 'cleanup', 'effects']) requireVerification(isDeepStrictEqual(fixed[key], c.delivery?.[key]), `固定${key}不符`);
  requireVerification(isDeepStrictEqual(fixed.execution_location, c.execution_location) && fixed.execution_status === c.delivery?.status, '固定执行身份不符');
  validateExecutionLocation(c);
  if (e.execution_location) requireVerification(isDeepStrictEqual(fixed.runtime_helpers, commanderRuntimeHelpers(e)), '固定runtime helpers不符');
  return { runId: p.run_id, department: 'skill-factory', model: VERIFICATION_MODEL, timeoutSec: remaining };
}
export function verificationPrompt(task) {
  return `你是独立run-verify核验员。verification_task_id=${task.id}；verification_transport_run_id=${task.payload.run_id}。这两个值只标识核验运输，绝不能填入最终结果的task_id/run_id；最终结果必须原样使用下方业务身份JSON模板。
只读核验，不执行业务、不发布、不操作手机、不修复或写入产物；禁止sessions_spawn/sessions_send；禁止subagents全部动作（包括wait/list），即使只读查询也不得调用，不委托任何子会话。
模型沙箱与执行机不保证同机，必须按固定execution_location访问原始产物：执行机为MMV时优先gateway_exec（command/title/timeoutSeconds），先只读核对hostname及文件hash；其他宿主使用官方node_exec/file_fetch或只读SSH。不能因CLI入口在MMV就把模型bash沙箱当MMV。
若需确认原业务child已停止，通过gateway_exec在已确认的Gateway宿主运行官方只读RPC：openclaw gateway call agent.wait --params '{"runId":"<已独立核对的child_run_id>","timeoutMs":1000}' --json --timeout 5000。child_run_id只能来自与固定业务task_id/run_id/attempt一致的原始agent-binding.json及spawn回执；不得使用核验运输run或猜测ID。返回runId必须一致、endedAt非空且为明确终态；pending/timeout、缺失、错run或RPC失败均是INCONCLUSIVE，不能造cleanup成功。此RPC仅查终态，不读取执行会话内容。禁止运行wf-status、wf-launch或handoff wait/stop等会写运行状态的包装器。
${task.description}`;
}
export function verificationRuntime(tail, logicalRunId) {
  requireVerification(typeof tail === 'string' && Buffer.byteLength(tail) <= 200000, 'CLI回执缺失或超限');
  let official;
  // 从首个候选起解析，保留漂亮打印大回执的顶层；内层对象数量不决定是否接受。
  const starts = [0, ...[...tail.matchAll(/^[ \t]*\{/gm)].map(m => m.index)].slice(0, 100);
  for (const start of starts) {
    try { const parsed = JSON.parse(tail.slice(start).trim()); if (parsed.result?.meta?.agentMeta) { official = parsed; break; } } catch { /* 只认完整官方CLI对象。 */ }
  }
  const meta = official?.result?.meta, agent = meta?.agentMeta, terminal = agent?.terminalReceipt, trace = meta?.executionTrace;
  const modelMatches = v => v?.provider === 'openai' && v?.model === 'gpt-6.1-sol';
  requireVerification(official?.status === 'ok' && typeof official.runId === 'string' && terminal?.runId === official.runId
    && modelMatches(agent) && modelMatches(terminal.requested) && modelMatches(terminal.effective)
    && terminal.rerouted === false && meta.aborted !== true, '官方实际provider/model或无改派证据不符');
  if (trace) requireVerification(trace.winnerProvider === 'openai' && trace.winnerModel === 'gpt-6.1-sol'
    && trace.fallbackUsed !== true && (trace.attempts ?? []).every(modelMatches), '模型fallback不允许');
  requireVerification(!(terminal.successfulToolNames ?? []).some(name => ['sessions_spawn', 'sessions_send', 'subagents'].includes(name)), '核验不能委托子会话');
  return { provider: agent.provider, model: agent.model, logical_run_id: logicalRunId, official_run_id: official.runId, rerouted: false };
}
export function verifiedRuntime(task) {
  const runtime = task.result?.receipt?.verification_runtime;
  return runtime?.provider === 'openai' && runtime.model === 'gpt-6.1-sol' && runtime.rerouted === false
    && runtime.logical_run_id === task.payload?.run_id && typeof runtime.official_run_id === 'string';
}

/** marker专用严格起跑账：共用startRun，但不接受其历史fail-open返回值。 */
export async function prepareVerificationRun(pool, task, params, deps = {}) {
  const { startRun } = await import('./task-run.js');
  const { setBrainLease, BRAIN_LEASE_MARGIN_SECONDS } = await import('./task-lease.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,716))', [task.id]);
    const current = (await db.query('SELECT status,payload FROM tasks WHERE id=$1 FOR UPDATE', [task.id])).rows[0];
    requireVerification(['queued', 'in_progress'].includes(current?.status) && current.payload?.run_id === task.payload.run_id
      && current.payload?.verification_transport === VERIFICATION_TRANSPORT, '核验任务已结束或运输身份已变化');
    params.timeoutSec = Math.floor((Date.parse(current.payload.verification_deadline_at) - Date.now()) / 1000);
    requireVerification(params.timeoutSec >= 60 && params.timeoutSec <= 900, '核验预算已耗尽或越界');
    const run = await (deps.startRun ?? startRun)({ taskId: task.id, runId: task.payload.run_id, source: 'openclaw-agent',
      context: { department: params.department, model: params.model, verification_transport: VERIFICATION_TRANSPORT } }, { pool: db });
    requireVerification(run?.id, '独立run未成功入账');
    const saved = (await db.query('SELECT task_id,status,ended_at FROM task_runs WHERE run_id=$1', [task.payload.run_id])).rows[0];
    requireVerification(saved?.task_id === task.id && saved.status === 'running' && saved.ended_at === null, '独立run身份或状态不符');
    const lease = await (deps.setLease ?? setBrainLease)(db, task.id, params.timeoutSec + BRAIN_LEASE_MARGIN_SECONDS);
    requireVerification(Date.parse(lease?.lease_until) > Date.now(), '核验租约未成功入账');
    await db.query("UPDATE tasks SET executor_kind='openclaw-agent',updated_at=NOW() WHERE id=$1", [task.id]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
