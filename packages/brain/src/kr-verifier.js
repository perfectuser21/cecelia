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
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('metric_current', $2::text),
        updated_at = NOW()
      WHERE id = $3 AND progress != $1
    `, [progress, currentValue.toString(), v.kr_id]);
    fixed++;
  }
  return { fixed };
}
