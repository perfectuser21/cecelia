# Learning — Stream 5 Walking Skeleton 1 节点 demo

**Branch**: cp-0508120000-lg-stream5-walking-skeleton
**Date**: 2026-05-08
**Sprint**: LangGraph 修正 sprint（5 stream 中的最后一棒）

## 目标

端到端实证：LangGraph 节点 spawn docker → interrupt → 等 callback → Command(resume) → graph 完成 真的跑得通，包括 brain kill 后 graph 从 PG checkpointer 恢复。

## 做了什么

1. 新建 `walking-skeleton-1node.graph.js` — 3 节点最小图（spawn / await_callback / finalize）
2. 新建 `routes/walking-skeleton.js` — trigger + status 两个 endpoint
3. 新增 PG 表 `walking_skeleton_thread_lookup`（migration 269）— containerId → thread_id mapping
4. 把 Stream 1 留的 `lib/harness-thread-lookup.js` stub 真实化（查上述表 + dispatch graph）
5. server.js 注册路由
6. smoke 含 Phase 1 正常 e2e + Phase 2 brain kill resume 实证
7. 4 case 单测覆盖 graph build / compile / spawn-interrupt / callback-resume

## 根本原因（上一轮翻车点）

之前 LangGraph 节点内 `await spawn(longTask)` 长任务 — brain 重启时 in-flight Promise 全丢，state 不在 checkpointer 里（节点未结束就没 checkpoint），重启后 graph 不知道在哪重新开始。结果：harness/dev 一旦 brain 重启全部走丢。

正确模式（本 stream 实证）：
- spawn docker 后**立即** return（不 await 容器跑完）
- 下一节点 `interrupt()` yield，state 落 PG checkpointer
- 容器跑完 POST callback router → router 用 `Command({resume:...})` 唤回 graph
- 即使 brain 在 callback 到达前重启，PG checkpointer 里 state 还在，新 brain 起来后接收 callback → resume → graph 续跑

## 下次预防

- [ ] 任何 spawn docker / 长任务节点都用 spawn-and-interrupt 模式（不要节点内 await）
- [ ] callback router (Stream 1) + thread lookup 表是基础设施，新 graph 只要按 `(containerId, thread_id, graph_name)` 写表就能拿到自动 resume
- [ ] smoke 必须含 brain kill resume 测试（不只是正常 e2e），否则永远验证不了 PG checkpointer 真在工作
- [ ] LangGraph 1.x `interrupt()` 必须配 `compile({checkpointer})` 才能用，PG checkpointer 单例在 `orchestrator/pg-checkpointer.js`
- [ ] sibling container 走 `host.docker.internal:5221` 访问宿主 brain（OrbStack 原生支持）
- [ ] busybox wget `--post-data` 够用，不必装 curl（alpine 镜像够小）

## 副产物 / 其他注意

- **Worktree 在工作中被外部清理一次**（45 分钟空闲后），手动 `git worktree add` 重建后 npm ci 重装、Green 阶段重写。Red commit 因为已经 push 在分支上才得以保留 — 教训：每个独立 commit 都立刻确保 push 上去比较稳。
- selfcheck.js EXPECTED_SCHEMA_VERSION 268 → 269 同时改了 selfcheck.test.js + learnings-vectorize.test.js 两处硬编码（CI 强校验）。
- task_events 表 task_id 字段是 UUID，walking-skeleton triggerId 用 `randomUUID()` 直接兼容。
