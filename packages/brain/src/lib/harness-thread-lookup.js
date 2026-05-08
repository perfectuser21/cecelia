/**
 * harness-thread-lookup.js — LangGraph 修正 Sprint Stream 1
 *
 * 由 containerId 反查它对应的 LangGraph thread 与已编译 graph，
 * 给 callback router 用 `Command({resume:...})` 唤回 graph 续跑。
 *
 * 当前 Stream 1 只搭路由架子，返回 null（→ 404）。真实 mapping 在
 * Layer 3 spawn 节点重构时插入：spawn docker 时把 (containerId, threadId,
 * compiledGraph 标识) 写到 PG 表 harness_callback_lookups，本函数届时改为
 * SELECT 查询 + 按 graph kind 动态 import compileXxx 函数。
 *
 * 接口契约（不要变，下游 router 已按此 mock）：
 *   lookupHarnessThread(containerId)
 *     → null 表示找不到（router 应返回 404）
 *     → { compiledGraph, threadId } 表示成功，router 用它执行 resume
 */
export async function lookupHarnessThread(_containerId) {
  // Stub: Layer 3 spawn 重构会改成 PG 查询 + 动态 compile graph。
  // 当前 PR 只把路由架子打通，未知 containerId 一律返回 null（→ 404）。
  return null;
}
