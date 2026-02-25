/* global process, console */
import 'dotenv/config';
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;

const pool = new Pool(DB_DEFAULTS);

// Log connection info for debugging (no password)
console.log('PostgreSQL pool configured:', {
  host: DB_DEFAULTS.host,
  port: DB_DEFAULTS.port,
  database: DB_DEFAULTS.database,
  user: DB_DEFAULTS.user
});

export default pool;
