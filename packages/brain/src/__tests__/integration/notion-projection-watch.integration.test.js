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
    expect(rows.map(r => r.brain_table)).toEqual(['decisions', 'initiative_contracts']);
  });
});
