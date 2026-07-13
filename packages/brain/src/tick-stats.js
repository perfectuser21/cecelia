/**
 * tick-stats.js — tick 统计写入（Wave-2 断链修复）。
 * 原写入方在废弃的 executeTick（tick-runner.js L1494/L219）体内，
 * runScheduler 活路径从不写 → tick_execution_stats/tick_last/tick_actions_today
 * 冻在 2026-05-05。本模块抽出等价逻辑供活路径调用；tick-runner 保留不动（回滚用）。
 * 两个函数都吞错不抛：统计属旁路观测，绝不拖垮 tick 主循环。
 */
import pool from './db.js';

const TICK_STATS_KEY = 'tick_execution_stats';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';

export async function recordTickExecution(durationMs, deps = {}) {
  const db = deps.pool || pool;
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const row = await client.query(
      'SELECT value_json FROM working_memory WHERE key = $1 FOR UPDATE',
      [TICK_STATS_KEY]
    );
    const current = row.rows[0]?.value_json || { total_executions: 0 };
    const lastExecutedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const stats = {
      total_executions: (current.total_executions || 0) + 1,
      last_executed_at: lastExecutedAt,
      last_duration_ms: durationMs,
    };
    await client.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_STATS_KEY, stats]
    );
    await client.query('COMMIT');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn('[tick-stats] recordTickExecution 失败（旁路，不影响 tick）:', err.message);
    return;
  } finally {
    if (client) client.release();
  }
  try {
    await db.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_LAST_KEY, { timestamp: new Date().toISOString() }]
    );
  } catch (err) {
    console.warn('[tick-stats] tick_last 写入失败（旁路）:', err.message);
  }
}

export async function incrementActionsToday(count = 1, deps = {}) {
  const db = deps.pool || pool;
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [TICK_ACTIONS_TODAY_KEY]
    );
    const current = result.rows[0]?.value_json || { date: today, count: 0 };
    const newCount = current.date === today ? current.count + count : count;
    await db.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_ACTIONS_TODAY_KEY, { date: today, count: newCount }]
    );
    return newCount;
  } catch (err) {
    console.warn('[tick-stats] incrementActionsToday 失败（旁路）:', err.message);
    return null;
  }
}
