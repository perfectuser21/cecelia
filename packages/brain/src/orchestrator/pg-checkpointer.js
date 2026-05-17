/**
 * Brain v2 L2 Orchestrator: PostgresSaver 单例工厂。
 *
 * 所有 .graph.js workflow 共用一个 pg checkpointer（Brain 进程生命周期一实例）。
 * 禁用 MemorySaver（spec §6 约束，C2 起 CI grep 守门）。
 *
 * 复用 Brain 主 DATABASE_URL；migration 244 已建 checkpoint 表，setup() 幂等作双保险。
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

let _singleton = null;
let _setupPromise = null;

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
  _singleton = PostgresSaver.fromConnString(connStr);
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
