/**
 * TDD：Notion 投影注册表（三面模型定稿，决策 297ffee5 / 立项 f5ba8ee3）
 * 血管注册制：每个 Notion 编制库登记「面 / 对应表 / 方向 / 血管」；
 * 有 notion_id 列却未登记 = 守夜报红。
 */
import { describe, it, expect } from 'vitest';
import {
  FACES, FACE_ICON, normalizeNotionId, assertFace,
  loadProjectionMap, findUnregisteredNotionTables,
} from '../lib/notion-projection-registry.js';

describe('三面枚举与图标', () => {
  it('只有 mirror / inlet / truth 三种面，各有唯一图标', () => {
    expect(FACES).toEqual(['mirror', 'inlet', 'truth']);
    expect(FACE_ICON).toEqual({ mirror: '🔒', inlet: '✍️', truth: '📚' });
  });
  it('assertFace 拒绝三面之外的值', () => {
    expect(() => assertFace('mirror')).not.toThrow();
    expect(() => assertFace('department')).toThrow(/face/);
  });
});

describe('normalizeNotionId', () => {
  it('去连字符、小写，带/不带连字符视为同一库', () => {
    expect(normalizeNotionId('353c40c2-ba63-81bf-ae3e-f0e6fa3753d7')).toBe('353c40c2ba6381bfae3ef0e6fa3753d7');
    expect(normalizeNotionId('353C40C2BA6381BFAE3EF0E6FA3753D7')).toBe('353c40c2ba6381bfae3ef0e6fa3753d7');
  });
});

describe('loadProjectionMap', () => {
  it('从 notion_projection_map 读取全部登记并按 face 分组', async () => {
    const pool = { query: async () => ({ rows: [
      { notion_db_id: 'a'.repeat(32), title: 'Issues', face: 'mirror', brain_table: 'issues', direction: 'push', status: 'active' },
      { notion_db_id: 'b'.repeat(32), title: 'Tasks', face: 'inlet', brain_table: 'tasks', direction: 'both', status: 'active' },
      { notion_db_id: 'c'.repeat(32), title: 'Knowledge_Reference', face: 'truth', brain_table: null, direction: 'none', status: 'active' },
    ] }) };
    const m = await loadProjectionMap(pool);
    expect(m.rows).toHaveLength(3);
    expect(m.byFace.mirror.map(r => r.title)).toEqual(['Issues']);
    expect(m.byFace.truth[0].brain_table).toBeNull();
    expect(m.byTable.get('tasks').face).toBe('inlet');
  });
});

describe('findUnregisteredNotionTables（守夜口径）', () => {
  it('列出带 notion_id 列但未在注册表登记的表', async () => {
    const pool = { query: async (sql) => {
      if (/information_schema\.columns/.test(sql)) return { rows: [{ table_name: 'issues' }, { table_name: 'golden_path' }, { table_name: 'ability_groups' }] };
      if (/notion_projection_map/.test(sql)) return { rows: [{ brain_table: 'issues' }] };
      return { rows: [] };
    } };
    const missing = await findUnregisteredNotionTables(pool);
    expect(missing).toEqual(['ability_groups', 'golden_path']);
  });
});
