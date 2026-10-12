/**
 * device-pool 选择逻辑（派发总闸 G，任务 c5f6e683）：按候选顺序过设备闸，首个放行即选中；
 * 被占/不健康换下一台；全被占 all_busy；全未注册 pool_unregistered；空池 pool_empty；闸抛错当不可用。
 * 真库（JOIN phone_registry / 停用过滤）见 integration/task-lease-device-pool.pg.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { selectDeviceFromPool, listPoolCandidates } from '../device-pool.js';

const A = { serial: 'A1', account_ref: 'Ai办公室', machine: 'xian-m4', profile: 'p1', priority: 10 };
const B = { serial: 'B2', account_ref: 'Ai效率笔记', machine: 'xian-m4', profile: 'p2', priority: 20 };
const poolOf = (rows) => ({ query: vi.fn(async () => ({ rows })) });

describe('listPoolCandidates', () => {
  it('按 pool_key 查、按 priority 排序（SQL 带启用过滤）', async () => {
    const p = poolOf([A, B]);
    expect(await listPoolCandidates(p, 'douyin.internal')).toEqual([A, B]);
    const [sql, params] = p.query.mock.calls[0];
    expect(params).toEqual(['douyin.internal']);
    expect(sql).toMatch(/p\.enabled AND m\.enabled AND r\.enabled/);
    expect(sql).toMatch(/ORDER BY m\.priority/);
  });
});

describe('selectDeviceFromPool', () => {
  it('首个放行即选中，闸收到的是候选 serial 与 TTL', async () => {
    const gate = vi.fn(async () => ({ pass: true }));
    const r = await selectDeviceFromPool(poolOf([A, B]), 'k.x', { id: 't', payload: { a: 1 } }, { lockGate: gate, ttlMinutes: 60 });
    expect(r).toMatchObject({ ok: true, member: A, tried: [] });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0][0].payload).toEqual({ a: 1, device_serial: 'A1', device_ttl_minutes: 60 });
  });
  it('首选被占 → 换下一台', async () => {
    const gate = async (t) => (t.payload.device_serial === 'A1' ? { pass: false, status: 409, body: { error: 'device_locked', locked_by: 'x' } } : { pass: true });
    const r = await selectDeviceFromPool(poolOf([A, B]), 'k.x', { id: 't' }, { lockGate: gate });
    expect(r.member).toBe(B);
    expect(r.tried).toEqual([{ serial: 'A1', status: 409, error: 'device_locked', locked_by: 'x' }]);
  });
  it('全被占 → all_busy；全未注册 → pool_unregistered；空池 → pool_empty', async () => {
    const busy = async () => ({ pass: false, status: 409, body: { error: 'device_locked' } });
    expect((await selectDeviceFromPool(poolOf([A, B]), 'k.x', { id: 't' }, { lockGate: busy })).reason).toBe('all_busy');
    const unknown = async () => ({ pass: false, status: 422, body: { error: 'unknown_device' } });
    expect((await selectDeviceFromPool(poolOf([A, B]), 'k.x', { id: 't' }, { lockGate: unknown })).reason).toBe('pool_unregistered');
    expect((await selectDeviceFromPool(poolOf([]), 'k.x', { id: 't' }, { lockGate: busy })).reason).toBe('pool_empty');
  });
  it('闸抛错当不可用（不放行），换下一台', async () => {
    const gate = async (t) => { if (t.payload.device_serial === 'A1') throw new Error('boom'); return { pass: true }; };
    const r = await selectDeviceFromPool(poolOf([A, B]), 'k.x', { id: 't' }, { lockGate: gate });
    expect(r.member).toBe(B);
    expect(r.tried[0].error).toMatch(/gate_error: boom/);
  });
});
