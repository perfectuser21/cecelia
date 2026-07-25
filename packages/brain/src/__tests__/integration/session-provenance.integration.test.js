import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(__dirname, '../../../migrations/360_session_provenance.sql');
let pool;

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM session_provenance WHERE launched_by = 'session-provenance-integration'`);
});

describe('session_provenance migration（真 PostgreSQL）', () => {
  it('支持 human/machine、CHECK、UUID 与幂等重放', async () => {
    pool = (await import('../../db.js')).default;
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    await pool.query(sql);

    await pool.query(
      `INSERT INTO session_provenance(session_id, kind, launched_by)
       VALUES ('integration-human', 'human', 'session-provenance-integration')
       ON CONFLICT (session_id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO session_provenance(session_id, kind, launched_by, task_id)
       VALUES ('integration-machine', 'machine', 'session-provenance-integration',
               '00000000-0000-4000-8000-000000000001')
       ON CONFLICT (session_id) DO NOTHING`
    );
    await expect(pool.query(
      `INSERT INTO session_provenance(session_id, kind, launched_by)
       VALUES ('integration-invalid', 'robot', 'session-provenance-integration')`
    )).rejects.toMatchObject({ code: '23514' });

    const { rows } = await pool.query(
      `SELECT session_id, kind, launched_by, task_id
       FROM session_provenance
       WHERE session_id IN ('integration-human', 'integration-machine')
       ORDER BY session_id`
    );
    expect(rows).toEqual([
      {
        session_id: 'integration-human',
        kind: 'human',
        launched_by: 'session-provenance-integration',
        task_id: null,
      },
      {
        session_id: 'integration-machine',
        kind: 'machine',
        launched_by: 'session-provenance-integration',
        task_id: '00000000-0000-4000-8000-000000000001',
      },
    ]);
  });
});
