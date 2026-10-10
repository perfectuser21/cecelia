/** 迁移 539 + resource-health 真库行为（任务 5bf2512a）：上报写当前状态、状态变化由触发器留历史、调度前检查读真表。每个用例事务内跑，结束回滚。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { reportResourceHealth, checkResourcesHealth, accountKey } from '../../lib/resource-health.js';

let pool, client;
const noNotify = async () => null;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

const rep = (over) => ({ resource_type: 'account', resource_key: accountKey('testplat', `acc-${over.tag}`), platform: 'testplat',
  status: 'healthy', reason: null, evidence: {}, source: 'pg-test', item_key: null, reported_at: null, ...over });

describe('资源健康真库', () => {
  it('首报建当前行并记一条历史（from 空）；同状态再报不加历史；状态变化再记一条并更新 status_since', async () => {
    const tag = randomUUID();
    const a = await reportResourceHealth(client, rep({ tag }), { notify: noNotify });
    expect(a).toMatchObject({ changed: true, previous_status: null, current: { status: 'healthy' } });
    await reportResourceHealth(client, rep({ tag }), { notify: noNotify });
    const b = await reportResourceHealth(client, rep({ tag, status: 'restricted', reason: '切换要身份校验', evidence: { shot: 'x.png' } }), { notify: noNotify });
    expect(b).toMatchObject({ changed: true, previous_status: 'healthy', current: { status: 'restricted', reason: '切换要身份校验' } });
    const ev = (await client.query(
      'SELECT from_status, to_status, reason, evidence FROM resource_health_events WHERE resource_key=$1 ORDER BY id', [a.current.resource_key])).rows;
    expect(ev).toEqual([
      { from_status: null, to_status: 'healthy', reason: null, evidence: {} },
      { from_status: 'healthy', to_status: 'restricted', reason: '切换要身份校验', evidence: { shot: 'x.png' } },
    ]);
  });

  it('psql 直改状态也留历史（触发器兜底，不靠应用代码）', async () => {
    const tag = randomUUID();
    const a = await reportResourceHealth(client, rep({ tag }), { notify: noNotify });
    await client.query("UPDATE resource_health SET status='offline', reason='直改' WHERE id=$1", [a.current.id]);
    const n = (await client.query('SELECT count(*)::int AS n FROM resource_health_events WHERE resource_health_id=$1', [a.current.id])).rows[0].n;
    expect(n).toBe(2);
  });

  it('warehouse_item 类型自动挂仓库物件；汇总视图给最差状态', async () => {
    const key = `rh-test-${randomUUID()}`;
    await client.query("INSERT INTO warehouse_items(key,name,kind,shelf) VALUES($1,'健康测试物件','infra','infrastructure')", [key]);
    const r = await reportResourceHealth(client, { ...rep({ tag: 'x' }), resource_type: 'warehouse_item', resource_key: key, platform: null, status: 'degraded', reason: '慢' }, { notify: noNotify });
    expect(r.current.warehouse_item_id).toBeTruthy();
    const v = (await client.query('SELECT worst_status, degraded FROM v_warehouse_item_health WHERE key=$1', [key])).rows[0];
    expect(v).toMatchObject({ worst_status: 'degraded', degraded: 1 });
  });

  it('调度前检查读真表：restricted 挡、没记录 unknown 放行', async () => {
    const tag = randomUUID();
    const bad = await reportResourceHealth(client, rep({ tag, status: 'restricted', reason: '人脸' }), { notify: noNotify });
    const out = await checkResourcesHealth(client, [{ type: 'account', key: bad.current.resource_key }, { type: 'phone', key: `none-${tag}` }]);
    expect(out.ok).toBe(false);
    expect(out.blocked[0]).toMatchObject({ status: 'restricted', reason: '人脸' });
    expect(out.unknown).toHaveLength(1);
  });

  it('非法状态被库约束拒绝', async () => {
    await expect(client.query("INSERT INTO resource_health(resource_type,resource_key,status,source) VALUES('phone','x','dead','t')")).rejects.toThrow();
  });
});
