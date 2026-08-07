/**
 * acceptance-aging.js — 验收超时哨兵（F3 夜间体检项，主理人条件一）
 * 人验收是承诺，承诺必须有检查：人这步没法机器验证，但可以机器追踪。
 * 1. 超 48h 未验收（pending/in_review）→ P1 + Bark 直响验收人（=主理人，决策 18174291）
 * 2. A10②：其中 pending 的那批同时转 expired（非活跃终态，不再占验收队列）
 * 3. 驳回补偿扫描：failed 但没有对应驳回任务的 run → 一并告警（防转变沿开任务失败后静默）
 */
import { sendBark } from './notifier.js';

const OVERDUE_HOURS = 48;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 小时自 gate
const INTERVAL_MS = parseInt(process.env.CECELIA_ACCEPTANCE_AGING_INTERVAL_MS || String(DEFAULT_INTERVAL_MS), 10);

/**
 * orphan 扫描只覆盖 migration 392 之前落库的历史 failed run —— 7 值状态机上线后
 * 新 run 永不落 failed，这段扫描对新数据恒返回空集。它不是一条活的防线：
 * 「格判红 → 分流建任务」的口径由 D4 的聚合式分流接管，届时整段删除。
 * 常量在这里显式导出并被回归测试断言，防止它被当成还在工作的防护而无人察觉。
 */
export const ORPHAN_SCAN_LEGACY_STATUSES = ['failed'];

let lastRunAt = 0;

export function _resetGateForTest() {
  lastRunAt = 0;
}

export async function runAcceptanceAging(pool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) {
    return { skipped: true, overdue_runs: 0, orphan_failed: 0, expired_runs: 0 };
  }
  lastRunAt = now;

  try {
    // 1. 超 48h 未验收
    const { rows: overdue } = await pool.query(
      `SELECT run_key, title, created_at FROM acceptance_runs
       WHERE status IN ('pending','in_review')
         AND created_at < now() - interval '${OVERDUE_HOURS} hours'
       ORDER BY created_at`
    );

    // A10② pending 超 48h → expired。只转 pending：in_review 说明有人正在填，
    // 转态会把已填的工作打进非活跃终态。Bark 告警对两者都保留。
    // 必须排在上面那条 SELECT 之后：先转态会让这批 run 掉出 overdue 取数口径。
    const { rows: expired } = await pool.query(
      `UPDATE acceptance_runs SET status = 'expired', updated_at = now()
        WHERE status = 'pending'
          AND created_at < now() - interval '${OVERDUE_HOURS} hours'
        RETURNING run_key`
    );

    // 2. 驳回补偿扫描（历史 failed run 专用，见 ORPHAN_SCAN_LEGACY_STATUSES 注释）
    const { rows: orphanFailed } = await pool.query(
      `SELECT r.run_key, r.title FROM acceptance_runs r
       WHERE r.status = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
           WHERE t.payload->>'acceptance_run_key' = r.run_key
             AND t.status NOT IN ('completed','failed','cancelled')
         )
         AND r.updated_at > now() - interval '7 days'`,
      [ORPHAN_SCAN_LEGACY_STATUSES]
    );

    if (overdue.length > 0 || orphanFailed.length > 0) {
      const lines = [];
      if (overdue.length > 0) {
        lines.push(`${overdue.length} 单超 ${OVERDUE_HOURS}h 未验收：${overdue.slice(0, 3).map((r) => r.title).join('；')}`);
      }
      if (expired.length > 0) {
        lines.push(`${expired.length} 单超 ${OVERDUE_HOURS}h 未开始验收，已转 expired`);
      }
      if (orphanFailed.length > 0) {
        lines.push(`${orphanFailed.length} 单驳回但无修复任务：${orphanFailed.slice(0, 3).map((r) => r.title).join('；')}`);
      }
      const body = lines.join('\n');
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3::jsonb)`,
        ['acceptance_aging_alert', 'acceptance-aging', JSON.stringify({
          severity: 'P1',
          overdue_runs: overdue.map((r) => r.run_key),
          orphan_failed: orphanFailed.map((r) => r.run_key),
          expired: expired.map((r) => r.run_key),
        })]
      );
      await sendBark('【验收红灯】人验收环节滞留', body, {
        dedupeKey: `acceptance-aging:${overdue.length}:${orphanFailed.length}`,
        dedupeTtlSec: 6 * 3600,
      });
    }

    return {
      skipped: false,
      overdue_runs: overdue.length,
      orphan_failed: orphanFailed.length,
      expired_runs: expired.length,
    };
  } catch (err) {
    console.error('[acceptance-aging] 哨兵异常（不拖垮 tick）:', err.message);
    return { skipped: false, overdue_runs: 0, orphan_failed: 0, expired_runs: 0, error: err.message };
  }
}
