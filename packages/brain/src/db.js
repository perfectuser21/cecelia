import 'dotenv/config';
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;

const pool = new Pool(DB_DEFAULTS);

// Log connection info for debugging (no password).
// 用 stderr 而非 stdout：避免污染 `TID=$(node -e '...import db.js...process.stdout.write(id)')`
// 这类命令替换捕获（harness DoD/E2E 依赖纯净 stdout 拿 task id）。
console.error('PostgreSQL pool configured:', {
  host: DB_DEFAULTS.host,
  port: DB_DEFAULTS.port,
  database: DB_DEFAULTS.database,
  user: DB_DEFAULTS.user,
  max: DB_DEFAULTS.max,
  idleTimeoutMillis: DB_DEFAULTS.idleTimeoutMillis,
  connectionTimeoutMillis: DB_DEFAULTS.connectionTimeoutMillis,
});

/**
 * 获取连接池健康指标（R3）
 * @returns {{ total: number, idle: number, waiting: number, activeCount: number }}
 */
export function getPoolHealth() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    activeCount: pool.totalCount - pool.idleCount,
  };
}

export default pool;
