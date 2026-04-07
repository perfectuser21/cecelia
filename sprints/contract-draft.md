# 合同草案（第 1 轮）

> Sprint: Harness Sprint 3 — 执行成本追踪（token/cost 写入 DB）
> Proposer Task: 7588d631-7b6a-4081-91cb-f355e7cc4222
> 生成时间: 2026-04-07

---

## 本次实现的功能

- Feature 1: 执行指标回写 payload.last_run_result
- Feature 2: 任务 API 直接返回执行成本指标

---

## 验收标准（DoD）

### Feature 1: 执行指标回写 payload.last_run_result

**行为描述**：
- 当 execution-callback 收到 `status=AI Done` 且 `result.usage` 中含有 token 数据时，`payload.last_run_result` 必须包含 `cost_usd`、`num_turns`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens` 字段
- 当 execution-callback 收到的 `result` 中没有 `usage` 字段时，上述指标字段为 `null`（不抛出异常，不破坏 `last_run_result` 其余字段）
- 当任务以 `failed` 状态结束时，`payload.last_run_result` 中同样写入已有的指标（如 `duration_ms`），缺失的 token/cost 字段为 `null`
- 当 `result.modelUsage` 中有多个模型时，取 `costUSD` 最高的模型作为 `model_id`，`cost_usd` 为所有模型费用之和（与 task_run_metrics 保持一致）

**硬阈值**：
- 执行完成后，`GET /api/brain/tasks/{id}` 返回体中 `payload.last_run_result.cost_usd` 必须存在（非 undefined），有 usage 时为数字，无 usage 时为 null
- 执行完成后，`payload.last_run_result.num_turns` 必须存在，有数据时为正整数，无数据时为 null
- 执行完成后，`payload.last_run_result.input_tokens` 必须存在，有数据时为非负整数，无数据时为 null
- 执行完成后，`payload.last_run_result.output_tokens` 必须存在，有数据时为非负整数，无数据时为 null
- `payload.last_run_result.cache_read_tokens` 和 `cache_creation_tokens` 存在（有数据时为非负整数，无数据时为 null）
- 无 usage 数据的失败任务：`last_run_result.cost_usd === null`，任务状态 = `failed`，不抛异常
- `payload.last_run_result` 的现有字段（`run_id`、`duration_ms`、`pr_url`、`completed_at`、`result_summary`）保持不变，不丢失

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 2: 任务 API 直接返回执行成本指标

**行为描述**：
- 当调用 `GET /api/brain/tasks/{id}` 时，响应 JSON 中的 `payload.last_run_result` 包含所有执行成本字段
- 当任务尚未完成（status=in_progress/queued）时，`payload.last_run_result` 为 null 或仅含部分字段，不报错

**硬阈值**：
- `GET /api/brain/tasks/{id}` 响应 HTTP 状态码 = 200，响应体含 `payload` 字段
- 已完成任务：`payload.last_run_result.cost_usd` 字段存在（null 或数字均合法，取决于是否有 usage 数据）
- 不需要额外 API 调用，无需 JOIN task_run_metrics（不新增端点，不修改 URL）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- 修改文件：`packages/brain/src/routes/execution.js`
- 位置：`lastRunResult` 对象构建处（约第 129 行），在 `duration_ms` 之后追加指标字段
- 提取逻辑复用 task_run_metrics 同款计算（约 309-376 行）
- 字段命名与 task_run_metrics 列名对齐：`cost_usd`、`num_turns`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`
- 无需 DB migration（写入 jsonb payload，无 schema 变更）

---

## 不在本次范围内

- 不修改 task_run_metrics 写入逻辑（已正确）
- 不新增 tasks 表列
- 不修改前端 Dashboard / API 路由
- 不追踪历史任务（仅从此次合并后的新任务起生效）
