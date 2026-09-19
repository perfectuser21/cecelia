/** 真库火：migration 453 后，凡带 notion_id 列的表都在注册表有一行（A7 registry_coverage 在干净库必须绿） */
import { describe, it, expect, beforeAll } from 'vitest';
import { findUnregisteredNotionTables } from '../../lib/notion-projection-registry.js';
let pool;
beforeAll(async () => { pool = (await import('../../db.js')).default; });
describe('注册表覆盖（一库多表）', () => {
  it('findUnregisteredNotionTables 为空', async () => {
    expect(await findUnregisteredNotionTables(pool)).toEqual([]);
  });
  it('AI Notes 同时登记 decisions 与 initiative_contracts（一库多表放开）', async () => {
    const { rows } = await pool.query(`SELECT brain_table FROM notion_projection_map WHERE notion_db_id='185c40c2-ba63-828c-973f-81a9c4582cd6' ORDER BY 1`);
    expect(rows.map(r => r.brain_table)).toEqual(['decisions', 'initiative_contracts', 'notes']);
  });
  it('454：AI Notes 第三根血管 routes/notes.js 登记在册（notes 表不存 notion_id，账实不可对）', async () => {
    const { rows } = await pool.query(`SELECT vessel, reconcile FROM notion_projection_map WHERE notion_db_id='185c40c2-ba63-828c-973f-81a9c4582cd6' AND brain_table='notes'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].vessel).toMatch(/routes\/notes\.js/);
  });
  it('454：设备清单不再指向不存在的 machines 表（真身是 phone-registry-mirror 脚本）', async () => {
    const { rows } = await pool.query(`SELECT brain_table, vessel FROM notion_projection_map WHERE notion_db_id='3d4c40c2-ba63-816d-b72d-d520f2cd090a'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].brain_table).toBeNull();
    expect(rows[0].vessel).toMatch(/phone-registry-mirror/);
  });
});
