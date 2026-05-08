/**
 * harness-thread-lookup.js — LangGraph 修正 Sprint Stream 1 + Stream 5
 *
 * 由 containerId 反查它对应的 LangGraph thread 与已编译 graph，
 * 给 callback router 用 `Command({resume:...})` 唤回 graph 续跑。
 *
 * Stream 5 起本函数真实化（之前 Stream 1 是 stub）：
 *   1. 查 walking_skeleton_thread_lookup 表（containerId → thread_id, graph_name）
 *   2. 按 graph_name 拿对应 compiledGraph（当前只有 walking-skeleton-1node）
 *   3. 返回 { compiledGraph, threadId } 给 callback router
 *
 * Layer 3 真实 spawn 重构会扩展：
 *   - 加 harness-task / dev-task / pipeline 等 graph_name 的 dispatch
 *   - 把 walking-skeleton-1node 表换成更通用的 harness_callback_lookups 表
 *
 * 接口契约（callback router 已按此 mock）：
 *   lookupHarnessThread(containerId)
 *     → null 表示找不到（router 应返回 404）
 *     → { compiledGraph, threadId } 表示成功，router 用它执行 resume
 */
import pool from '../db.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import { getCompiledWalkingSkeleton } from '../workflows/walking-skeleton-1node.graph.js';

export async function lookupHarnessThread(containerId) {
  if (!containerId) return null;

  // Step 1: 查 walking_skeleton_thread_lookup 表
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
      console.error(`[harness-thread-lookup] compile failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }

  // Layer 3 future: harness-task / dev-task / pipeline 等
  console.warn(`[harness-thread-lookup] unknown graph_name=${graphName} containerId=${containerId}`);
  return null;
}
