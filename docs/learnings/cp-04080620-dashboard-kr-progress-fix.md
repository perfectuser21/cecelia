# Learning: Dashboard KR 进度显示修复

## 背景

KR5 Dashboard 3 大模块的 RoadmapPage 和 OKRPage 中，KR 进度条全部显示 0%，SelfDrive 面板永远为空。

## 根本原因

### 根本原因

1. **进度字段不匹配**：Brain `/api/brain/goals` 返回 `current_value` 和 `metadata.metric_current`，但前端代码用 `g.progress`（undefined）。`g.progress ?? 0` 始终为 0。
2. **SelfDrive 事件类型不存在**：RoadmapPage 查询 `event_type=cycle_complete`，Brain 从未记录此类型（实际类型：`task_dispatched`、`routing_decision` 等）。

### 下次预防

- [ ] 接 Brain API 新端点前，先 `curl localhost:5221/api/brain/<endpoint>` 检查实际返回字段结构
- [ ] 进度/数值类字段：`g.progress` 不可靠，优先使用 `metadata.metric_current ?? current_value`
- [ ] 查询 Brain events 前，先检查 `?limit=5` 查看有哪些 `event_type` 实际存在
