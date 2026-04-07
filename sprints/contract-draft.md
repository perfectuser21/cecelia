# 合同草案（第 3 轮）

**Sprint**: Harness Sprint 3 — 执行成本追踪（token/cost 写入 DB）
**Generator**: P3（根据 Evaluator R2 反馈修订）

---

## 变更说明（vs R2）

1. **[矛盾消解] Feature 1 与 Feature 3 统一采用方案 A**：仅当 callback `result` 中同时包含全部 5 个字段时才写入，否则忽略（不补 0、不部分写入）
2. **[补验证路径] Feature 3 新增"部分键时不写入"场景验证步骤**
3. **[可选改进 1] Feature 1 补充 POST 成功响应格式判断**
4. **[可选改进 2] `total_cost_usd` 估算路径明确列入"不在范围内"**

---

## 本次实现的功能

- **Feature 1**：`POST /api/brain/execution-callback` 接收含全部 5 个执行元数据字段的 result 对象时，将这 5 个字段合并写入任务的 `result` DB 列（JSON merge，保留已有字段）
- **Feature 2**：写入后可通过 `GET /api/brain/tasks/:id` 查询到 `result` 字段中的执行元数据
- **Feature 3**：`result` 字段中，5 个元数据键要么同时全部存在，要么全部不存在，不允许出现 1–4 个键的中间状态

---

## 验收标准（DoD）

### Feature 1：执行元数据经 execution-callback 写入 result 字段

**行为描述**：

- 当调用方向 `POST /api/brain/execution-callback` 发送包含 `result` 对象的 callback，且 `result` 中**同时包含全部 5 个字段**（`duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`）时，Brain 将这 5 个字段合并写入对应任务的 `result` DB 列
- 当 `result` 对象中**不完整包含**上述 5 个字段（缺少任意一个或全部不含）时，Brain **忽略整个元数据写入操作**，`result` DB 列不发生任何变化
- 当 callback 到达时任务已存在 `result` 数据（如 `pr_url`），合并后原有字段仍保留，不被清除

**硬阈值**：

- 向 `POST /api/brain/execution-callback` 发送含全部 5 个元数据字段的 result，接口返回 HTTP 200，响应体包含 `status: "completed"`（或 `status: "success"`）字段
- 立即查询 `GET /api/brain/tasks/:id`，`result` 字段必须包含全部 5 个键（`duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`）
- 若 callback 发送前任务 `result` 中已有 `pr_url` 字段，callback 后查询该任务，`pr_url` 字段仍存在

**验证步骤（供 Evaluator 参考）**：

> 1. 找一个状态为 `in_progress` 的任务，记录其 `task_id`
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
> 3. 验证 HTTP 响应 200，响应体含 `status` 字段
> 4. 立即查询 `GET /api/brain/tasks/<task_id>`，检查 `result` 字段包含全部 5 个键

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 2：通过 GET API 可查询执行元数据

**行为描述**：

- 当某任务已通过 execution-callback 写入执行元数据后，`GET /api/brain/tasks/:id` 返回的 `result` 字段中必须包含 5 个元数据键
- API 响应时间 < 500ms（从 HTTP 请求发出到收到响应）

**硬阈值**：

- `GET /api/brain/tasks/:id` 返回 HTTP 200，`result` 字段为 JSON 对象，包含 `duration_ms`（整数 ≥ 0）、`total_cost_usd`（浮点数 ≥ 0）、`num_turns`（整数 ≥ 0）、`input_tokens`（整数 ≥ 0）、`output_tokens`（整数 ≥ 0）
- GET 接口响应时间 < 500ms

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 3：result 字段 5 个元数据键完整性约束（无部分写入、无补 0）

**行为描述**：

- 当 callback `result` 中同时包含全部 5 个键时，写入全部 5 个键
- 当 callback `result` 中**只包含部分键**（1–4 个）时，**不写入任何一个键**，`result` 字段保持不变
- 对任意已完成任务，`result` 字段中的 5 个元数据键要么同时存在，要么同时不存在，不允许出现 1–4 个键的中间状态

**硬阈值**：

- 对通过 execution-callback 完成的任务，查询其 `result` 字段，统计上述 5 个键的存在数量，结果必须为 0 或 5，不能为 1–4
- 向 `POST /api/brain/execution-callback` 发送只含部分元数据字段的 result 后，查询任务的 `result` 字段，上述 5 个键**全部不存在**

**验证步骤（partial keys 路径，供 Evaluator 参考）**：

> 1. 创建一个新的测试任务（状态 `in_progress`），记录 `task_id`（确保初始 `result` 为空或仅含非元数据字段）
> 2. 向 `POST /api/brain/execution-callback` 发送**只含 `duration_ms` 的** result：
>    ```json
>    { "task_id": "<id>", "status": "completed", "result": { "duration_ms": 9999 } }
>    ```
> 3. 查询 `GET /api/brain/tasks/<id>`，验证 `result` 中：
>    - `total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens` 均**不存在**（或仍为初始值）
>    - `duration_ms` 也**不存在**（因为只有 partial keys，整体忽略）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- 修改 `packages/brain/src/routes/execution.js` 的 `POST /execution-callback` 处理逻辑
- 写入前先检查：`result` 对象是否同时包含全部 5 个字段；若否，跳过元数据写入
- 若全部 5 个字段存在，执行 JSON merge（PostgreSQL `||` 操作符）将 5 个字段合并入 `result` DB 列，不替换整个 `result` 列

---

## 不在本次范围内

- `task_run_metrics` 表的改动（已有独立写入逻辑，本次不动）
- 历史已完成任务的 result 字段回填
- token 计费精确到缓存 token（`cache_read_input_tokens` 等）的分项追踪
- 新增 API 端点（只改现有 execution-callback 逻辑）
- **`total_cost_usd` 从 token 数估算的逻辑**（本 sprint 不实现；若 callback 未传入 `total_cost_usd`，则该字段值以 callback 传入的值为准；估算逻辑留待后续 sprint）
