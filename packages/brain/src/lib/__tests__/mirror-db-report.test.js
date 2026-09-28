/**
 * mirror-db-report.js — 镜子库失联的读取与渲染（晨报一行 / 日报板块），决策 24a37029。
 * 数据源 = promise-map-nightly 落在 working_memory[promise-map-nightly] 的 results 里 key=mirror_db_reachable 的断言。
 * 有失联 → 🔴 RED 行「镜子库失联：<title>×N」；无失联 / 无数据 / 读取失败 → null（不出行，不拖垮晨报/日报）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  readMirrorDbState, renderMirrorDbLine, renderMirrorDbSection, MIRROR_DB_SENTINEL_KEY,
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

describe('renderMirrorDbLine / renderMirrorDbSection', () => {
  it('有失联 → 🔴 RED 一行「镜子库失联：AI Journey、AI Feature ×2」', () => {
    const line = renderMirrorDbLine({ checked_at: '2026-09-27T02:00:00.000Z', lost: LOST });
    expect(line).toBe('🔴 RED 镜子库失联：AI Journey、AI Feature ×2（Notion 回收站/404，推送已停）');
  });
  it('超过 3 个只列 3 个加省略', () => {
    const many = [...LOST, { title: 'C', table: 'c', dbId: 'c', reason: 'in_trash' }, { title: 'D', table: 'd', dbId: 'd', reason: 'in_trash' }];
    expect(renderMirrorDbLine({ checked_at: 'x', lost: many })).toContain('AI Journey、AI Feature、C … ×4');
  });
  it('无失联 / null → 不出行、不出板块', () => {
    expect(renderMirrorDbLine(null)).toBeNull();
    expect(renderMirrorDbLine({ checked_at: 'x', lost: [] })).toBeNull();
    expect(renderMirrorDbSection(null)).toBe('');
    expect(renderMirrorDbSection({ checked_at: 'x', lost: [] })).toBe('');
  });
  it('日报板块：标题 + 每库一行（title / 表 / 原因）+ 核对时间', () => {
    const sec = renderMirrorDbSection({ checked_at: '2026-09-27T02:00:00.000Z', lost: LOST });
    expect(sec).toContain('== 镜子库失联 ==');
    expect(sec).toContain('🔴 RED 镜子库失联：AI Journey、AI Feature ×2');
    expect(sec).toContain('  - AI Journey（journeys）：in_trash');
    expect(sec).toContain('  - AI Feature（journey_features）：404');
    expect(sec).toContain('2026-09-27T02:00:00.000Z');
  });
});
