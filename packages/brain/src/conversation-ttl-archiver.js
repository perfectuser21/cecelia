/**
 * conversation-ttl-archiver.js — conversations TTL 到期归档
 *
 * 每 10 分钟扫描一次，将 ttl_expires_at < NOW() 且 status 为 active/suspended
 * 的对话软归档（status→'archived'，写 archived_summary 占位符）。
 * 归档后 brain 晨报可感知到已过期对话数。
 *
 * gate：进程级变量 lastRunAt（照 triage-officer-15min.js 先例）
 */

const GATE_MS = parseInt(
  process.env.CONV_TTL_ARCHIVER_INTERVAL_MS || String(10 * 60 * 1000),
  10,
);
let lastRunAt = 0;

export function __resetConvTtlArchiverForTest() { lastRunAt = 0; }

/**
 * @param {object} pool — pg Pool 实例
 * @returns {Promise<{ skipped: boolean, archived: number }>}
 */
export async function runConversationTtlArchiver(pool) {
  const now = Date.now();
  if (now - lastRunAt < GATE_MS) return { skipped: true, archived: 0 };
  lastRunAt = now;

  const { rows } = await pool.query(
    `UPDATE conversations
        SET status           = 'archived',
            archived_summary = 'TTL expired: auto-archived by scheduler',
            updated_at       = NOW()
      WHERE status IN ('active', 'suspended')
        AND ttl_expires_at IS NOT NULL
        AND ttl_expires_at < NOW()
     RETURNING id`,
  );

  return { skipped: false, archived: rows.length };
}
