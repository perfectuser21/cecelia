/**
 * Brain v2 L2 Orchestrator: PostgresSaver 单例工厂。
 *
 * 所有 .graph.js workflow 共用一个 pg checkpointer（Brain 进程生命周期一实例）。
 * 禁用 MemorySaver（spec §6 约束，C2 起 CI grep 守门）。
 *
 * 复用 Brain 主 DATABASE_URL；migration 244 已建 checkpoint 表，setup() 幂等作双保险。
 *
 * ── 连接超时硬化（GAN 容器退出后图可靠推进根因修复，2026-06-13）─────────────────
 * 根因：所有 harness graph 用 durability:'sync'，每个节点转换都同步 await 一次 checkpoint
 *   写入（PostgresSaver.put）。旧实现 fromConnString 工厂内部
 *   `new Pool({ connectionString })` —— 无 query_timeout / statement_timeout /
 *   connectionTimeoutMillis / keepAlive。GAN proposer/reviewer 容器 exit=0 后
 *   executeInDocker 已 return（`[spawn] end`），但紧接的 checkpoint 写入若卡在一条静默死掉
 *   的 TCP 连接上，put() 永不 resolve；此时容器内心跳已被 finally 清掉 → 图静默 → 只能等
 *   20min watchdog fresh-start（生产实测 reviewer 07:02:39 退出 → 24min 零日志 → watchdog）。
 * 修复：pool 注入 query_timeout（客户端定时器，连接静默死也强制 reject）+ statement_timeout
 *   （服务端）+ connectionTimeoutMillis + keepAlive。让 checkpoint await 必然 settle——成功，
 *   或报错走 LangGraph 错误/重试路径让图推进，不再静默无限挂起靠 watchdog 兜底。
 *   getPgCheckpointer 是全部 graph 的唯一 checkpointer 来源 → 单点修复覆盖所有 workflow。
 */
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const { Pool } = pg;

// query_timeout（客户端）是关键：即便 TCP 连接静默死掉、服务端 statement_timeout 永不到达，
// 客户端定时器仍会在 N ms 后 reject 该查询 → checkpoint 写入 await 必 settle。
// 默认值远大于正常 checkpoint 写入耗时（<1s），但远小于 20min watchdog 阈值，确保真挂起能
// 在 watchdog 兜底前自行 settle。env 可调（forensic / 慢盘场景放宽）。
const CKPT_QUERY_TIMEOUT_MS = parseInt(process.env.CECELIA_CKPT_QUERY_TIMEOUT_MS || '120000', 10);
const CKPT_STATEMENT_TIMEOUT_MS = parseInt(process.env.CECELIA_CKPT_STATEMENT_TIMEOUT_MS || '120000', 10);
const CKPT_CONNECTION_TIMEOUT_MS = parseInt(process.env.CECELIA_CKPT_CONNECTION_TIMEOUT_MS || '30000', 10);

let _singleton = null;
let _setupPromise = null;

/**
 * 构造 checkpointer 专用 pg pool（带查询/连接级超时 + keepAlive）。
 * 导出供测试断言与 buildPgCheckpointer 复用。构造 Pool 不会立即建连（pg 惰性连接）。
 * @param {string} connStr
 * @param {object} [overrides] 测试可覆盖（如更短的 timeout 加速断言）
 * @returns {import('pg').Pool}
 */
export function buildCheckpointerPool(connStr, overrides = {}) {
  return new Pool({
    connectionString: connStr,
    query_timeout: CKPT_QUERY_TIMEOUT_MS,
    statement_timeout: CKPT_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: CKPT_CONNECTION_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ...overrides,
  });
}

/**
 * 构造带超时硬化 pool 的 PostgresSaver（不调用 setup）。导出供测试。
 * 替代旧 fromConnString 工厂（其 pool 无任何超时 → 可无限挂起）。
 * @param {string} connStr
 * @returns {PostgresSaver}
 */
export function buildPgCheckpointer(connStr) {
  return new PostgresSaver(buildCheckpointerPool(connStr));
}

/**
 * 获取进程级单例 PostgresSaver。首次调用时 lazy init + setup()（幂等）。
 * @returns {Promise<PostgresSaver>}
 */
export async function getPgCheckpointer() {
  if (_singleton) {
    await _setupPromise;
    return _singleton;
  }
  const connStr = process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia';
  _singleton = buildPgCheckpointer(connStr);
  _setupPromise = _singleton.setup();
  await _setupPromise;
  return _singleton;
}

/**
 * 测试 hook：清单例。仅 __tests__ 使用，生产代码禁止调。
 */
export function _resetPgCheckpointerForTests() {
  _singleton = null;
  _setupPromise = null;
}
