/**
 * Database Configuration — Single Source of Truth
 *
 * All DB connections (db.js, migrate.js, selfcheck.js, tests) import from here.
 * Env vars override defaults. Defaults match .env.docker for safety.
 *
 * Test-mode guard（防本地测试污染生产 DB）:
 *   NODE_ENV=test 或 VITEST=true 时：
 *     - shell 未显式导出 DB_NAME → 强制用 cecelia_test（忽略 .env 里的 DB_NAME=cecelia）
 *     - shell 显式 DB_NAME=cecelia → throw（显式拒绝连生产）
 *     - shell 显式 DB_NAME=cecelia_test 或其它 → 按 shell 值走
 *   根因：integration test beforeEach DELETE/INSERT 会污染生产 brain_muted 等状态，
 *   Brain 重启后读到被污染数据恢复发通知。首次跑测试前先执行
 *   packages/brain/scripts/setup-test-db.sh 建本地 cecelia_test。
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 快照 shell 显式导出的 DB_NAME（在 dotenv 加载 .env 之前）。
// 用于区分"shell 显式"和".env 文件注入"——测试模式下前者受信，后者忽略。
const shellDbName = process.env.DB_NAME;

// Load .env from project root (../../.env relative to brain/src/)
// Only loads if env vars are not already set (Docker/CI won't be affected)
dotenv.config({ path: path.join(__dirname, '../../.env') });

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

// 测试模式：优先 shell 显式值，否则强制 cecelia_test（不回落到 .env 里的 cecelia）。
// 非测试模式：保持原逻辑（process.env.DB_NAME || 'cecelia'）。
const resolvedDbName = isTestEnv
  ? (shellDbName || 'cecelia_test')
  : (process.env.DB_NAME || 'cecelia');

if (isTestEnv && resolvedDbName === 'cecelia') {
  throw new Error(
    '[db-config] NODE_ENV=test 禁止连 cecelia 生产 DB。' +
    '解法：① 显式 export DB_NAME=cecelia_test  ' +
    '② 或跑 bash packages/brain/scripts/setup-test-db.sh 建本地测试 DB 后再跑测试。'
  );
}

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: resolvedDbName,
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '',
  // 连接池健康配置（R3）
  max: parseInt(process.env.DB_POOL_MAX || '30', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS || '5000', 10),
};
