import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDebt02MigrationFixture } from './helpers/debt-02-scratch.js';

let pool, fixture;
const migration = '289_decisions_notion_id.sql';
beforeAll(async () => {
  fixture = await createDebt02MigrationFixture(`
    CREATE TABLE decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE initiative_contracts(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  `, [migration]);
  pool = fixture.pool;
});
afterAll(async () => { await fixture?.close(); });

describe('Migration 289 — actual SQL upgrade and sync identity constraints', () => {
  it.each(['decisions', 'initiative_contracts'])('%s gains a bounded notion_id column', async (table) => {
    const { rows } = await pool.query(`SELECT data_type, character_maximum_length
      FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name=$1 AND column_name='notion_id'`, [table]);
    expect(rows).toEqual([{ data_type: 'character varying', character_maximum_length: 100 }]);
  });

  it.each(['decisions', 'initiative_contracts'])('%s rejects duplicate remote identities and accepts multiple unsynced rows', async (table) => {
    await pool.query(`INSERT INTO ${table}(notion_id) VALUES(NULL),(NULL),('debt02-notion-page')`);
    await expect(pool.query(`INSERT INTO ${table}(notion_id) VALUES('debt02-notion-page')`)).rejects.toMatchObject({ code: '23505' });
    const { rows } = await pool.query(`SELECT notion_id FROM ${table} WHERE notion_id IS NOT NULL`);
    expect(rows).toEqual([{ notion_id: 'debt02-notion-page' }]);
  });

  it('replays the formal migration without losing existing sync identities', async () => {
    await fixture.apply(migration);
    for (const table of ['decisions', 'initiative_contracts']) {
      expect((await pool.query(`SELECT notion_id FROM ${table} WHERE notion_id IS NOT NULL`)).rows)
        .toEqual([{ notion_id: 'debt02-notion-page' }]);
    }
  });
});
