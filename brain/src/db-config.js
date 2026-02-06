/**
 * Database Configuration — Single Source of Truth
 *
 * All DB connections (db.js, migrate.js, selfcheck.js, tests) import from here.
 * Env vars override defaults. Defaults match .env.docker for safety.
 */

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || 'CeceliaUS2026',
};
