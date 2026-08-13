/**
 * dedupe — 副作用 DB 级短期幂等（协议卫生包）
 *
 * 三个消费入口：actions.createTask（kind=create_task）/ executor 派发层（kind=spawn）
 * / notifier（kind=notify）。
 *
 * ⚠️ fail-open 拍板（decision 4ea9dcc5，勿改）：任何 DB 错误 → {claimed:true, degraded:true}。
 * 理由：通知宁可重复不可丢失（Bark 紧急告警丢了比重复严重）；spawn fail-closed
 * 等于 DB 抖动时全系统停派。降级时发 P2 dedupe_degraded 留痕。
 *
 * 时间源全部 DB 端 NOW()；过期行由下一次同 key claim 重占（ON CONFLICT DO UPDATE
 * WHERE expired），无独立清理循环（定时循环有 wave2 断链死亡前科）。
 */

import pool from '../db.js';
import { raise } from '../alerting.js';

const MAX_KEY_LEN = 255;

/**
 * 原子抢占去重 key。
 * @param {'create_task'|'spawn'|'notify'|string} kind
 * @param {string} key - ≤255 字符，超长调用方自行 hash（如 crypto sha256 hex）
 * @param {number} ttlSec
 * @returns {Promise<{claimed: boolean, degraded?: boolean}>}
 */
async function claimDedupeKey(kind, key, ttlSec, db = pool) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LEN) {
    throw new Error(`dedupe_key 必须是 1-${MAX_KEY_LEN} 字符字符串（超长请调用方自行 hash），got length=${key?.length}`);
  }
  try {
    const result = await db.query(
      `INSERT INTO side_effect_dedupe (kind, dedupe_key, expires_at)
       VALUES ($1, $2, NOW() + make_interval(secs => $3))
       ON CONFLICT (kind, dedupe_key)
         DO UPDATE SET expires_at = NOW() + make_interval(secs => $3), created_at = NOW()
         WHERE side_effect_dedupe.expires_at < NOW()
       RETURNING id`,
      [kind, key, ttlSec]
    );
    return { claimed: result.rowCount === 1 };
  } catch (err) {
    console.error(`[dedupe] claim 降级（fail-open）: kind=${kind} key=${key}: ${err.message}`);
    raise('P2', 'dedupe_degraded', `dedupe 表不可用，${kind} 副作用 fail-open 放行（key=${key}）: ${err.message}`)
      .catch(() => {});
    return { claimed: true, degraded: true };
  }
}

/** claim 后副作用执行失败时释放，让 TTL 内的合法重试不被误挡。错误全吞。 */
async function releaseDedupeKey(kind, key, db = pool) {
  try {
    await db.query(
      'DELETE FROM side_effect_dedupe WHERE kind = $1 AND dedupe_key = $2',
      [kind, key]
    );
  } catch (err) {
    console.error(`[dedupe] release 失败（忽略，等 TTL 过期）: kind=${kind} key=${key}: ${err.message}`);
  }
}

export { claimDedupeKey, releaseDedupeKey };
