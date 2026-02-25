/**
 * Migration Runner
 *
 * Reads brain/migrations/*.sql, applies them in order,
 * tracks applied versions in schema_version table.
 *
 * Usage:
 *   node src/migrate.js          # standalone
 *   import { runMigrations } from './src/migrate.js'  # programmatic
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Run all pending migrations against the given pool.
 * @param {pg.Pool} [externalPool] - optional pool; creates one if not provided
 * @returns {Promise<string[]>} list of applied version strings
 */
export async function runMigrations(externalPool) {
  const pool = externalPool || new Pool(DB_DEFAULTS);

  const client = await pool.connect();
  try {
    // Bootstrap: ensure schema_version table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version VARCHAR(10) PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Fetch already-applied versions
    const { rows: applied } = await client.query(
      'SELECT version FROM schema_version ORDER BY version'
    );
    const appliedSet = new Set(applied.map(r => r.version));

    // Discover migration files sorted by filename
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const newlyApplied = [];

    for (const file of files) {
      // Extract version number from filename (e.g. "005" from "005_schema_version_and_config.sql")
      const version = file.split('_')[0];
      if (appliedSet.has(version)) {
        console.log(`[SKIP] ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      const description = file.replace('.sql', '').replace(/^\d+_/, '');

      console.log(`[APPLY] ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        // Record in schema_version (the SQL itself may INSERT, use ON CONFLICT)
        await client.query(
          `INSERT INTO schema_version (version, description)
           VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
          [version, description]
        );
        await client.query('COMMIT');
        newlyApplied.push(version);
        console.log(`[DONE] ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[FAIL] ${file}:`, err.message);
        throw err;
      }
    }

    if (newlyApplied.length === 0) {
      console.log('[MIGRATE] All migrations already applied.');
    } else {
      console.log(`[MIGRATE] Applied ${newlyApplied.length} migration(s): ${newlyApplied.join(', ')}`);
    }

    return newlyApplied;
  } finally {
    client.release();
    // Only close pool if we created it
    if (!externalPool) await pool.end();
  }
}

// Allow standalone execution: node src/migrate.js
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runMigrations()
    .then(applied => {
      console.log(`Migration complete. Applied: ${applied.length}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
