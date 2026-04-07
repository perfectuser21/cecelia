# 合同草案（第 2 轮）

**Sprint**: Harness Sprint 3 — 执行成本追踪（token/cost 写入 DB）
**Generator**: P2（根据 Evaluator R1 反馈修订）

---

## 本次实现的功能

- **Feature 1**：`POST /api/brain/execution-callback` 接收含元数据的 result 对象时，将 5 个执行元数据字段写入任务的 `result` DB 列（JSON merge，保留已有字段）
- **Feature 2**：写入后可通过 `GET /api/brain/tasks/:id` 查询到 `result` 字段中的执行元数据
- **Feature 3**：`result` 字段中，5 个元数据键同时存在或同时不存在，不允许出现部分写入状态

---

## 验收标准（DoD）

### Feature 1：执行元数据经 execution-callback 写入 result 字段

**行为描述**：

- 当调用方向 `POST /api/brain/execution-callback` 发送包含 `result` 对象的 callback 时（`result` 中含 `duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens` 字段），Brain 将这 5 个字段合并写入对应任务的 `result` DB 列
- 当 `result` 对象中不包含上述 5 个字段时，`result` DB 列的写入行为不变（不应报错，不应覆盖已有内容）
- 当 callback 到达时任务已存在 `result` 数据（如 `pr_url`），合并后原有字段仍保留，不被清除

**硬阈值**：

- 向 `POST /api/brain/execution-callback` 发送含 5 个元数据字段的 result 后，立即查询 `GET /api/brain/tasks/:id`，`result` 字段必须包含全部 5 个键（`duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`）
- 若 callback 发送前任务 `result` 中已有 `pr_url` 字段，callback 后查询该任务，`pr_url` 字段仍存在

**验证前提**：

> Evaluator 可按以下方式构造验证场景：
> 1. 找一个状态为 `in_progress` 的任务（或创建测试任务），记录其 `task_id`
> 2. 用 curl 向 `POST /api/brain/execution-callback` 发送以下 payload：
>    ```json
>    {
>      "task_id": "<task_id>",
>      "status": "completed",
>      "result": {
>        "duration_ms": 12345,
>        "total_cost_usd": 0.002500,
>        "num_turns": 8,
>        "input_tokens": 15000,
>        "output_tokens": 3200
>      }
>    }
>    ```
> 3. 立即查询 `GET /api/brain/tasks/<task_id>`，检查 `result` 字段

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 2：通过 GET API 可查询执行元数据

**行为描述**：

- 当某任务已通过 execution-callback 写入执行元数据后，`GET /api/brain/tasks/:id` 返回的 `result` 字段中必须包含 5 个元数据键
- 批量查询接口（`GET /api/brain/tasks?status=completed`）返回的每条任务，若该任务是在本次 sprint 实现后通过 execution-callback 完成的，其 `result` 字段中必须包含 5 个元数据键
- API 响应时间 < 500ms（从 HTTP 请求发出到收到响应）

**硬阈值**：

- `GET /api/brain/tasks/:id` 返回 HTTP 200，`result` 字段为 JSON 对象，包含 `duration_ms`（整数 ≥ 0）、`total_cost_usd`（浮点数 ≥ 0）、`num_turns`（整数 ≥ 0）、`input_tokens`（整数 ≥ 0）、`output_tokens`（整数 ≥ 0）
- GET 接口响应时间 < 500ms

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 3：result 字段 5 个元数据键完整性约束（无部分写入）

**行为描述**：

- 对任意已完成任务，`result` 字段中的 5 个元数据键（`duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`）要么同时存在，要么同时不存在
- 不允许出现只有其中 1–4 个键的中间状态

**硬阈值**：

- 对通过 execution-callback 完成的任务，查询其 `result` 字段，统计上述 5 个键的存在数量，结果必须为 0 或 5，不能为 1–4
- 如果 callback payload 中 `result` 对象存在上述 5 个键中的任意一个，则全部 5 个键均必须写入（缺失字段以 `0` 填充，不允许漏写）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- 修改 `packages/brain/src/routes/execution.js` 的 `POST /execution-callback` 处理逻辑
- 在写入任务状态时，若 `result` 对象含元数据字段，执行 JSON merge（`jsonb_set` 或 `||` 操作符）将 5 个字段合并入 `result` DB 列
- 不替换整个 `result` 列（保留 `pr_url` 等已有字段）
- `total_cost_usd` 的计算逻辑：若调用方直接传入则使用，否则从 `input_tokens`/`output_tokens` 按模型定价估算

---

## 不在本次范围内

- `task_run_metrics` 表的改动（已有独立写入逻辑，本次不动）
- 历史已完成任务的 result 字段回填
- token 计费精确到缓存 token（cache_read_input_tokens 等）的分项追踪
- 新增 API 端点（只改现有 execution-callback 逻辑）
