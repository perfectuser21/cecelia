/**
 * KR Verifier — 不可伪造的 KR 进度验证引擎
 *
 * 核心原则：
 * 1. KR progress 只由外部数据源计算，任何 agent 不能直接写
 * 2. 每个 KR 绑定一个 SQL 查询（kr_verifiers 表），定时采集 metric_current
 * 3. progress = (current_value / threshold) × 100，封顶 100
 * 4. 执行者不能验收自己的工作
 *
 * 触发位置：tick.js（每小时一次）
 */

import pool from './db.js';

/**
 * 运行所有启用的 KR verifier，更新 metric_current 和 progress
 * @returns {Promise<{ checked: number, updated: number, errors: number, results: Array }>}
 */
export async function runAllVerifiers() {
  const results = [];
  let checked = 0;
  let updated = 0;
  let errors = 0;

  try {
    const { rows: verifiers } = await pool.query(`
      SELECT v.*, g.title as kr_title,
             g.metadata->>'metric_from' as metric_from,
             g.metadata->>'metric_to' as metric_to
      FROM kr_verifiers v
      JOIN key_results g ON g.id = v.kr_id
      WHERE v.enabled = true
        AND g.status IN ('active', 'in_progress')
        AND (v.last_checked IS NULL
             OR v.last_checked < NOW() - make_interval(mins => v.check_interval_minutes))
    `);

    if (verifiers.length === 0) {
      return { checked: 0, updated: 0, errors: 0, results: [] };
    }

    for (const v of verifiers) {
      checked++;
      try {
        if (v.verifier_type !== 'sql') {
          results.push({ kr_id: v.kr_id, kr_title: v.kr_title, skipped: true, reason: `unsupported type: ${v.verifier_type}` });
          continue;
        }

        // 检测静态常量 SQL（如 "SELECT 0::numeric" 或 "SELECT 72::numeric"）
        // 这类 SQL 永远返回固定值，无法反映真实进度，可能是未完成的占位符
        if (/^\s*SELECT\s+\d+(::\w+)?\s+as\s+\w+\s*$/i.test(v.query.trim())) {
          console.warn(`[kr-verifier] WARN: "${v.kr_title}" 使用常量 SQL (${v.query.trim()})，进度将永远固定，请替换为真实采集查询`);
        }

        const { rows } = await pool.query(v.query);
        const rawValue = rows[0]?.[v.metric_field] ?? rows[0]?.count ?? 0;
        const currentValue = parseFloat(rawValue) || 0;
        const oldValue = parseFloat(v.current_value) || 0;

        await pool.query(`
          UPDATE kr_verifiers
          SET current_value = $1, last_checked = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $2
        `, [currentValue, v.id]);

        const threshold = parseFloat(v.threshold) || 1;
        const progress = Math.min(100, Math.round((currentValue / threshold) * 100));

        await pool.query(`
          UPDATE key_results
          SET progress = $1,
              current_value = $2,
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('metric_current', $2::text),
              updated_at = NOW()
          WHERE id = $3
        `, [progress, currentValue, v.kr_id]);

        updated++;
        results.push({
          kr_id: v.kr_id, kr_title: v.kr_title,
          old_value: oldValue, current_value: currentValue,
          threshold, progress, changed: currentValue !== oldValue,
        });

        if (currentValue !== oldValue) {
          console.log(`[kr-verifier] ${v.kr_title}: ${oldValue} → ${currentValue} (progress: ${progress}%)`);
        }
      } catch (err) {
        errors++;
        await pool.query(`
          UPDATE kr_verifiers SET last_error = $1, last_checked = NOW(), updated_at = NOW() WHERE id = $2
        `, [err.message, v.id]).catch(() => {});
        results.push({ kr_id: v.kr_id, kr_title: v.kr_title, error: err.message });
        console.error(`[kr-verifier] 查询失败 (${v.kr_title}): ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[kr-verifier] 批量执行失败:', err.message);
    return { checked: 0, updated: 0, errors: 1, results: [{ error: err.message }] };
  }

  if (checked > 0) {
    console.log(`[kr-verifier] 完成: checked=${checked} updated=${updated} errors=${errors}`);
  }
  return { checked, updated, errors, results };
}

/**
 * KR verifier 健康度校验 — 返回所有 active KR verifier 的健康状态
 *
 * 健康等级：
 * - healthy: 无已知问题
 * - warn: 使用静态 SQL / 数据陈旧（>3h 未采集）/ 已禁用
 * - critical: 最近采集报错
 *
 * @returns {Promise<{ verifiers: Array, summary: { healthy: number, warn: number, critical: number } }>}
 */
export async function getKrVerifierHealth() {
  const STALE_HOURS = 3;

  const { rows: verifiers } = await pool.query(`
    SELECT v.id, v.kr_id, v.verifier_type, v.query, v.threshold,
           v.current_value, v.last_checked, v.last_error, v.enabled,
           v.check_interval_minutes,
           g.title as kr_title, g.status as kr_status, g.progress_pct
    FROM kr_verifiers v
    JOIN key_results g ON g.id = v.kr_id
    WHERE g.status IN ('active', 'in_progress')
    ORDER BY g.title
  `);

  const results = verifiers.map(v => {
    const issues = [];

    const isStatic = /^\s*SELECT\s+\d+(::\w+)?\s+as\s+\w+\s*$/i.test((v.query || '').trim());
    if (isStatic) issues.push('static_sql');

    const lastChecked = v.last_checked ? new Date(v.last_checked) : null;
    const hoursSinceCheck = lastChecked
      ? (Date.now() - lastChecked.getTime()) / 3_600_000
      : Infinity;
    if (hoursSinceCheck > STALE_HOURS) issues.push('stale');

    if (v.last_error) issues.push('has_error');
    if (!v.enabled) issues.push('disabled');

    const health = issues.includes('has_error') ? 'critical'
      : issues.length > 0 ? 'warn'
      : 'healthy';

    return {
      kr_id: v.kr_id,
      kr_title: v.kr_title,
      kr_status: v.kr_status,
      progress_pct: v.progress_pct,
      current_value: v.current_value !== null ? parseFloat(v.current_value) : null,
      threshold: v.threshold !== null ? parseFloat(v.threshold) : null,
      last_checked: v.last_checked,
      hours_since_check: isFinite(hoursSinceCheck) ? Math.round(hoursSinceCheck * 10) / 10 : null,
      health,
      issues,
      last_error: v.last_error || null,
      is_static_sql: isStatic,
    };
  });

  const summary = results.reduce(
    (acc, v) => { acc[v.health] = (acc[v.health] || 0) + 1; return acc; },
    { healthy: 0, warn: 0, critical: 0 }
  );

  return { verifiers: results, summary };
}

/**
 * 重置所有 KR 的 progress 为 verifier 计算值（修复假数据）
 */
export async function resetAllKrProgress() {
  const { rows: verifiers } = await pool.query(`
    SELECT v.kr_id, v.current_value, v.threshold, g.title
    FROM kr_verifiers v JOIN key_results g ON g.id = v.kr_id WHERE v.enabled = true
  `);

  let fixed = 0;
  for (const v of verifiers) {
    const threshold = parseFloat(v.threshold) || 1;
    const currentValue = parseFloat(v.current_value) || 0;
    const progress = Math.min(100, Math.round((currentValue / threshold) * 100));

    await pool.query(`
      UPDATE key_results SET progress = $1,
        current_value = $2,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('metric_current', $3),
        updated_at = NOW()
      WHERE id = $4
    `, [progress, currentValue, String(currentValue), v.kr_id]);
    fixed++;
  }
  return { fixed };
}
