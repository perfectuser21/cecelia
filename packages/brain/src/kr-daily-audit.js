/**
 * KR Daily Audit — 每日 KR 进度可信度校验
 *
 * 功能：
 * 1. 汇总所有活跃 KR 的 verifier 状态（是否有错误、是否过期）
 * 2. 计算 trust_score（无错误且最近已采集的 verifier 占比）
 * 3. 发现问题时写入 event_log 供后续追踪
 * 4. 供 tick.js 每天触发一次，确保进度数据可信度
 *
 * 触发位置：tick.js 每天 UTC 01:00（北京时间 09:00）
 */

import pool from './db.js';

const STALE_THRESHOLD_HOURS = 3; // verifier 超过 3h 未更新视为过期

/**
 * 运行每日 KR 进度可信度审计
 * @returns {Promise<{trust_score: number, healthy: number, failing: number, stale: number, total: number, results: Array}>}
 */
export async function runDailyKrAudit() {
  const { rows: activeKrs } = await pool.query(`
    SELECT g.id, g.title, g.progress, g.current_value, g.status,
           v.id as verifier_id, v.enabled, v.last_checked, v.last_error,
           v.current_value as verifier_current, v.threshold, v.check_interval_minutes
    FROM key_results g
    LEFT JOIN kr_verifiers v ON v.kr_id = g.id AND v.enabled = true
    WHERE g.status IN ('active', 'in_progress')
    ORDER BY g.title
  `);

  const results = [];
  let healthy = 0;
  let failing = 0;
  let stale = 0;
  const noVerifier = [];

  for (const kr of activeKrs) {
    if (!kr.verifier_id) {
      noVerifier.push({ kr_id: kr.id, kr_title: kr.title, issue: 'no_verifier' });
      continue;
    }

    const lastChecked = kr.last_checked ? new Date(kr.last_checked) : null;
    const hoursSinceCheck = lastChecked
      ? (Date.now() - lastChecked.getTime()) / (1000 * 60 * 60)
      : Infinity;

    const isStale = hoursSinceCheck > STALE_THRESHOLD_HOURS;
    const hasError = !!kr.last_error;
    const isHealthy = !hasError && !isStale;

    if (isHealthy) healthy++;
    else if (hasError) failing++;
    else if (isStale) stale++;

    results.push({
      kr_id: kr.id,
      kr_title: kr.title,
      progress: kr.progress,
      current_value: kr.current_value,
      verifier_current: kr.verifier_current,
      threshold: kr.threshold,
      last_checked: kr.last_checked,
      hours_since_check: Math.round(hoursSinceCheck * 10) / 10,
      last_error: kr.last_error || null,
      status: isHealthy ? 'healthy' : hasError ? 'error' : 'stale',
    });
  }

  const total = healthy + failing + stale;
  const trust_score = total > 0 ? Math.round((healthy / total) * 100) : 0;

  const auditSummary = {
    trust_score,
    healthy,
    failing,
    stale,
    total,
    no_verifier_count: noVerifier.length,
    results,
    no_verifier: noVerifier,
    audited_at: new Date().toISOString(),
  };

  // 写入 event_log 供追踪
  try {
    await pool.query(`
      INSERT INTO event_log (event_type, source, payload, created_at)
      VALUES ('kr_daily_audit', 'kr-daily-audit', $1::jsonb, NOW())
    `, [JSON.stringify({
      trust_score,
      healthy,
      failing,
      stale,
      total,
      failing_krs: results.filter(r => r.status === 'error').map(r => r.kr_title),
    })]);
  } catch (e) {
    // event_log 写入失败不阻断主流程
    console.warn('[kr-daily-audit] event_log 写入失败（非阻断）:', e.message);
  }

  if (trust_score < 80) {
    console.warn(`[kr-daily-audit] ⚠️  KR 可信度偏低: ${trust_score}% (healthy=${healthy} failing=${failing} stale=${stale})`);
  } else {
    console.log(`[kr-daily-audit] ✅ KR 可信度: ${trust_score}% (healthy=${healthy}/${total})`);
  }

  return auditSummary;
}

// 记录上次每日审计时间（内存级，重启后归零，由 tick 中的日期判断兜底）
let _lastDailyAuditDate = null;

/**
 * 每天触发一次 KR 审计（tick.js 调用）
 * @returns {Promise<Object|null>} 审计结果，跳过时返回 null
 */
export async function runDailyKrAuditIfNeeded() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (_lastDailyAuditDate === today) return null;

  _lastDailyAuditDate = today;
  return runDailyKrAudit();
}
