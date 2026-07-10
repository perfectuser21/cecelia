/**
 * zenithjoy-db.js — zenithjoy 库独立连接池（拆库刀1，决策 0710 环境隔离）
 *
 * 背景：cecelia 库曾同时装着 Cecelia 生产（public/dbos）和 ZenithJoy 生产（zenithjoy schema）。
 * Brain 在 content_publish 回调里跨 schema 写 zenithjoy.works / zenithjoy.publish_logs——
 * 这是两产品唯一的运行时 DB 耦合点。拆库后该路径必须指向独立 zenithjoy 库。
 *
 * 切换协议（向后兼容）：
 *   - ZENITHJOY_DB_NAME 未设 → 返回 Brain 主 pool（行为与拆库前完全一致，本 PR 合并即安全）
 *   - ZENITHJOY_DB_NAME 已设 → 懒初始化独立 Pool；host/port/user/password 可用
 *     ZENITHJOY_DB_HOST/PORT/USER/PASSWORD 覆盖，未覆盖项回落 DB_DEFAULTS 同名配置
 *
 * ⚠️ zenithjoy.publish_logs 的表结构以 ZJ repo apps/api/db/migrations 为准；
 *    brain/migrations/277 是历史双写残留，迁库后不再作为该表定义来源。
 */
import pg from 'pg';
import defaultPool from './db.js';
import { DB_DEFAULTS } from './db-config.js';

let _zjPool = null;

export function getZenithjoyPool() {
  if (!process.env.ZENITHJOY_DB_NAME) return defaultPool;
  if (!_zjPool) {
    _zjPool = new pg.Pool({
      ...DB_DEFAULTS,
      database: process.env.ZENITHJOY_DB_NAME,
      host: process.env.ZENITHJOY_DB_HOST || DB_DEFAULTS.host,
      port: parseInt(process.env.ZENITHJOY_DB_PORT || String(DB_DEFAULTS.port), 10),
      user: process.env.ZENITHJOY_DB_USER || DB_DEFAULTS.user,
      password: process.env.ZENITHJOY_DB_PASSWORD ?? DB_DEFAULTS.password,
    });
    _zjPool.on('error', (err) => {
      console.error('[zenithjoy-db] pool error:', err.message);
    });
  }
  return _zjPool;
}

/** 测试专用：重置 memoize（vitest 各 case 间隔离） */
export function _resetZenithjoyPoolForTest() {
  _zjPool = null;
}
