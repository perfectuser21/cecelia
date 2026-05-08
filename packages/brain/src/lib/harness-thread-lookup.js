/**
 * harness-thread-lookup.js — LangGraph 修正 Sprint Stream 1 + Stream 5 + Layer 3
 *
 * 由 containerId 反查它对应的 LangGraph thread 与已编译 graph，
 * 给 callback router 用 `Command({resume:...})` 唤回 graph 续跑。
 *
 * 表 walking_skeleton_thread_lookup 是通用的 harness thread mapping 表（命名遗留 Stream 5
 * walking-skeleton 实证；schema 通用，graph_name 字段区分 graph 类型）：
 *   - walking-skeleton-1node    Stream 5 端到端实证 graph
 *   - harness-task              Layer 3 真实生产 sub-task graph（spawn detached + interrupt）
 *
 * 流程：
 *   1. 查 walking_skeleton_thread_lookup 表（containerId → thread_id, graph_name）
 *   2. 按 graph_name dispatch compiledGraph
 *   3. 返回 { compiledGraph, threadId } 给 callback router
 *
 * 接口契约（callback router 按此实现）：
 *   lookupHarnessThread(containerId)
 *     → null 表示找不到（router 应返回 404）
 *     → { compiledGraph, threadId } 表示成功，router 用它执行 resume
 */
import pool from '../db.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import { getCompiledWalkingSkeleton } from '../workflows/walking-skeleton-1node.graph.js';
import { compileHarnessTaskGraph } from '../workflows/harness-task.graph.js';

// 模块缓存 harness-task compiled graph（PG checkpointer 单例下，只编一次）
let _compiledHarnessTask = null;
async function getCompiledHarnessTask() {
  if (_compiledHarnessTask) return _compiledHarnessTask;
  _compiledHarnessTask = await compileHarnessTaskGraph();
  return _compiledHarnessTask;
}

// 测试 hook
export function _resetHarnessTaskCacheForTests() {
  _compiledHarnessTask = null;
}

export async function lookupHarnessThread(containerId) {
  if (!containerId) return null;

  // Step 1: 查 walking_skeleton_thread_lookup 表（通用 mapping 表）
  let row;
  try {
    const r = await pool.query(
      `SELECT thread_id, graph_name FROM walking_skeleton_thread_lookup WHERE container_id = $1 LIMIT 1`,
      [containerId]
    );
    if (r.rows.length === 0) return null;
    row = r.rows[0];
  } catch (err) {
    console.error(`[harness-thread-lookup] PG query failed containerId=${containerId}: ${err.message}`);
    return null;
  }

  const { thread_id: threadId, graph_name: graphName } = row;

  // Step 2: dispatch 到对应 compiledGraph
  if (graphName === 'walking-skeleton-1node') {
    try {
      const checkpointer = await getPgCheckpointer();
      const compiledGraph = await getCompiledWalkingSkeleton(checkpointer);
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile walking-skeleton failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }

  if (graphName === 'harness-task') {
    try {
      const compiledGraph = await getCompiledHarnessTask();
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile harness-task failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }

  // 未知 graph_name
  console.warn(`[harness-thread-lookup] unknown graph_name=${graphName} containerId=${containerId}`);
  return null;
}
