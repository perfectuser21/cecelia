/* global process, console */
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || 'CeceliaUS2026'
});

// Lazy connection - will connect on first query
// Log connection info for debugging
console.log('PostgreSQL pool configured:', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia'
});

export default pool;
