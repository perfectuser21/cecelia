/**
 * drain-stale-restore.integration.test.js
 *
 * 回归测试：restoreDrainState 对过期 drain 残留必须自愈（真 postgres，禁 mock pool）
 *
 * Task: 468ef3d7-a503-4ab0-9834-33a58988a623 · Issue cc28d1af 根因D 第3/4次复发
 *
 * 历史 bug：brain-deploy.sh 换容器后的无条件 drain-cancel 在端口切换窗口
 * curl -sf 静默失败（||true 吞错）→ working_memory 里的 tick_draining 残留
 * → 新 Brain 启动 restoreDrainState() 无条件恢复任意年龄的 drain → 派发瘫痪
 * 直到人工发现（2026-08-04 一夜 4 次实证）。
 *
 * 修法：restore 时若 drain_started_at 距今超过 DRAIN_RESTORE_MAX_AGE_MS（15min），
 * 判为部署残留：不恢复内存态 + 清掉持久化行 + 打日志。drain 的合法生命周期
 * = pre-swap 等待（≤120s 超时）+ swap 数分钟，15 分钟远超合法上限。
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { restoreDrainState, isDraining, _resetDrainState } from '../../drain.js';

const KEY = 'tick_draining';

async function seedDrainRow(startedAtIso) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [KEY, { draining: true, drain_started_at: startedAtIso }]
  );
}

async function readDrainRow() {
  const { rows } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1`, [KEY]
  );
  return rows[0]?.value_json ?? null;
}

beforeEach(async () => {
  _resetDrainState();
  await pool.query(`DELETE FROM working_memory WHERE key = $1`, [KEY]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM working_memory WHERE key = $1`, [KEY]);
  await pool.end();
});

describe('restoreDrainState — 过期 drain 残留自愈', () => {
  it('过期残留（20 分钟前）→ 不恢复 draining 且持久化行被清掉', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await seedDrainRow(stale);

    await restoreDrainState();

    expect(isDraining()).toBe(false);
    expect(await readDrainRow()).toBeNull();
  });

  it('新鲜 drain（2 分钟前）→ 正常恢复（部署中重启的合法场景不受影响）', async () => {
    const fresh = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await seedDrainRow(fresh);

    await restoreDrainState();

    expect(isDraining()).toBe(true);
    expect(await readDrainRow()).not.toBeNull();
  });

  it('drain_started_at 缺失/不可解析 → 视为过期残留清掉（fail-safe 不瘫痪派发）', async () => {
    await seedDrainRow(null);

    await restoreDrainState();

    expect(isDraining()).toBe(false);
    expect(await readDrainRow()).toBeNull();
  });
});
