/** 内部鉴权之后：身份、顺序、内容摘要与所有事实在同一事务落库。 */
import { bounded, digest, object, requireCommander, validateDelivery, PROTOCOL } from './commander-v2-contract.js';
import { transaction, writeControl, event, checkFence, duplicateEvent } from './commander-v2-store.js';
import { normalizeSpan, writeSpans } from './span-ingestion.js';
import { normalizeSpanProvenance, validateSpanBinding } from './span-provenance.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
import { validateExecutionEvidence } from './commander-v2-implementation.js';
const TYPES = new Set(['started', 'heartbeat', 'activity_started', 'activity_completed', 'delivery', 'blocked']);
function validateActivitySemantics(d, completed) {
  const fields = [];
  if (!['pass', 'fail', 'skipped', 'unknown'].includes(d.outcome ?? 'unknown')) fields.push('outcome');
  const validTime = value => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
  if (!validTime(d.started_at)) fields.push('started_at');
  if ((completed && !validTime(d.ended_at)) || (d.ended_at != null && !validTime(d.ended_at))
      || (validTime(d.started_at) && validTime(d.ended_at) && Date.parse(d.ended_at) < Date.parse(d.started_at))) fields.push('ended_at');
  if ((d.evidence != null && !object(d.evidence)) || (d.outcome === 'skipped'
      && (typeof d.evidence?.skip_reason !== 'string' || !d.evidence.skip_reason.trim()))) fields.push('evidence');
  if (fields.length) throw Object.assign(Error('活动语义格式无效'), { code: 'COMMANDER_ACTIVITY_SEMANTICS_INVALID', fields });
}
async function activityFact(db, c, input) {
  const e = c.envelope, d = input.data;
  requireCommander(object(d), '活动data必须为对象');
  const context = await getRunDefinitionBinding(db, e.run_id);
  const path = e.definition.expected_path.find(p => p.reference_id === d.reference_id && (p.step_id ?? null) === (d.step_id ?? null));
  requireCommander(path && (!d.activity_id || path.activity_id === d.activity_id), '活动不属于冻结路径');
  const activity = context.activities.find(a => a.id === path.activity_definition_version_id && a.activity_id === path.activity_id);
  requireCommander(activity, '冻结活动定义缺失');
  const shell = activity.payload.contract?.by === 'shell';
  const evidence = { ...(d.evidence ?? {}), runtime_snapshot_sha256: e.definition.runtime_snapshot_sha256 };
  const execution = validateExecutionEvidence(e, path, evidence);
  const raw = { run_id: e.run_id, workflow_id: e.definition.workflow_id,
    activity_id: path.activity_id, step_id: path.step_id, started_at: d.started_at,
    ended_at: input.type === 'activity_completed' ? d.ended_at : null,
    executor_kind: shell ? 'code' : 'agent', executor_id: shell ? 'commander-shell' : 'work-commander',
    model: execution?.executor_kind === 'code' || shell ? null : (d.model ?? 'codex'), outcome: d.outcome ?? 'unknown',
    evidence, occurrence_key: `commander:${e.attempt}:${input.seq}`, identity_protocol: 2,
    run_binding_id: context.binding.id, reference_id: path.reference_id,
    workflow_definition_version_id: e.definition.workflow_definition_version_id,
    activity_definition_version_id: path.activity_definition_version_id, attempt_key: e.definition.attempt_key };
  if (execution) Object.assign(raw, execution);
  // 所有身份先于可接收的语义拒收：原事件若声明额外身份，也必须与冻结绑定一致。
  for (const key of ['run_id', 'workflow_id', 'activity_id', 'run_binding_id', 'reference_id',
    'workflow_definition_version_id', 'activity_definition_version_id', 'attempt_key', 'identity_protocol']) {
    requireCommander(d[key] === undefined || d[key] === raw[key], `活动身份不符:${key}`, 409);
  }
  requireCommander(d.evidence?.runtime_snapshot_sha256 === undefined
    || d.evidence.runtime_snapshot_sha256 === evidence.runtime_snapshot_sha256, '活动运行摘要不符', 409);
  const provenance = normalizeSpanProvenance({ ...raw, outcome: 'unknown' });
  validateSpanBinding({ identity_protocol: 2, normalized: raw, provenance }, context);
  try { validateActivitySemantics(d, input.type === 'activity_completed'); }
  catch (err) {
    if (err.code !== 'COMMANDER_ACTIVITY_SEMANTICS_INVALID') throw err;
    return { code: 'invalid_activity_fact', seq: input.seq, event_sha256: digest(input), fields: err.fields };
  }
  // normalizeSpan/writeSpans 的身份、未知类型与数据库异常绝不当作语义拒收吞掉。
  const span = normalizeSpan(raw, 0);
  if (input.type === 'activity_completed') await writeSpans(db, [span], { transactionClient: db });
}
export async function receiveCommanderEvent(pool, taskId, input) {
  bounded(input, 210000, '反馈'); bounded(input?.data, 200000, '事件data');
  requireCommander(input.protocol === PROTOCOL && TYPES.has(input.type), '反馈协议或类别无效');
  requireCommander(Number.isSafeInteger(input.seq) && input.seq > 0 && input.seq <= 100000, 'seq越界');
  return transaction(pool, taskId, async (db, task) => {
    // 即使是同内容重放，也先fence，不能让旧owner得到推进权。
    const c = checkFence(task, input);
    if (await duplicateEvent(db, taskId, input)) {
      const rejected = c.rejected_activity_facts?.find(r => r.seq === input.seq);
      return { duplicate: true, seq: input.seq, ...(rejected ? { rejected } : {}) };
    }
    requireCommander(input.seq === (c.last_seq ?? 0) + 1, '反馈乱序', 409);
    requireCommander(!c.delivery, '终态交付后只允许原样重放', 409);
    const rejected = input.type.startsWith('activity_') ? await activityFact(db, c, input) : null;
    if (rejected) {
      c.rejected_activity_facts = [...(c.rejected_activity_facts ?? []), rejected];
      await event(db, taskId, 'rejected_activity_fact', { run_id: c.envelope.run_id, attempt: c.envelope.attempt, ...rejected });
    }
    if (input.type === 'delivery') {
      try { validateDelivery(input.data, c.envelope); c.delivery = input.data; }
      catch (err) {
        if (err.code !== 'COMMANDER_OUTPUT_CONTRACT_INVALID') throw err;
        // 身份及结构已验证：按原hash接受事件，拒绝成功声明而非卡住不可变反馈队列。
        c.delivery = { ...input.data, status: 'failed', failure: { code: 'output_contract_invalid', message: err.message,
          claimed_status: input.data.status, original_failure: input.data.failure ?? null } };
        c.success_claim_rejected = { code: 'output_contract_invalid', reason: err.message, seq: input.seq };
      }
      if (c.rejected_activity_facts?.length) {
        c.delivery = { ...c.delivery, status: 'failed', failure: { code: 'invalid_activity_fact',
          claimed_status: input.data.status, original_failure: c.delivery.failure ?? null,
          rejected_activity_facts: c.rejected_activity_facts } };
      }
      c.phase = 'awaiting_stop';
      c.resume_condition = 'official_status_execution_stopped';
    } else if (input.type === 'blocked') {
      c.phase = 'blocked'; c.resume_condition = 'official_child_wait_or_delivery'; c.failure = input.data;
    } else if (input.type === 'started') {
      c.phase = 'running'; c.session = input.data; c.resume_condition = null;
    }
    c.last_seq = input.seq; c.last_feedback_at = new Date().toISOString();
    if (['started', 'activity_started', 'activity_completed', 'delivery'].includes(input.type)) c.last_progress_at = c.last_feedback_at;
    await event(db, taskId, 'commander_feedback', { ...input, sha256: digest(input) });
    await writeControl(db, taskId, c);
    return { accepted: true, seq: input.seq, phase: c.phase, ...(rejected ? { rejected } : {}), ...(c.success_claim_rejected ? { success_claim_rejected: c.success_claim_rejected } : {}) };
  });
}
