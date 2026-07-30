import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pool from '../../db.js';

const migrationUrl = new URL(
  '../../../migrations/377_initiative_run_insert_identity_lock.sql',
  import.meta.url,
);
const schema = `migration_377_${process.pid}_${randomUUID().replaceAll('-', '')}`;

let admin;

beforeAll(async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  admin = await pool.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`
    CREATE TABLE "${schema}".initiative_runs (
      id UUID PRIMARY KEY,
      initiative_id UUID NOT NULL,
      phase TEXT NOT NULL,
      orchestrator_version TEXT
    )
  `);
  await admin.query(`SET search_path TO "${schema}", public`);
  await admin.query(migration);
  await admin.query(migration);
});

afterAll(async () => {
  if (admin) {
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    admin.release();
  }
  await pool.end();
});

describe('migration 377 insert serialization [PostgreSQL]', () => {
  it('blocks an unmodified direct INSERT while the legacy full-id lock is held', async () => {
    const initiativeId = randomUUID();
    const legacyClient = await pool.connect();
    const directWriter = await pool.connect();
    try {
      await legacyClient.query('BEGIN');
      await legacyClient.query(`SET LOCAL search_path TO "${schema}", public`);
      await legacyClient.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`relay-initiative:${initiativeId}`],
      );

      await directWriter.query(`SET search_path TO "${schema}", public`);
      let settled = false;
      const insert = directWriter.query(
        `INSERT INTO initiative_runs
           (id,initiative_id,phase,orchestrator_version)
         VALUES ($1,$2,'planning','v2')`,
        [randomUUID(), initiativeId],
      ).then((result) => {
        settled = true;
        return result;
      });

      await new Promise(resolve => setTimeout(resolve, 75));
      expect(settled).toBe(false);

      await legacyClient.query('COMMIT');
      await expect(insert).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      if (!legacyClient.released) {
        await legacyClient.query('ROLLBACK').catch(() => {});
        legacyClient.release();
      }
      directWriter.release();
    }
  });
});
