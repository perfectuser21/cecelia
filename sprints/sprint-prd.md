# Sprint 3 PRD — 执行成本追踪（token/cost 写入 DB）

**Planner Task ID**: 122e677d-7cb3-4acb-a647-3548ca1a4e69  
**创建时间**: 2026-04-08  
**优先级**: P1

---

## 背景

Brain 任务执行后，`tasks.result` 字段对于 dev/research 等普通执行类任务几乎全部为空（null），导致：
- 无法追踪单次任务消耗的 token 数量和 USD 费用
- `task_run_metrics` 表虽存在，但 `input_tokens`/`output_tokens` 字段常为 null（解析路径错误）
- 没有 GET API 端点可按 task_id 查询执行指标
- Dashboard / 外部工具无法做成本分析

**根本原因（已通过代码审查确认）**：
1. `execution-callback` 中的 UPDATE SQL 含 `WHERE status = 'in_progress'` 约束，watchdog/rescue 路径提前移走任务状态后，execMetaJson 写入静默失败
2. `execMetaJson` 构建时，`input_tokens`/`output_tokens` 尝试读 `result.input_tokens`（顶层），但实际值在 `result.usage.input_tokens`

---

## 目标

1. **可靠性**：每次任务执行完成后，`tasks.result` 必定含有执行指标（duration_ms, total_cost_usd, num_turns, input_tokens, output_tokens）
2. **可查询性**：提供 `GET /api/brain/tasks/:id/metrics` 端点，返回任务执行成本
3. **不破坏现有流程**：task_run_metrics 现有写入逻辑不变，只补丁修复 token 解析路径

---

## 功能范围

### Feature A: 修复 execution-callback cost 写入路径

**范围**：`packages/brain/src/routes/execution.js`

1. **修复 token 解析**：`execMetaJson` 构建时从 `result.usage.input_tokens`、`result.usage.output_tokens` 读取（而非顶层）
2. **放宽 UPDATE 条件**：将 `execMetaJson` 写入拆为独立的 `UPDATE tasks SET result = ... WHERE id = $1`（不依赖 `status = 'in_progress'`），确保即使任务已被 watchdog 移走也能写入

### Feature B: GET /api/brain/tasks/:id/metrics 端点

**范围**：`packages/brain/src/routes/execution.js` 或 `packages/brain/src/routes/brain-meta.js`

返回：
```json
{
  "task_id": "uuid",
  "duration_ms": 47170,
  "total_cost_usd": 0.143973,
  "num_turns": 11,
  "input_tokens": 4234,
  "output_tokens": 2070,
  "cache_read_tokens": 0,
  "cache_creation_tokens": 0,
  "model_id": "claude-sonnet-4-6",
  "source": "task_run_metrics"
}
```

优先读 `task_run_metrics`，fallback 读 `tasks.result`。

---

## 成功标准

- `tasks.result` 对于所有完成任务（无论经过 watchdog 还是正常路径）均含 `duration_ms`, `total_cost_usd`, `num_turns`, `input_tokens`, `output_tokens`
- `GET /api/brain/tasks/:id/metrics` 返回 200 + 正确字段
- `task_run_metrics.input_tokens` / `output_tokens` 不再为 null（在有 usage 数据的情况下）

---

## 不在范围内

- Dashboard UI 改动
- 成本汇总/报表页面（GET /api/brain/metrics/summary 留给下一 sprint）
- 历史数据回填（只修复新数据写入路径）
