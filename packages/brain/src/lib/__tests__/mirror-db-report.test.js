// 读取真实镜子库失联哨兵；保留结果形状与DB错误隔离。
import { describe, it, expect, vi } from 'vitest';
import {
  readMirrorDbState, MIRROR_DB_SENTINEL_KEY,
} from '../mirror-db-report.js';

const LOST = [
  { title: 'AI Journey', table: 'journeys', dbId: '358c40c2-ba63-8148-bde7-e313d789931a', reason: 'in_trash' },
  { title: 'AI Feature', table: 'journey_features', dbId: '358c40c2-ba63-81e3-96c5-d762b3d34dff', reason: '404' },
];
const nightly = (results, last_run_at = '2026-09-27T02:00:00.000Z') => ({ last_run_at, results });
const poolWith = (value) => ({ query: vi.fn(async (sql, params) => {
  if (/working_memory/.test(String(sql)) && params?.[0] === MIRROR_DB_SENTINEL_KEY) return { rows: value === undefined ? [] : [{ value_json: value }] };
  return { rows: [] };
}) });

describe('readMirrorDbState', () => {
  it('读 promise-map-nightly 哨兵：mirror_db_reachable 红 → 返回 lost 清单与核对时间', async () => {
    const st = await readMirrorDbState(poolWith(nightly([
      { key: 'anchor_cell_writeback', ok: true },
      { key: 'mirror_db_reachable', ok: false, lost: LOST, detail: 'x' },
    ])));
    expect(st).toEqual({ checked_at: '2026-09-27T02:00:00.000Z', lost: LOST });
  });
  it('断言绿 / 无该断言 / 无哨兵 / value 是字符串 JSON → 相应 null 或解析', async () => {
    expect(await readMirrorDbState(poolWith(nightly([{ key: 'mirror_db_reachable', ok: true, lost: [] }])))).toBeNull();
    expect(await readMirrorDbState(poolWith(nightly([{ key: 'anchor_cell_writeback', ok: true }])))).toBeNull();
    expect(await readMirrorDbState(poolWith(undefined))).toBeNull();
    const st = await readMirrorDbState(poolWith(JSON.stringify(nightly([{ key: 'mirror_db_reachable', ok: false, lost: LOST }]))));
    expect(st.lost).toHaveLength(2);
  });
  it('查询失败 → null 不抛', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    await expect(readMirrorDbState(pool)).resolves.toBeNull();
  });
});
