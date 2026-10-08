import { checkAnchor } from '../anchor-check.js';
import { parseExecParams } from '../routing/exec-params.js';
import { qiumiEnv } from '../routing/env.js';
import { dispatchManualQiumi } from './manual-qiumi-dispatch.js';

export const PHONE_RPA_CANDIDATES_SQL = `SELECT * FROM tasks
 WHERE task_type = 'qiumi_task' AND status = 'queued' AND claimed_by IS NULL
 AND payload->>'source' = 'notion_gtd'
 AND COALESCE(payload->>'headed_manual', 'false') <> 'true'
 AND NOT COALESCE(notion_props, '{}'::jsonb) ? 'qiumi_human_hold'
 AND created_at >= $1::timestamptz
 AND (next_run_at IS NULL OR next_run_at <= NOW())
 ORDER BY created_at ASC LIMIT 100`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let running = false;
let lastRunAt = 0;
export function resetPhoneRpaDispatchForTest() { running = false; lastRunAt = 0; }

async function readPolicy(pool, now) {
  const { rows } = await pool.query("SELECT value_json FROM working_memory WHERE key = 'phone_rpa_dispatch'");
  const c = rows[0]?.value_json;
  if (!c || c.enabled !== true) return { error: 'disabled' };
  if (typeof c.since !== 'string' || !Number.isFinite(Date.parse(c.since)) || Date.parse(c.since) > now
    || !Array.isArray(c.devices) || !c.devices.length || c.devices.some(d => typeof d !== 'string' || !d.trim())) {
    return { error: 'invalid_policy' };
  }
  const phones = (await pool.query('SELECT serial, nickname, enabled FROM phone_registry WHERE enabled = true')).rows;
  if (c.devices.some(d => phones.filter(p => p.nickname === d && p.serial).length !== 1)) return { error: 'unknown_or_ambiguous_device' };
  return { ...c, phones, policyValue: c };
}
function eligible(task, policy, env, now, claimed = false) {
  if (policy.error || task.task_type !== 'qiumi_task' || task.status !== 'queued'
    || !claimed && task.claimed_by || task.payload?.source !== 'notion_gtd'
    || task.payload?.headed_manual === true || Object.hasOwn(task.notion_props ?? {}, 'qiumi_human_hold')
    || task.lane && task.lane !== 'AI' || task.payload?.lane && task.payload.lane !== 'AI'
    || !UUID.test(task.payload?.notion_zh_page_id ?? task.payload?.notion_page_id ?? '')
    || !Number.isFinite(Date.parse(task.created_at)) || Date.parse(task.created_at) < Date.parse(policy.since)
    || task.next_run_at && Date.parse(task.next_run_at) > now) return false;
  const params = parseExecParams(task.payload?.qiumi_source?.body, env);
  return params.present && !params.errors.length && params.agent === 'skill-factory'
    && policy.devices.includes(params.device);
}

/** 独立授权手机队列；不打开 Tick、不接受开发 Agent、不补跑启用前任务。 */
export async function runPhoneRpaDispatch(pool, deps = {}) {
  const now = deps.now ?? Date.now;
  const t = now();
  if (running || t - lastRunAt < 30_000) return { skipped: 'interval_or_running', dispatched: 0 };
  running = true;
  lastRunAt = t;
  try {
    const env = deps.env ?? qiumiEnv();
    const policy = await readPolicy(pool, t);
    if (policy.error || env.deviceDelegationEnabled) return { skipped: policy.error ?? 'device_delegation_enabled', dispatched: 0 };
    const { rows } = await pool.query(PHONE_RPA_CANDIDATES_SQL, [policy.since]);
    const dispatch = deps.dispatch ?? dispatchManualQiumi;
    let dispatched = 0;
    for (const task of rows) {
      if (!eligible(task, policy, env, t) || (deps.anchor ?? checkAnchor)(task).blocked) continue;
      const currentPolicy = await readPolicy(pool, now());
      if (!eligible(task, currentPolicy, env, now())) continue;
      const startGuard = { beforeStart: async current => {
        const live = await readPolicy(pool, now());
        startGuard.policySnapshot = live.error ? null : { key: 'phone_rpa_dispatch', value: live.policyValue };
        const hint = current.payload?.qiumi_route?.device_hint;
        const matching = live.phones?.find(p => p.serial === hint?.serial);
        const requested = parseExecParams(current.payload?.qiumi_source?.body, env).device;
        return eligible(current, live, env, now(), true)
          && current.payload?.qiumi_department === 'skill-factory'
          && matching && live.devices.includes(matching.nickname)
          && requested === matching.nickname && hint.nickname === matching.nickname;
      } };
      const result = await dispatch(task, pool, startGuard);
      if (result.status === 202) dispatched++;
      if (dispatched >= 2) break;
    }
    return { dispatched };
  } finally { running = false; }
}
