import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

let scoped, admin, schema;
export const pool = {
  query: (...args) => {
    if (!scoped) throw new Error('debt-11 fixture not initialized');
    return scoped.query(...args);
  },
  end: async () => {}, // Fixture lifetime belongs to closeFixture, not per-case cleanup.
  connect: (...args) => scoped.connect(...args),
};
export async function migrate(file) {
  await pool.query(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'));
}
export async function openFixture(label, files = [], prerequisites = '') {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL must identify a private cecelia_scratch cluster');
  const url = new URL(raw);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/cecelia_scratch' || !url.port || url.port === '5432') {
    throw new Error('debt-11 refuses non-private scratch endpoint');
  }
  admin = new pg.Pool({ connectionString: raw });
  const { rows: [identity] } = await admin.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== Number(url.port)) {
    throw new Error('scratch identity mismatch');
  }
  schema = `debt_11_${label}_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  scoped = new pg.Pool({ connectionString: raw, options: `-c search_path=${schema}` });
  await pool.query('CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamptz DEFAULT now())');
  if (prerequisites) await pool.query(prerequisites);
  for (const file of files) await migrate(file);
  console.info('debt-11 private fixture', { ...identity, schema });
}
export async function closeFixture() {
  if (scoped) await scoped.end();
  if (admin) {
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
  scoped = admin = schema = undefined;
}
