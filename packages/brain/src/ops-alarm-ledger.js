/**
 * ops-alarm-ledger — 闹钟总账（扩 ops_schedule_entries，不建新表；决策 9e9d90b6，任务 fe10d1a0）。
 *
 * 总账 = 一张表（433 的排程台账 + 517 的新列）。本模块只放三类共用逻辑：
 *  1. cadence（JOBS 里的结构化周期）→ 人话描述 / 近似秒数；
 *  2. 最近状态（正常/失败/静默/无记录）的统一推导口径；
 *  3. 两条"代码自动写入"的落表腿：Brain scheduler job、recurring_tasks 模板。
 *
 * 写入纪律（同 443 的机器列/人工列分区）：SET 子句里只有机器列，
 * owner_manual / note_manual / tree_bucket_manual / journey_id / workflow_id 永不出现——
 * 挂树列由导入脚本补、由人在 Notion 改，机器每轮覆盖会冲掉人的结论。
 */

export const INVENTORY_SOURCE = 'inventory-20261004';
export const BRAIN_LEDGER_SOURCE = 'brain';
export const BRAIN_JOB_HOST = 'us-vps';
export const RECURRING_HOST = 'local';
/** Notion「Ops 运行图谱」推送要排除的行：总账自有行，不是运行图谱里的"运行单元"。 */
export const NOTION_EXCLUDED_REGISTERED_VIA = ['brain-job', 'brain-loop', 'recurring'];

const DAY = 86400;

/** cron 五段 → 近似触发间隔（秒）。算不准返回 null，禁假精确。 */
export function cronApproxIntervalSec(expr) {
  const f = String(expr ?? '').trim().split(/\s+/);
  if (f.length < 5) return null;
  const [min, hour, dom, , dow] = f;
  if (dom !== '*') return 30 * DAY;
  if (dow !== '*') return 7 * DAY;
  if (hour === '*') {
    const m = /^\*\/(\d+)$/.exec(min);
    return m ? Number(m[1]) * 60 : 3600;
  }
  const h = /^\*\/(\d+)$/.exec(hour);
  return h ? Number(h[1]) * 3600 : DAY;
}

export function cadenceIntervalSec(cadence) {
  if (!cadence) return null;
  if (Number.isFinite(cadence.everySec) && cadence.everySec > 0) return Math.round(cadence.everySec);
  if (cadence.cron) return cronApproxIntervalSec(cadence.cron);
  return null;
}

function formatEverySec(n) {
  if (n % DAY === 0) return `每 ${n / DAY} 天`;
  if (n % 3600 === 0) return `每 ${n / 3600} 小时`;
  if (n % 60 === 0) return `每 ${n / 60} 分钟`;
  return `每 ${n} 秒`;
}

export function cadenceDesc(cadence) {
  if (!cadence) return '';
  if (Number.isFinite(cadence.everySec) && cadence.everySec > 0) return formatEverySec(Math.round(cadence.everySec));
  if (cadence.cron) return `cron(${cadence.tz || 'UTC'}): ${cadence.cron}`;
  return '';
}

/**
 * 最近状态统一口径：
 *  失败=最近一次明确报错；静默=该响没响（活性 warn/dead）；无记录=没有任何运行证据；其余=正常。
 * @param {{ hasRecord:boolean, ok?:boolean|null, liveness?:string|null }} p
 */
export function deriveLastStatus({ hasRecord, ok = null, liveness = null }) {
  if (!hasRecord) return '无记录';
  if (ok === false) return '失败';
  if (liveness === 'warn' || liveness === 'dead') return '静默';
  return '正常';
}

/** 采集腿只有 last_state / last_exit_code：映射到同一口径。 */
export function statusFromCollectorState(lastState, lastExitCode) {
  const s = String(lastState ?? '').toLowerCase();
  if (!s || s === 'disabled') return '无记录';
  if (s === 'ok' || s === 'running' || s === 'success' || s === 'created') return '正常';
  if (s === 'error' || s === 'failed' || s === 'fail' || s === 'timeout') return '失败';
  if (/^exit\s+(?!0\b)/.test(s)) return '失败';
  if (Number.isFinite(lastExitCode) && lastExitCode !== 0) return '失败';
  return '无记录';
}

/**
 * Brain scheduler job → 总账一行（由 ops-scheduler-liveness 每轮调用）。
 * 降噪：与 ops_workflows 同款条件——否则 72 行每分钟都"变更"。无变化时不写（返回 false）。
 */
export async function upsertBrainJobLedger(pool, { job, lastRunAt, rec, lv, collectedAt }) {
  const hasRecord = Boolean(rec) || Boolean(lastRunAt);
  const lastStatus = deriveLastStatus({ hasRecord, ok: rec ? Boolean(rec.ok) : null, liveness: lv.liveness });
  const lastSuccessAt = rec?.ok ? lastRunAt : null;
  const { rowCount } = await pool.query(
    `INSERT INTO ops_schedule_entries
       (source, host_alias, label, kind, schedule_desc, interval_sec, enabled,
        last_run_at, last_success_at, last_status, liveness, silent_sec,
        registered_via, ledger_status, ops_workflow_id, active, updated_at)
     VALUES ('${BRAIN_LEDGER_SOURCE}', '${BRAIN_JOB_HOST}', $1, 'brain_job', $2, $3, TRUE,
        $4, $5, $6, $7, $8,
        'brain-job', 'registered',
        (SELECT id FROM ops_workflows WHERE source='scheduler' AND wf_id=$1), TRUE, $9)
     ON CONFLICT (source, host_alias, label) DO UPDATE SET
       kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc, interval_sec=EXCLUDED.interval_sec,
       enabled=TRUE, last_run_at=EXCLUDED.last_run_at,
       last_success_at=COALESCE(EXCLUDED.last_success_at, ops_schedule_entries.last_success_at),
       last_status=EXCLUDED.last_status, liveness=EXCLUDED.liveness, silent_sec=EXCLUDED.silent_sec,
       registered_via=EXCLUDED.registered_via, ledger_status=EXCLUDED.ledger_status,
       ops_workflow_id=COALESCE(EXCLUDED.ops_workflow_id, ops_schedule_entries.ops_workflow_id),
       active=TRUE, updated_at=EXCLUDED.updated_at
     WHERE ops_schedule_entries.liveness IS DISTINCT FROM EXCLUDED.liveness
        OR ops_schedule_entries.last_status IS DISTINCT FROM EXCLUDED.last_status
        OR ops_schedule_entries.schedule_desc IS DISTINCT FROM EXCLUDED.schedule_desc
        OR ops_schedule_entries.interval_sec IS DISTINCT FROM EXCLUDED.interval_sec
        OR ops_schedule_entries.active = FALSE
        OR ops_schedule_entries.registered_via IS DISTINCT FROM EXCLUDED.registered_via
        OR (ops_schedule_entries.last_run_at IS NULL AND EXCLUDED.last_run_at IS NOT NULL)
        OR EXCLUDED.last_run_at - ops_schedule_entries.last_run_at >= interval '10 minutes'
        OR EXCLUDED.silent_sec - COALESCE(ops_schedule_entries.silent_sec, 0) >= 600`,
    [job.name, cadenceDesc(job.cadence), cadenceIntervalSec(job.cadence), lastRunAt, lastSuccessAt,
      lastStatus, lv.liveness, lv.silent_sec, collectedAt],
  );
  return (rowCount ?? 0) > 0;
}

/** 下线的 job（不在本轮 JOBS 里）：置 inactive，保留行与历史。 */
export async function deactivateRetiredBrainJobs(pool, jobNames, collectedAt) {
  await pool.query(
    `UPDATE ops_schedule_entries SET active=FALSE, updated_at=$2
     WHERE source='${BRAIN_LEDGER_SOURCE}' AND host_alias='${BRAIN_JOB_HOST}'
       AND registered_via='brain-job' AND active=TRUE AND label <> ALL($1::text[])`,
    [jobNames, collectedAt],
  );
}

const RECURRING_STATUS = {
  created: '正常',
  error: '失败',
  missed: '静默',
  skipped_overlap: '静默',
};

/**
 * recurring_tasks 模板 → 总账（取代 agent-ops.js 里 API 层的临时 UNION 拼接）。
 * 只投影 is_active 的模板；模板停用/删除 → 总账行置 inactive。
 */
export async function syncRecurringLedger(pool, now = new Date()) {
  const { rows } = await pool.query(
    `SELECT id, title, cron_expression, last_run_at, next_run_at, last_run_status
       FROM recurring_tasks WHERE is_active = TRUE ORDER BY created_at ASC`,
  );
  const collectedAt = now.toISOString();
  const seen = new Set();
  const labels = [];
  for (const r of rows) {
    let label = String(r.title);
    if (seen.has(label)) label = `${label} #${String(r.id).slice(0, 8)}`; // 同名模板：加 id 前缀防互相覆盖
    seen.add(label);
    labels.push(label);
    const lastStatus = r.last_run_at ? (RECURRING_STATUS[r.last_run_status] ?? '正常') : '无记录';
    await pool.query(
      `INSERT INTO ops_schedule_entries
         (source, host_alias, label, kind, schedule_desc, next_run_utc, last_state, interval_sec, enabled,
          last_run_at, last_success_at, last_status, registered_via, ledger_status, active, updated_at)
       VALUES ('${BRAIN_LEDGER_SOURCE}', '${RECURRING_HOST}', $1, 'brain_recurring', $2, $3, $4, $5, TRUE,
          $6, $7, $8, 'recurring', 'registered', TRUE, $9)
       ON CONFLICT (source, host_alias, label) DO UPDATE SET
         kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc, next_run_utc=EXCLUDED.next_run_utc,
         last_state=EXCLUDED.last_state, interval_sec=EXCLUDED.interval_sec, enabled=TRUE,
         last_run_at=EXCLUDED.last_run_at,
         last_success_at=COALESCE(EXCLUDED.last_success_at, ops_schedule_entries.last_success_at),
         last_status=EXCLUDED.last_status, registered_via=EXCLUDED.registered_via,
         ledger_status=EXCLUDED.ledger_status, active=TRUE, updated_at=EXCLUDED.updated_at
       WHERE ops_schedule_entries.schedule_desc IS DISTINCT FROM EXCLUDED.schedule_desc
          OR ops_schedule_entries.next_run_utc IS DISTINCT FROM EXCLUDED.next_run_utc
          OR ops_schedule_entries.last_state IS DISTINCT FROM EXCLUDED.last_state
          OR ops_schedule_entries.last_run_at IS DISTINCT FROM EXCLUDED.last_run_at
          OR ops_schedule_entries.last_status IS DISTINCT FROM EXCLUDED.last_status
          OR ops_schedule_entries.active = FALSE
          OR ops_schedule_entries.registered_via IS DISTINCT FROM EXCLUDED.registered_via`,
      [label, r.cron_expression || '', r.next_run_at ?? null, r.last_run_status ?? null,
        cronApproxIntervalSec(r.cron_expression), r.last_run_at ?? null,
        r.last_run_status === 'created' ? r.last_run_at : null, lastStatus, collectedAt],
    );
  }
  await pool.query(
    `UPDATE ops_schedule_entries SET active=FALSE, updated_at=$2
     WHERE source='${BRAIN_LEDGER_SOURCE}' AND host_alias='${RECURRING_HOST}'
       AND registered_via='recurring' AND active=TRUE AND label <> ALL($1::text[])`,
    [labels, collectedAt],
  );
  return { templates: rows.length };
}
