import { deterministicScriptSql } from './code-script-policy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERIAL = /^[A-Za-z0-9_-]{1,100}$/;

/** 只能投影真实任务与绑定该任务的 routing receipt，不能相信候选 payload 的来源声明。 */
export function codeTaskIdentitySql(task, receipt) {
  if (![task, receipt].every(alias => /^[a-z_]+$/.test(alias))) throw new Error('unsafe identity alias');
  return `jsonb_build_object(
    'canonical_code', ${deterministicScriptSql(task)},
    'multi_task', ${task}.payload->'multi_task',
    'workflow_id', ${task}.payload->>'workflow_id',
    'parent_task_id', ${task}.parent_task_id::text,
    'phone_serial', ${task}.payload->>'phone_serial',
    'recurring_task_id', ${task}.payload->>'recurring_task_id',
    'recurring_slot', ${task}.payload->>'recurring_slot',
    'source', ${receipt}.source, 'source_id', ${receipt}.source_id)`;
}

function verifiedIdentity(value) {
  if (!value || value.canonical_code !== true || value.multi_task !== true
      || !UUID.test(value.workflow_id ?? '') || !value.source || !value.source_id) return null;
  const { source, source_id, workflow_id, phone_serial, parent_task_id, recurring_task_id, recurring_slot } = value;
  let occurrence;
  if (source === 'api' && UUID.test(parent_task_id ?? '') && SERIAL.test(phone_serial ?? '')
      && source_id === `phone-account-patrol:${parent_task_id}:${phone_serial}`) {
    occurrence = `parent:${parent_task_id}`;
  } else if (source === 'scheduler' && UUID.test(recurring_task_id ?? '')
      && typeof recurring_slot === 'string'
      && Number.isFinite(Date.parse(recurring_slot))
      && new Date(recurring_slot).toISOString() === recurring_slot
      && source_id === `recurring:${recurring_task_id}:${recurring_slot}`
      && (phone_serial == null || SERIAL.test(phone_serial))) {
    occurrence = `slot:${recurring_slot}`;
  } else return null;
  return { ledger: JSON.stringify([source, source_id]),
    business: JSON.stringify([workflow_id, phone_serial ?? null, occurrence]) };
}

/** unknown 保留旧标题规则；同源或同设备同父/slot 抑制重复，其余已验证身份独立排队。 */
export function compareCodeTaskIdentity(left, right) {
  const a = verifiedIdentity(left), b = verifiedIdentity(right);
  if (!a || !b) return 'unknown';
  return a.ledger === b.ledger || a.business === b.business ? 'same' : 'different';
}
