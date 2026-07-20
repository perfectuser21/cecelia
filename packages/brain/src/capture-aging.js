/**
 * capture-aging.js — 账龄哨兵
 * FR-7: 超7天告警 + llm_failed 自动重试(≤3次) + 超限转 parked + 计数指标
 */

const FEISHU_AGING_WEBHOOK = process.env.FEISHU_CAPTURE_AGING_WEBHOOK || process.env.FEISHU_SKILL_EVAL_WEBHOOK || '';
const OVERDUE_DAYS = 7;
const MAX_RETRY = 3;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1小时
const INTERVAL_MS = parseInt(process.env.CECELIA_CAPTURE_AGING_INTERVAL_MS || String(DEFAULT_INTERVAL_MS), 10);

let lastRunAt = 0;

async function sendFeishuAlert(msg) {
  if (!FEISHU_AGING_WEBHOOK) {
    console.warn(`[capture-aging] 飞书 webhook 未配置，本地日志: ${msg}`);
    return;
  }
  try {
    const resp = await fetch(FEISHU_AGING_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } }),
    });
    if (!resp.ok) console.warn(`[capture-aging] 飞书告警失败: ${resp.status}`);
  } catch (err) {
    console.warn(`[capture-aging] 飞书告警异常: ${err.message}`);
  }
}

/**
 * 账龄哨兵主函数
 * @returns {{ overdue_captures: number, overdue_atoms: number, retried: number, parked_by_aging: number }}
 */
export async function runCaptureAging(pool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) {
    return { skipped: true, overdue_captures: 0, overdue_atoms: 0, retried: 0, parked_by_aging: 0 };
  }
  lastRunAt = now;

  let overdue_captures = 0;
  let overdue_atoms = 0;
  let retried = 0;
  let parked_by_aging = 0;

  try {
    // 1. 超期 captures 告警（非终态，超7天）
    const { rows: overdueCaptures } = await pool.query(
      `SELECT id, content FROM captures
       WHERE status NOT IN ('done','dropped')
         AND created_at < now() - interval '${OVERDUE_DAYS} days'`
    );
    overdue_captures = overdueCaptures.length;
    if (overdue_captures > 0) {
      await sendFeishuAlert(
        `[Cecelia账龄哨兵] ${overdue_captures} 条 capture 超 ${OVERDUE_DAYS} 天未处理，请人工复核。\n示例: ${overdueCaptures[0]?.content?.slice(0, 60)}`
      );
    }

    // 2. 超期 atoms 告警（非终态，超7天）
    const { rows: overdueAtoms } = await pool.query(
      `SELECT id, content FROM capture_atoms
       WHERE status NOT IN ('confirmed','dismissed','dropped','routed')
         AND created_at < now() - interval '${OVERDUE_DAYS} days'`
    );
    overdue_atoms = overdueAtoms.length;
    if (overdue_atoms > 0) {
      await sendFeishuAlert(
        `[Cecelia账龄哨兵] ${overdue_atoms} 条 capture_atom 超 ${OVERDUE_DAYS} 天未处理，请人工复核。`
      );
    }

    // 3. llm_failed 超限转 parked（retry_count >= 3）
    const { rows: maxRetryAtoms } = await pool.query(
      `UPDATE capture_atoms
       SET status = 'parked', ai_reason = '[aging:max_retry_parked]', updated_at = now()
       WHERE status = 'pending_review'
         AND ai_reason LIKE '[triage:llm_failed%'
         AND retry_count >= $1
       RETURNING id`,
      [MAX_RETRY]
    );
    parked_by_aging = maxRetryAtoms.length;

    // 4. llm_failed 自动重试（retry_count < 3）
    const { rows: retryAtoms } = await pool.query(
      `UPDATE capture_atoms
       SET ai_reason = NULL, retry_count = retry_count + 1, updated_at = now()
       WHERE status = 'pending_review'
         AND ai_reason LIKE '[triage:llm_failed%'
         AND retry_count < $1
       RETURNING id`,
      [MAX_RETRY]
    );
    retried = retryAtoms.length;

    console.log(`[capture-aging] overdue_captures=${overdue_captures} overdue_atoms=${overdue_atoms} retried=${retried} parked_by_aging=${parked_by_aging}`);
  } catch (err) {
    console.error(`[capture-aging] 运行失败: ${err.message}`);
  }

  return { overdue_captures, overdue_atoms, retried, parked_by_aging };
}
