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

/**
 * 更新某 harness thread 的生命周期状态。
 * @param {string} containerId  walking_skeleton_thread_lookup.container_id
 * @param {'spawning'|'running'|'completed'|'failed'} status
 */
export async function updateHarnessThreadStatus(containerId, status) {
  await pool.query(
    `UPDATE walking_skeleton_thread_lookup
        SET status = $2, updated_at = NOW()
      WHERE container_id = $1`,
    [containerId, status]
  );
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

  // B9 (Walking Skeleton P1 cascade fix):
  // PR #2901 加 evaluate_contract 节点（task sub-graph 内部）spawn evaluator container 时
  // 写 graph_name='harness-evaluate'，但 lookup 当时只 dispatch walking-skeleton-1node / harness-task →
  // unknown graph → 404 → callback 失配 → graph 永久卡 await_callback。W30 实证。
  // 修：harness-evaluate dispatch 到同一 compiledHarnessTask（evaluate_contract 节点在 task graph 内部）。
  if (graphName === 'harness-evaluate') {
    try {
      const compiledGraph = await getCompiledHarnessTask();
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile harness-evaluate (via task graph) failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }

  // B44: harness-gan 已改回同步，不再写 thread_lookup，此分支保留作兼容（返回 null 即可）
  if (graphName === 'harness-gan') {
    console.warn(`[harness-thread-lookup] harness-gan is now synchronous (B44), graph_name=${graphName} should not appear in thread_lookup`);
    return null;
  }

  // B44 fix: harness-initiative 用全图（compileHarnessFullGraph，executor 用的图）
  // 原来的 compileHarnessInitiativeGraph 只含 Phase A 节点，无法处理 callback resume
  if (graphName === 'harness-initiative') {
    try {
      const { compileHarnessFullGraph } = await import('../workflows/harness-initiative.graph.js');
      const compiledGraph = await compileHarnessFullGraph();
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile harness-initiative failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }

  // 未知 graph_name
  console.warn(`[harness-thread-lookup] unknown graph_name=${graphName} containerId=${containerId}`);
  return null;
}
