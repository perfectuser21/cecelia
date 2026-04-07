# Sprint PRD

## 产品目标

Brain 任务执行完成后，result 字段长期为空 `{}`，导致 token 消耗和费用完全不可见。
本 sprint 目标：让每个任务完成时自动记录执行元数据（耗时、费用、轮次、token 量），用户和系统可通过现有 API 直接查询每个任务的真实消耗。

目标用户：Cecelia 系统运营者（Alex），需要了解 AI 执行成本和效率。

---

## 功能清单

- [ ] Feature 1：任务完成时自动写入执行元数据
  当任何 Brain 任务状态变为 `completed`，其 `result` 字段中自动包含本次执行的 `duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`。

- [ ] Feature 2：现有查询 API 透传 result 字段
  通过 `GET /api/brain/tasks/:id` 或 `GET /api/brain/tasks?status=completed` 查询任务时，返回的 JSON 中 `result` 字段包含上述执行元数据，无需额外端点。

- [ ] Feature 3：元数据与原有 result 内容合并，不覆盖
  若任务在完成时已有其他 `result` 内容（如 `pr_url`、`merged` 等），执行元数据追加进去，不替换原有字段。

---

## 验收标准（用户视角）

### Feature 1
- 用户在任务完成后，通过 API 查询该任务，`result` 字段不再是 `{}`，而是包含 `duration_ms`（整数，毫秒）、`total_cost_usd`（浮点数，美元）、`num_turns`（整数）、`input_tokens`（整数）、`output_tokens`（整数）。
- 若某项数据不可用（如 execution callback 未提供 token 信息），对应字段可为 `null`，但字段本身必须存在。

### Feature 2
- 用户调用 `GET /api/brain/tasks?status=completed&limit=5`，返回的每条任务 `result` 字段中可见执行元数据。
- 不需要调用任何新的 API 端点；现有查询路径即可获取数据。

### Feature 3
- 对于已有 `result.pr_url` 的任务，完成后 `result` 同时包含 `pr_url` 和执行元数据，两者并存。
- 不会出现因写入元数据而导致 `pr_url` 等原有字段丢失的情况。

---

## AI 集成点（如适用）

- 无需 AI 能力，纯数据传递与持久化。

---

## 不在范围内

- 不建新的统计/汇总 API（如"按日汇总费用"、"按 agent 汇总 token"）
- 不做 Dashboard 可视化展示
- 不对历史已完成任务做回填（只影响未来新完成的任务）
- 不修改任务 `status` 逻辑，不新增任务状态
- 不对 `total_cost_usd` 做货币换算或格式化展示
