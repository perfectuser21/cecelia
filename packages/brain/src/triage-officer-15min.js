/**
 * triage-officer-15min.js — 排序官 15min 规则小轮（纯 SQL 精确撞格归并）
 *
 * 每 15min 执行两条规则，无 LLM，全路径 fail-open：
 *   规则1 重名归并：同 status='queued' + 同 title + 同 task_type → 保最老，cancel 后来者
 *   规则2 否决窗放行：triage_officer_leaderboard.veto_deadline < NOW() 且 !vetoed
 *          → 榜单任务写 metadata.triage_approved=true，记 auto_approved_at
 *
 * gate：进程级变量 lastRunAt（照 gp-shelf-life.js 先例）
 */

const INTERVAL_MS = parseInt(
  process.env.TRIAGE_OFFICER_15MIN_INTERVAL_MS || String(15 * 60 * 1000),
  10,
);
let lastRunAt = 0;

export function __resetTriageOfficer15minForTest() { lastRunAt = 0; }

export const LEADERBOARD_KEY = 'triage_officer_leaderboard';

export async function runTriageOfficer15min(pool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, merged: 0, autoApproved: 0 };
  lastRunAt = now;

  let merged = 0;
  let autoApproved = 0;

  // 规则1: 精确重名归并——保最老 queued_at，cancel 后来者
  try {
    const { rows } = await pool.query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY title, task_type
                  ORDER BY queued_at ASC
                ) AS rn
         FROM tasks
         WHERE status = 'queued'
           AND task_type IN ('dev', 'harness_initiative')
           AND claimed_by IS NULL
       )
       UPDATE tasks
          SET status        = 'cancelled',
              error_message = '[triage-15min] 重名任务归并：保最老，取消后来者',
              updated_at    = NOW()
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
       RETURNING id, title`,
    );
    merged = rows.length;
    if (merged > 0) {
      console.log(`[triage-15min] 归并 ${merged} 条重名: ${rows.map((r) => r.title.slice(0, 40)).join(' | ')}`);
    }
  } catch (e) {
    console.warn('[triage-15min] 规则1 归并失败（fail-open）:', e.message);
  }

  // 规则2: 否决窗过期 → 自动放行（triage_approved）
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
      [LEADERBOARD_KEY],
    );
    if (rows.length) {
      const record = rows[0].value_json ?? {};
      const vetoDl = record.veto_deadline ? new Date(record.veto_deadline) : null;
      const alreadyDone = record.auto_approved_at != null;
      if (vetoDl && !record.vetoed && !alreadyDone && vetoDl < new Date()) {
        const taskIds = (record.leaderboard ?? []).map((item) => item.id).filter(Boolean);
        if (taskIds.length) {
          const { rows: updated } = await pool.query(
            `UPDATE tasks
                SET metadata   = COALESCE(metadata, '{}'::jsonb) || '{"triage_approved":true}'::jsonb,
                    updated_at = NOW()
              WHERE id = ANY($1::uuid[])
                AND status = 'queued'
             RETURNING id`,
            [taskIds],
          );
          autoApproved = updated.length;
          if (autoApproved > 0) {
            await pool.query(
              `INSERT INTO working_memory (key, value_json, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
              [LEADERBOARD_KEY, JSON.stringify({ ...record, auto_approved_at: new Date().toISOString() })],
            );
            console.log(`[triage-15min] 否决窗过期，自动放行 ${autoApproved} 条 triage_approved`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[triage-15min] 规则2 否决窗检查失败（fail-open）:', e.message);
  }

  return { merged, autoApproved };
}
