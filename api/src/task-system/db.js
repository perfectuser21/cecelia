import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }
  console.log('Connected to PostgreSQL cecelia_tasks database');
});

export default pool;
