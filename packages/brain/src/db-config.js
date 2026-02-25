/**
 * Database Configuration — Single Source of Truth
 *
 * All DB connections (db.js, migrate.js, selfcheck.js, tests) import from here.
 * Env vars override defaults. Defaults match .env.docker for safety.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (../../.env relative to brain/src/)
// Only loads if env vars are not already set (Docker/CI won't be affected)
dotenv.config({ path: path.join(__dirname, '../../.env') });

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '',
};
