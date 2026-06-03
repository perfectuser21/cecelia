/**
 * loadActiveMachines — 薄封装，从 system_registry (type=machine, status=active) 读机器，
 * 带短缓存（防高频路由把 DB 打爆）。resolveExecutor 单测时整张 deps 注入假实现，不碰这里。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元2
 */

import pool from '../db.js';

const CACHE_TTL_MS = Number(process.env.MACHINE_CACHE_TTL_MS || 5000);

let _cache = null;
let _cacheAt = 0;

/**
 * @returns {Promise<Array<{ name: string, status: string, metadata: Object }>>}
 */
export async function loadActiveMachines() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) {
    return _cache;
  }
  const { rows } = await pool.query(
    // ORDER BY name：确定性选机（配合 select-load-balanced 取 candidates[0]，
    // 默认任务稳定落到字典序第一台满足标签的机器，不随 DB 物理顺序漂移）。
    `SELECT name, status, metadata
     FROM system_registry
     WHERE type = 'machine' AND status = 'active'
     ORDER BY name`,
  );
  _cache = rows;
  _cacheAt = now;
  return rows;
}

/** 测试 / PATCH 后手动清缓存。 */
export function clearMachineCache() {
  _cache = null;
  _cacheAt = 0;
}
