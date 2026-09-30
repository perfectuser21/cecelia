/**
 * routing/qiumi-serial-gate.js 单测（任务 5ad81457）：同机串行闸的 serial 取值、查询口径、task_events 去重。
 * dispatcher 接线见 src/__tests__/dispatcher-qiumi-routing.test.js，真 PG 见 integration/qiumi-device-busy-wait.pg.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { routeSerialOf, findSameSerialBusy } from '../qiumi-serial-gate.js';

const eventsOf = (pool) => pool.query.mock.calls.filter(([sql]) => /INSERT INTO task_events/.test(sql));
function poolWith(busyId) {
  return {
    query: vi.fn(async (sql) => (/FROM tasks/.test(sql) ? { rows: busyId ? [{ id: busyId }] : [] } : { rows: [], rowCount: 1 })),
  };
}

describe('routeSerialOf', () => {
  it('取 qiumi_route.device_hint.serial；空串/缺失/非字符串 → null', () => {
    expect(routeSerialOf({ qiumi_route: { device_hint: { serial: ' S1 ' } } })).toBe('S1');
    expect(routeSerialOf({ qiumi_route: { device_hint: { serial: '' } } })).toBeNull();
    expect(routeSerialOf({ qiumi_route: {} })).toBeNull();
    expect(routeSerialOf(null)).toBeNull();
    expect(routeSerialOf({ qiumi_route: { device_hint: { serial: 42 } } })).toBeNull();
  });
});

describe('findSameSerialBusy', () => {
  it('serial 为空 → 不查库直接 null', async () => {
    const pool = poolWith('x');
    await expect(findSameSerialBusy(pool, 'me', null)).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('查询只数 qiumi_task + in_progress、排除自己、按 serial 匹配', async () => {
    const pool = poolWith(null);
    await expect(findSameSerialBusy(pool, 'me-1', 'S1')).resolves.toBeNull();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/task_type = 'qiumi_task'/);
    expect(sql).toMatch(/status = 'in_progress'/);
    expect(sql).toMatch(/id <> \$1/);
    expect(sql).toMatch(/payload->'qiumi_route'->'device_hint'->>'serial' = \$2/);
    expect(params).toEqual(['me-1', 'S1']);
  });

  it('命中 → 返回占用单；同一占用者连续命中只记一次事件，换占用者再记', async () => {
    const pool = poolWith('busy-A');
    expect((await findSameSerialBusy(pool, 'me-2', 'S1'))?.id).toBe('busy-A');
    await findSameSerialBusy(pool, 'me-2', 'S1');
    expect(eventsOf(pool)).toHaveLength(1);
    expect(JSON.parse(eventsOf(pool)[0][1][2])).toEqual({ serial: 'S1', busy_task_id: 'busy-A' });

    const poolB = poolWith('busy-B');
    await findSameSerialBusy(poolB, 'me-2', 'S1');
    expect(eventsOf(poolB)).toHaveLength(1);
  });

  it('空出来后再被挡，会重新记事件', async () => {
    await findSameSerialBusy(poolWith('busy-C'), 'me-3', 'S1');
    await findSameSerialBusy(poolWith(null), 'me-3', 'S1');
    const again = poolWith('busy-C');
    await findSameSerialBusy(again, 'me-3', 'S1');
    expect(eventsOf(again)).toHaveLength(1);
  });
});
