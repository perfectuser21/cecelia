/**
 * Brain Startup Self-Check
 *
 * 6 checks that must pass before Brain starts serving traffic.
 * Any failure → process.exit(1).
 *
 * Usage:
 *   import { runSelfCheck } from './src/selfcheck.js';
 *   const ok = await runSelfCheck();
 *
 *   // Standalone:
 *   node src/selfcheck.js
 */

import crypto from 'crypto';

/** Must match the highest migration version in migrations/ */
export const EXPECTED_SCHEMA_VERSION = '054';

const CORE_TABLES = [
  'tasks',
  'goals',
  'projects',
  'working_memory',
  'cecelia_events',
  'decision_log',
  'daily_logs',
  'cortex_analyses',
];

/**
 * Run all 6 self-checks.
 * @param {object} pool - pg Pool instance
 * @param {object} [opts] - options
 * @param {string} [opts.envRegion] - override ENV_REGION (for testing)
 * @returns {Promise<boolean>} true if all checks pass
 */
export async function runSelfCheck(pool, opts = {}) {
  const envRegion = opts.envRegion ?? process.env.ENV_REGION;
  const results = [];
  let allPassed = true;

  function record(name, pass, detail) {
    const tag = pass ? '[PASS]' : '[FAIL]';
    results.push({ name, pass, detail });
    console.log(`  ${tag} ${name}${detail ? ': ' + detail : ''}`);
    if (!pass) allPassed = false;
  }

  console.log('\n=== Brain Self-Check ===\n');

  // 1. ENV_REGION must be 'us' or 'hk'
  const validRegions = ['us', 'hk'];
  record(
    'ENV_REGION',
    validRegions.includes(envRegion),
    envRegion ? `value="${envRegion}"` : 'not set'
  );

  // 2. DB connection test
  let dbConnected = false;
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    dbConnected = rows[0]?.ok === 1;
    record('DB Connection', dbConnected, dbConnected ? 'SELECT 1 OK' : 'unexpected result');
  } catch (err) {
    record('DB Connection', false, err.message);
  }

  // Short-circuit remaining checks if DB is down
  if (!dbConnected) {
    record('DB Region Match', false, 'skipped (no DB connection)');
    record('Core Tables', false, 'skipped (no DB connection)');
    record('Schema Version', false, 'skipped (no DB connection)');
    record('Config Fingerprint', false, 'skipped (no DB connection)');
    printSummary(results, allPassed);
    return false;
  }

  // 3. DB region matches ENV_REGION
  try {
    const { rows } = await pool.query(
      "SELECT value FROM brain_config WHERE key = 'region'"
    );
    const dbRegion = rows[0]?.value;
    const match = dbRegion === envRegion;
    record(
      'DB Region Match',
      match,
      `DB="${dbRegion}" ENV="${envRegion}"`
    );
  } catch (err) {
    record('DB Region Match', false, err.message);
  }

  // 4. Core tables exist
  try {
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
    `, [CORE_TABLES]);
    const found = new Set(rows.map(r => r.table_name));
    const missing = CORE_TABLES.filter(t => !found.has(t));
    record(
      'Core Tables',
      missing.length === 0,
      missing.length === 0
        ? `all ${CORE_TABLES.length} present`
        : `missing: ${missing.join(', ')}`
    );
  } catch (err) {
    record('Core Tables', false, err.message);
  }

  // 5. Schema version matches expected
  try {
    const { rows } = await pool.query(
      'SELECT MAX(version) AS max_ver FROM schema_version'
    );
    const maxVer = rows[0]?.max_ver;
    record(
      'Schema Version',
      maxVer === EXPECTED_SCHEMA_VERSION,
      `DB="${maxVer}" expected="${EXPECTED_SCHEMA_VERSION}"`
    );
  } catch (err) {
    record('Schema Version', false, err.message);
  }

  // 6. Config fingerprint (SHA-256 of DB_HOST+DB_PORT+DB_NAME+ENV_REGION)
  try {
    const fpInput = [
      process.env.DB_HOST || 'localhost',
      process.env.DB_PORT || '5432',
      process.env.DB_NAME || 'cecelia',
      envRegion || '',
    ].join(':');
    const fingerprint = crypto.createHash('sha256').update(fpInput).digest('hex').slice(0, 16);

    const { rows } = await pool.query(
      "SELECT value FROM brain_config WHERE key = 'config_fingerprint'"
    );

    if (rows.length === 0) {
      // First run: write fingerprint
      await pool.query(
        "INSERT INTO brain_config (key, value) VALUES ('config_fingerprint', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
        [fingerprint]
      );
      record('Config Fingerprint', true, `first run, stored "${fingerprint}"`);
    } else if (rows[0].value === fingerprint) {
      record('Config Fingerprint', true, `matches "${fingerprint}"`);
    } else {
      // Mismatch: warning + log event, but don't fail
      console.warn(`  [WARN] Config fingerprint changed: stored="${rows[0].value}" current="${fingerprint}"`);
      try {
        await pool.query(
          `INSERT INTO cecelia_events (event_type, source, payload)
           VALUES ('config_fingerprint_mismatch', 'selfcheck', $1)`,
          [JSON.stringify({ stored: rows[0].value, current: fingerprint })]
        );
      } catch { /* event logging is best-effort */ }
      record('Config Fingerprint', true, `mismatch (warning logged), stored="${rows[0].value}" current="${fingerprint}"`);
    }
  } catch (err) {
    record('Config Fingerprint', false, err.message);
  }

  printSummary(results, allPassed);
  return allPassed;
}

function printSummary(results, allPassed) {
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n=== Self-Check: ${passed}/${total} passed${allPassed ? ' ✓' : ' ✗'} ===\n`);
}

// Standalone execution: node src/selfcheck.js
import { fileURLToPath } from 'url';
import path from 'path';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();

  const { DB_DEFAULTS } = await import('./db-config.js');
  const pg = await import('pg');
  const pool = new pg.default.Pool(DB_DEFAULTS);

  const ok = await runSelfCheck(pool);
  await pool.end();
  process.exit(ok ? 0 : 1);
}
