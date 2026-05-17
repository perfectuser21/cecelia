# Learning: 重构 monitor-loop.gatherFailureContext

**Branch**: cp-04032215-853d9f28-e411-4165-9dff-725207
**Date**: 2026-04-03

### 根本原因

`gatherFailureContext` 圈复杂度高达 25，原因是将三个独立的 DB 查询逻辑（task 元数据、run payload、相似失败统计）全部嵌套在同一个函数内，加上多层 `if` + `try/catch` 导致分支路径暴增。

### 重构策略

提取三个独立的子函数，每个子函数专注单一职责：
- `fetchTaskMeta(taskId)` — 查 tasks 表
- `fetchRunPayload(runId)` — 查 run_events payload
- `fetchSimilarFailures(reasonCode)` — 统计近 24h 同类失败

主函数 `gatherFailureContext` 退化为：构建 ctx 基础对象 + 顺序调用三个子函数 + 一个 try/catch，复杂度从 25 降至 ~5。

### 下次预防

- [ ] 单个函数超过 30 行且含多个 `if` 嵌套时，优先考虑拆分而非注释
- [ ] 每个 DB 查询封装成独立函数，返回具名结构体（而非直接修改外部 ctx）
- [ ] 早返回（`if (!x) return {}`）比深层嵌套更可读
