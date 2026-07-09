import { describe, it, expect, beforeAll } from 'vitest';
let pool;

beforeAll(async () => {
  pool = (await import('../db.js')).default;
});

describe('migration 325: advancement_items journey_id + ability_id nullable', () => {
  it('advancement_items has a journey_id column referencing journeys', async () => {
    const result = await pool.query(`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'advancement_items' AND column_name = 'journey_id'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('advancement_items.ability_id is nullable', async () => {
    const result = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'advancement_items' AND column_name = 'ability_id'
    `);
    expect(result.rows[0].is_nullable).toBe('YES');
  });

  it('advancement_items.journey_id has a foreign key to journeys', async () => {
    const result = await pool.query(`
      SELECT tc.constraint_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'advancement_items'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'journey_id'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});
