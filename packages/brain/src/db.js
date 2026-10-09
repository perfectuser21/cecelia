import 'dotenv/config';
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;

// OID 1114 = timestamp without time zone。Postgres 对这个类型输出的文本从不带时区
// 后缀，node-pg 默认解析器（postgres-date）解析不到偏移量时会落进
// `new Date(year, month, day, ...)` 分支，用进程本地时区（容器 TZ=Asia/Shanghai）
// 解释这些数字——但生产 DB 会话时区是 UTC，这些裸数字本来就是 UTC 时刻，被当成
// 上海时间解析后读出来的 JS Date 比真实时刻早 8 小时（任务 19684870，历史事故
// 87c9a08b：任务刚启动就被判超时，根因就在这里）。显式按 UTC 解析，堵死这条误判路径。
pg.types.setTypeParser(1114, (val) => (val === null ? null : new Date(`${val.replace(' ', 'T')}Z`)));

const pool = new Pool(DB_DEFAULTS);

// Log connection info for debugging (no password)
console.log('PostgreSQL pool configured:', {
  host: DB_DEFAULTS.host,
  port: DB_DEFAULTS.port,
  database: DB_DEFAULTS.database,
  user: DB_DEFAULTS.user,
  max: DB_DEFAULTS.max,
  idleTimeoutMillis: DB_DEFAULTS.idleTimeoutMillis,
  connectionTimeoutMillis: DB_DEFAULTS.connectionTimeoutMillis,
  query_timeout: DB_DEFAULTS.query_timeout,
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
