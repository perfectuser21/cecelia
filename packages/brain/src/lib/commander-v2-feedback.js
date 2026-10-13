/** 内部鉴权之后：身份、顺序、内容摘要与所有事实在同一事务落库。 */
import { bounded, digest, requireCommander, validateDelivery, PROTOCOL } from './commander-v2-contract.js';
import { transaction, writeControl, event, checkFence, duplicateEvent } from './commander-v2-store.js';
import { normalizeSpan, writeSpans } from './span-ingestion.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
const TYPES = new Set(['started', 'heartbeat', 'activity_started', 'activity_completed', 'delivery', 'blocked']);
async function activityFact(db, c, input) {
  const e = c.envelope, d = input.data;
  const context = await getRunDefinitionBinding(db, e.run_id);
  const path = e.definition.expected_path.find(p => p.reference_id === d.reference_id && (p.step_id ?? null) === (d.step_id ?? null));
  requireCommander(path && (!d.activity_id || path.activity_id === d.activity_id), '活动不属于冻结路径');
  const evidence = { ...(d.evidence ?? {}), runtime_snapshot_sha256: e.definition.runtime_snapshot_sha256 };
  const span = normalizeSpan({ run_id: e.run_id, workflow_id: e.definition.workflow_id,
    activity_id: path.activity_id, step_id: path.step_id, started_at: d.started_at,
    ended_at: input.type === 'activity_completed' ? d.ended_at : null,
    executor_kind: 'agent', executor_id: 'work-commander', model: d.model ?? 'codex', outcome: d.outcome ?? 'unknown',
    evidence, occurrence_key: `commander:${e.attempt}:${input.seq}`, identity_protocol: 2,
    run_binding_id: context.binding.id, reference_id: path.reference_id,
    workflow_definition_version_id: e.definition.workflow_definition_version_id,
    activity_definition_version_id: path.activity_definition_version_id, attempt_key: e.definition.attempt_key }, 0);
  await writeSpans(db, [span], { transactionClient: db });
}
export async function receiveCommanderEvent(pool, taskId, input) {
  bounded(input, 210000, '反馈'); bounded(input?.data, 200000, '事件data');
  requireCommander(input.protocol === PROTOCOL && TYPES.has(input.type), '反馈协议或类别无效');
  requireCommander(Number.isSafeInteger(input.seq) && input.seq > 0 && input.seq <= 100000, 'seq越界');
  return transaction(pool, taskId, async (db, task) => {
    // 即使是同内容重放，也先fence，不能让旧owner得到推进权。
    const c = checkFence(task, input);
    if (await duplicateEvent(db, taskId, input)) return { duplicate: true, seq: input.seq };
    requireCommander(input.seq === (c.last_seq ?? 0) + 1, '反馈乱序', 409);
    requireCommander(!c.delivery, '终态交付后只允许原样重放', 409);
    if (input.type.startsWith('activity_')) await activityFact(db, c, input);
    if (input.type === 'delivery') {
      validateDelivery(input.data, c.envelope);
      c.delivery = input.data; c.phase = 'awaiting_stop';
      c.resume_condition = 'official_status_execution_stopped';
    } else if (input.type === 'blocked') {
      c.phase = 'blocked'; c.resume_condition = 'official_child_wait_or_delivery'; c.failure = input.data;
    } else if (input.type === 'started') {
      c.phase = 'running'; c.session = input.data; c.resume_condition = null;
    }
    c.last_seq = input.seq; c.last_feedback_at = new Date().toISOString();
    await event(db, taskId, 'commander_feedback', { ...input, sha256: digest(input) });
    await writeControl(db, taskId, c);
    return { accepted: true, seq: input.seq, phase: c.phase };
  });
}
