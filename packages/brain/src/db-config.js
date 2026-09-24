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

// isTest 优先判断，用于 DB_NAME fallback 和 guard
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const dbName = process.env.DB_NAME || (isTest ? 'cecelia_test' : 'cecelia');

// Guard: 禁止测试环境连生产 DB
if (isTest && dbName === 'cecelia') {
  throw new Error(
    '禁止在测试环境连接 cecelia 生产 DB。\n' +
    '解决方式：\n' +
    '  1. 显式设置 DB_NAME=cecelia_test\n' +
    '  2. 或运行 bash packages/brain/scripts/setup-test-db.sh 首次创建本地测试 DB'
  );
}

// Guard: 禁止 dev 环境连生产 DB（刀2，2026-07-13 zenithjoy 拆库 P0 事故后补）
const isDev = process.env.NODE_ENV === 'development';
if (isDev && dbName === 'cecelia') {
  throw new Error(
    '禁止在 dev 环境连接 cecelia 生产 DB。\n' +
    '解决方式：显式设置 DB_NAME=cecelia_dev'
  );
}

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: dbName,
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '',
  // 连接池健康配置（R3）
  max: parseInt(process.env.DB_POOL_MAX || '30', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS || '5000', 10),
  // 客户端级查询超时（node-pg query_timeout，经 pg-pool 透传到 Client）。
  // 2026-09-24：notion-gtd-sync 一轮里某个 await 永不返回，循环卡死 8.4h——整轮唯一无界的
  // 就是 pg 查询（statement_timeout=0、keepalive 7200s）。超时后 pool 丢弃该连接，半死连接随之清出。
  // 取 10 分钟而非更短：主 pool 同时跑启动 runMigrations 与 preview-destroyer 的 pg_advisory_lock 等待。
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '600000', 10),
};
