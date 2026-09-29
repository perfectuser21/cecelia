/**
 * 迁移 491 真库行为：在事务里重放 SQL（全部幂等），ROLLBACK 后不留痕。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(fileURLToPath(new URL('../../../migrations/491_skill_registry_ledger_columns.sql', import.meta.url)), 'utf8');
let pool;
beforeAll(async () => { pool = (await import('../../db.js')).default; });

async function inTx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); return await fn(c); } finally { await c.query('ROLLBACK'); c.release(); }
}

describe('migration 491 真库', () => {
  it('去 openclaw/ 前缀、记 renamed_from、带派发绑定的行先固定命令', async () => {
    await inTx(async (c) => {
      await c.query(`INSERT INTO skill_registry (name, status, task_types, metadata) VALUES
        ('openclaw/__m491_a__','active','{}','{}'),
        ('openclaw/__m491_b__','active',ARRAY['__m491_type__'],'{"category":"运维"}')`);
      await c.query(SQL);
      const { rows } = await c.query(`SELECT name, dispatch_command, metadata, category FROM skill_registry
        WHERE name IN ('__m491_a__','__m491_b__') ORDER BY name`);
      expect(rows.map((r) => r.name)).toEqual(['__m491_a__', '__m491_b__']);
      expect(rows[0].metadata.renamed_from).toBe('openclaw/__m491_a__');
      expect(rows[0].dispatch_command).toBeNull();
      expect(rows[1].dispatch_command).toBe('/openclaw/__m491_b__');
      expect(rows[1].category).toBe('运维');
    });
  });

  it('撞名的前缀行原样保留（不合并、不报错）', async () => {
    await inTx(async (c) => {
      await c.query(`INSERT INTO skill_registry (name, status) VALUES ('__m491_c__','active'), ('openclaw/__m491_c__','active')`);
      await c.query(SQL);
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM skill_registry WHERE name IN ('__m491_c__','openclaw/__m491_c__')`);
      expect(rows[0].n).toBe(2);
    });
  });

  it('presence 默认 unknown 且 CHECK 生效；注册表改入口面；重放幂等', async () => {
    await inTx(async (c) => {
      await c.query(SQL);
      await c.query(SQL);
      const { rows } = await c.query(`INSERT INTO skill_registry (name) VALUES ('__m491_d__') RETURNING presence, notion_baseline`);
      expect(rows[0].presence).toBe('unknown');
      expect(rows[0].notion_baseline).toEqual({});
      await expect(c.query(`UPDATE skill_registry SET presence='bogus' WHERE name='__m491_d__'`)).rejects.toThrow();
    });
    await inTx(async (c) => {
      await c.query(SQL);
      const { rows } = await c.query(`SELECT face, direction FROM notion_projection_map
        WHERE notion_db_id='353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table='skill_registry'`);
      if (rows.length) expect(rows[0]).toEqual({ face: 'inlet', direction: 'both' });
    });
  });
});
