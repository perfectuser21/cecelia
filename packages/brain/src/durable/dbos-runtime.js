/**
 * dbos-runtime.js
 *
 * DBOS durable 底座的生命周期 + env 门控。
 *
 * 设计要点（见 docs/superpowers/specs/2026-06-21-dbos-durable-foundation-design.md）：
 * - flag 门控：DBOS_DURABLE_ENABLED !== 'true' 时 isDurableEnabled() 返回 false，
 *   initDurable 不被调用，brain 行为零变化。
 * - 隔离形态：DBOS 系统表落 **cecelia 库的 `dbos` schema**（systemDatabaseUrl 指向
 *   cecelia 库本身 + systemDatabaseSchemaName='dbos' + custom pool 三件套），与 public
 *   里的业务表零冲突。回退 = DROP SCHEMA dbos CASCADE。
 * - 字段名铁律（已核 4.x 类型定义）：systemDatabaseUrl / systemDatabaseSchemaName /
 *   systemDatabasePool / systemDatabasePoolSize；没有 databaseUrl、没有 systemDatabaseSchema。
 *   必须显式给 systemDatabaseUrl 指向 cecelia 库，否则 DBOS 默认去连
 *   cecelia_brain_dbos_sys 独立库。
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';

let _launched = false;

/**
 * 是否启用 durable 底座。默认关（行为零变化）。
 * @returns {boolean}
 */
export function isDurableEnabled() {
  return process.env.DBOS_DURABLE_ENABLED === 'true';
}

/**
 * 构造指向 cecelia 库本身的连接串（DBOS 系统表落同库 dbos schema）。
 * @returns {string}
 */
export function ceceliaUrl() {
  return (
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'cecelia'}:${process.env.DB_PASSWORD || 'cecelia'}@${process.env.DB_HOST || 'host.docker.internal'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'cecelia'}`
  );
}

/**
 * 启动 DBOS。仅当 enabled 时由 caller 调用。
 * 失败 throw DBOSInitializationError —— 由 caller try/catch degrade，绝不阻断 brain 启动。
 */
export async function initDurable() {
  if (_launched) return;
  const url = ceceliaUrl();
  const sysPool = new pg.Pool({ connectionString: url, max: 5 });
  DBOS.setConfig({
    name: 'cecelia-brain',
    systemDatabaseUrl: url,
    systemDatabaseSchemaName: 'dbos',
    systemDatabasePool: sysPool,
    systemDatabasePoolSize: 5,
  });
  await DBOS.launch();
  _launched = true;
}

/**
 * 关闭 DBOS（已 launch 时）。
 */
export async function shutdownDurable() {
  if (!_launched) return;
  await DBOS.shutdown();
  _launched = false;
}

/**
 * server.js boot 接线逻辑（抽出便于单测）：flag 门控 + try/catch degrade。
 * flag 关 → no-op；flag 开 → 尝试 init，失败记日志但**绝不抛**（brain 继续启动，降级到非 durable）。
 *
 * @param {object} [opts]
 * @param {() => Promise<void>} [opts.init] - 注入的初始化函数（默认 initDurable，测试可 mock）
 * @returns {Promise<boolean>} 是否成功启动了 durable 底座
 */
export async function bootDurable({ init = initDurable } = {}) {
  if (!isDurableEnabled()) return false;
  try {
    await init();
    console.log('[startup] DBOS durable 已启动');
    return true;
  } catch (e) {
    console.error('[startup] DBOS initDurable 失败，degrade 到非 durable：', e.message);
    return false;
  }
}
