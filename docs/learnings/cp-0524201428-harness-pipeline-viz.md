# Learning: Harness Pipeline WS 进度可视化

## 根本原因

harness_initiative 任务的 WS 进度存储在 `checkpoint_blobs` 表（thread_id: `harness-task:{id}:{ws_id}`），但 `harness-pipelines` API 原来不暴露 `task_type` 字段，也没有 WS 进度端点，导致 Dashboard 无法区分 harness_initiative 与其他任务类型，无法展示各 WS 状态。

## 修复

1. `buildPipelineRecord`（status.js）加 `task_type: task.task_type` — 前端能判断是否是 harness_initiative
2. 新增 `WsProgressSection` 组件 — 按需调用 `/api/brain/harness/initiative/:id/ws-progress`（WS1 实现），展示各 WS 的状态 / evaluate_verdict / PR 链接
3. `WsWorkstream` interface 对应 ws-progress 端点的响应结构

## 下次预防

- [ ] harness-pipelines API 返回 task_type，便于前端区分 initiative vs planner
- [ ] WS 进度组件仅在 `task_type === 'harness_initiative'` 时渲染，避免无效 API 调用
- [ ] WsProgressSection 使用 cancelled 标志防止组件卸载后 setState
