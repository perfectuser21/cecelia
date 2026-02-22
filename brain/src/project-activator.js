/**
 * Project Activator - Project 层激活/降级管理
 *
 * 类似 initiative-closer.js 中的 activateNextInitiatives，但管理 Project 层。
 * 每次 tick 调用，确保 active projects 数量在 capacity 范围内。
 *
 * 逻辑：
 *   1. active > max → 最低分的降级为 inactive
 *   2. active < max → 从 pending/inactive 按分数补位
 *   3. cooldown 防抖：刚切换的不再动
 *
 * 触发位置：tick.js（新 Section）
 */

import { computeActivationScore } from './activation-scorer.js';

/**
 * 管理 Project 层激活状态。确保 active 数量不超过 max，不低于 softMin。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {Object} cap - capacity.project 配置 { max, softMin, cooldownMs }
 * @returns {Promise<{ activated: number, deactivated: number }>}
 */
async function manageProjectActivation(pool, cap) {
  const now = new Date();
  let activated = 0;
  let deactivated = 0;

  // 1. 查当前 active projects
  const activeResult = await pool.query(`
    SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
           p.metadata->>'user_pinned' AS user_pinned,
           g.priority
    FROM projects p
    LEFT JOIN project_kr_links pkl ON pkl.project_id = p.id
    LEFT JOIN goals g ON g.id = pkl.kr_id
    WHERE p.type = 'project'
      AND p.status = 'active'
    ORDER BY p.created_at ASC
  `);
  const activeProjects = activeResult.rows;

  // 2. 如果 active > max → 降级最低分的
  if (activeProjects.length > cap.max) {
    const excess = activeProjects.length - cap.max;

    // 计算分数
    const scored = activeProjects.map(p => ({
      ...p,
      user_pinned: p.user_pinned === 'true',
      score: computeActivationScore({
        priority: p.priority || 'P2',
        created_at: p.created_at,
        updated_at: p.updated_at,
        user_pinned: p.user_pinned === 'true',
      }, cap.cooldownMs, now),
    }));

    // 跳过 cooldown 中的（score = -Infinity）和 pinned 的
    const canDeactivate = scored
      .filter(p => p.score !== -Infinity && !p.user_pinned)
      .sort((a, b) => a.score - b.score);

    const toDeactivate = canDeactivate.slice(0, excess);

    for (const proj of toDeactivate) {
      await pool.query(`
        UPDATE projects
        SET status = 'inactive', updated_at = NOW()
        WHERE id = $1
      `, [proj.id]);
      deactivated++;
    }

    if (deactivated > 0) {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('projects_deactivated', 'project_activator', $1)
      `, [JSON.stringify({
        deactivated_count: deactivated,
        deactivated_names: toDeactivate.map(p => p.name),
        reason: 'capacity_exceeded',
        cap_max: cap.max,
        timestamp: now.toISOString(),
      })]);
    }
  }

  // 3. 计算当前 active 数量（降级后）
  const currentActive = activeProjects.length - deactivated;
  const slotsAvailable = cap.max - currentActive;

  if (slotsAvailable <= 0) {
    return { activated, deactivated };
  }

  // 4. 从 pending + inactive 按分数补位
  const candidateResult = await pool.query(`
    SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
           p.metadata->>'user_pinned' AS user_pinned,
           g.priority
    FROM projects p
    LEFT JOIN project_kr_links pkl ON pkl.project_id = p.id
    LEFT JOIN goals g ON g.id = pkl.kr_id
    WHERE p.type = 'project'
      AND p.status IN ('pending', 'inactive')
    ORDER BY p.created_at ASC
  `);

  // 计算分数并排序
  const candidates = candidateResult.rows
    .map(p => ({
      ...p,
      user_pinned: p.user_pinned === 'true',
      score: computeActivationScore({
        priority: p.priority || 'P2',
        created_at: p.created_at,
        updated_at: p.updated_at,
        user_pinned: p.user_pinned === 'true',
      }, cap.cooldownMs, now),
    }))
    .filter(p => p.score !== -Infinity)
    .sort((a, b) => b.score - a.score);

  const toActivate = candidates.slice(0, slotsAvailable);

  for (const proj of toActivate) {
    await pool.query(`
      UPDATE projects
      SET status = 'active', updated_at = NOW()
      WHERE id = $1
    `, [proj.id]);
    activated++;
  }

  if (activated > 0) {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('projects_activated', 'project_activator', $1)
    `, [JSON.stringify({
      activated_count: activated,
      activated_names: toActivate.map(p => p.name),
      previous_active: currentActive,
      new_active: currentActive + activated,
      cap_max: cap.max,
      timestamp: now.toISOString(),
    })]);
  }

  return { activated, deactivated };
}

export { manageProjectActivation };
