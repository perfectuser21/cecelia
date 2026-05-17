import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';

const { Client } = pg;

describe('WS1 — initiative_run_events Migration [BEHAVIOR]', () => {
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
  });

  afterAll(async () => {
    await db.end().catch(() => {});
  });

  it('initiative_run_events 表存在且含 node/label/attempt/ts/status/verdict 列', async () => {
    await db.connect();
    const { rows } = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_run_events' ORDER BY ordinal_position"
    );
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toContain('node');
    expect(cols).toContain('label');
    expect(cols).toContain('attempt');
    expect(cols).toContain('ts');
    expect(cols).toContain('status');
    expect(cols).toContain('verdict');
    expect(cols).toContain('initiative_id');
  });

  it('initiative_run_events 允许插入 node_update 行并返回自增 id', async () => {
    const { rows } = await db.query(
      `INSERT INTO initiative_run_events (initiative_id, node, label, attempt)
       VALUES ($1, 'proposer', 'Proposer', 1) RETURNING id`,
      ['aaaaaaaa-bbbb-cccc-dddd-ee0000000099']
    );
    expect(rows[0].id).toBeGreaterThan(0);
  });
});
