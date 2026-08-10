/**
 * blocking-states-selfheal.integration.test.js
 *
 * 真 Postgres 端到端（禁 mock pool）——阻断类状态位 TTL 自愈 + 可见性。
 * PRD: sprints/08111700-blocking-state-ttl-selfheal —— 终结「健康地停摆」。
 *
 * 事故实证：2026-08-10 tick_draining 卡 2h20m（5 条 P0 零派发、健康检查报 healthy）、
 * machine_vitals_stale_alert 卡 2 天。本文件用真实 working_memory / cecelia_events
 * 验证：超 TTL 的 drain 自动解除并留痕告警；未超 TTL 不误伤；阻断位对健康检查可见。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { selfHealBlockingStates, getBlockingStates } from '../../blocking-states.js';
import { drainTick, cancelDrain, isDraining, _resetDrainState } from '../../drain.js';

const DRAIN_KEY = 'tick_draining';
const VITALS_KEY = 'machine_vitals_stale_alert';
const MIN = 60 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

async function readWm(key) {
  const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = $1`, [key]);
  const v = rows[0]?.value_json;
  return v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v);
}
async function setWm(key, value) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

beforeEach(async () => {
  _resetDrainState();
  await pool.query(`DELETE FROM working_memory WHERE key = ANY($1)`, [[DRAIN_KEY, VITALS_KEY]]);
  await pool.query(`DELETE FROM cecelia_events WHERE event_type = 'blocking_state_auto_recovered'`);
});

afterAll(async () => {
  _resetDrainState();
  await pool.query(`DELETE FROM working_memory WHERE key = ANY($1)`, [[DRAIN_KEY, VITALS_KEY]]);
  await pool.query(`DELETE FROM cecelia_events WHERE event_type = 'blocking_state_auto_recovered'`);
  await pool.end();
});

describe('tick_draining TTL 自愈（真 PG）', () => {
  it('drain_started_at 31 分钟前 → selfHeal 后自动清除 + auto_recovered 事件 + 派发解除阻断', async () => {
    await drainTick();                                    // 置位（内存 + working_memory）
    await setWm(DRAIN_KEY, { draining: true, drain_started_at: iso(31 * MIN) }); // 覆写为 31min 前
    expect(isDraining()).toBe(true);

    const res = await selfHealBlockingStates(pool, { ttlMs: 30 * MIN });

    expect(res.recovered.map((r) => r.key)).toContain('tick_draining');
    expect(await readWm(DRAIN_KEY)).toBeNull();           // 状态位已清除
    expect(isDraining()).toBe(false);                     // 派发闸（dispatcher 读 isDraining）已解除

    const ev = await pool.query(
      `SELECT payload FROM cecelia_events WHERE event_type = 'blocking_state_auto_recovered' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(ev.rows.length).toBe(1);
    const payload = typeof ev.rows[0].payload === 'string' ? JSON.parse(ev.rows[0].payload) : ev.rows[0].payload;
    expect(payload.key).toBe('tick_draining');
    expect(payload.stuck_minutes).toBeGreaterThanOrEqual(30);
  });

  it('drain_started_at 5 分钟前 → selfHeal 不误伤，状态位仍在、派发仍被阻断', async () => {
    await drainTick();
    await setWm(DRAIN_KEY, { draining: true, drain_started_at: iso(5 * MIN) });

    const res = await selfHealBlockingStates(pool, { ttlMs: 30 * MIN });

    expect(res.recovered).toEqual([]);
    expect(await readWm(DRAIN_KEY)).not.toBeNull();
    expect(isDraining()).toBe(true);
    await cancelDrain(); // 清理
  });
});

describe('阻断位可见性（真 PG）', () => {
  it('getBlockingStates 同时暴露 tick_draining 与 machine_vitals_stale_alert 及持续时长', async () => {
    await setWm(DRAIN_KEY, { draining: true, drain_started_at: iso(12 * MIN) });
    await setWm(VITALS_KEY, { since: iso(180 * MIN), last_error: 'spawn docker ENOENT' });

    const states = await getBlockingStates(pool);
    const keys = states.map((s) => s.key);
    expect(keys).toContain('tick_draining');
    expect(keys).toContain('machine_vitals_stale_alert');

    const drain = states.find((s) => s.key === 'tick_draining');
    expect(typeof drain.duration_ms).toBe('number');
    expect(drain.duration_ms).toBeGreaterThan(11 * MIN);

    const vitals = states.find((s) => s.key === 'machine_vitals_stale_alert');
    expect(vitals.duration_ms).toBeGreaterThan(120 * MIN);
  });
});
