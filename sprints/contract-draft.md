# 合同草案（第 1 轮）

## 本次实现的功能

- Feature 1：任务完成时自动写入执行元数据（duration_ms、total_cost_usd、num_turns、input_tokens、output_tokens）
- Feature 2：现有查询 API 透传 result 字段，无需新端点
- Feature 3：执行元数据与原有 result 内容合并，不覆盖已有字段

---

## 验收标准（DoD）

### Feature 1：任务完成时自动写入执行元数据

**行为描述**：

- 当 Brain 任务状态变为 `completed` 时，系统自动将执行元数据写入该任务的 `result` 字段
- 元数据包含以下 5 个字段：`duration_ms`（整数，毫秒）、`total_cost_usd`（浮点数，美元）、`num_turns`（整数）、`input_tokens`（整数）、`output_tokens`（整数）
- 当某项数据在执行回调中不可用时，对应字段值为 `null`，但字段键名必须存在于 `result` 对象中
- 当任务由于非正常完成路径（如超时强制置为 completed）时，元数据字段同样写入（可全为 null），不跳过写入步骤
- 当同一任务被多次调用 complete 逻辑（重复触发）时，后次写入覆盖前次，不产生异常

**硬阈值**：

- DB 中已完成任务的 `result` 字段必须包含以下所有键：`duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`（缺少任意一个键视为不通过）
- `duration_ms` 若可用，必须为非负整数（>= 0）
- `total_cost_usd` 若可用，必须为非负浮点数（>= 0.0），精度不低于 6 位小数
- `num_turns` 若可用，必须为正整数（>= 1）
- `input_tokens` 和 `output_tokens` 若可用，必须为非负整数（>= 0）
- 元数据写入操作不得导致任务状态从 `completed` 回退为其他状态
- 写入操作完成后，DB 中 `result` 字段更新延迟 < 500ms（从状态变更触发到 DB 写入完成）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 2：现有查询 API 透传 result 字段

**行为描述**：

- 当调用 `GET /api/brain/tasks/:id` 查询单个已完成任务时，返回 JSON 中 `result` 字段包含执行元数据
- 当调用 `GET /api/brain/tasks?status=completed` 批量查询时，返回列表中每条任务的 `result` 字段均包含执行元数据（若该任务是在本次 sprint 实现后完成的）
- 当 `result` 字段在 DB 中存储为 JSON 对象时，API 返回原始结构，不做任何截断或过滤
- 当请求不存在的任务 ID 时，API 返回 404，不崩溃

**硬阈值**：

- `GET /api/brain/tasks/:id` 响应体中 `result` 字段的数据类型必须为 JSON 对象（`{}`），不得为字符串或 null
- `GET /api/brain/tasks?status=completed&limit=5` 返回的每条记录中 `result` 字段必须存在（即使为空对象）
- API 响应时间 < 500ms（正常负载下，不包含 DB 冷启动）
- 响应 HTTP 状态码：查询成功为 200，不存在为 404，服务器错误为 5xx（不能以 200 返回错误内容）
- 不得新增任何 API 端点；必须通过现有路由路径返回数据

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 3：元数据与原有 result 内容合并，不覆盖

**行为描述**：

- 当任务完成时其 `result` 字段已包含 `pr_url`、`merged` 等字段，执行元数据追加进去，原有字段保持不变
- 当原有 `result` 为空对象 `{}` 时，写入后 `result` 仅包含执行元数据字段
- 当原有 `result` 包含与元数据同名的字段（如已有 `duration_ms`）时，元数据中的新值覆盖旧值（以执行回调提供的数据为准）
- 当原有 `result` 为 `null` 或非对象类型时，系统将其视为 `{}`，正常写入元数据，不崩溃

**硬阈值**：

- 写入元数据后，原有 `result.pr_url` 字段值必须与写入前完全一致（字符串内容不变）
- 写入元数据后，原有 `result.merged` 字段值必须与写入前完全一致（布尔值不变）
- 写入后 `result` 字段的键数量 = 原有键数量 + 新增元数据键数量（重叠键不重复计数）
- 合并操作必须为原子性：DB 中不得出现只写入了部分元数据字段的中间状态
- 不得使用整体替换（overwrite）方式更新 `result`；必须使用 JSON merge 或等效的字段追加方式

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- Brain 任务状态变更为 `completed` 的逻辑位于 `packages/brain/src/`，在该路径中找到任务完成触发点，注入元数据写入逻辑
- `result` 字段更新使用 PostgreSQL 的 `jsonb_build_object` + `||` 运算符（JSONB 合并），或等效的 `UPDATE ... SET result = result || $1` 方式，保证原子合并
- 执行元数据来源：由调用方（agent 执行回调）透传，Brain 接收后持久化；若回调未提供则填 null
- 现有查询 API 无需改动（DB 中存储即透传），重点修改写入路径

## 不在本次范围内

- 不建新的统计/汇总 API（按日汇总费用、按 agent 汇总 token 等）
- 不做 Dashboard 可视化展示
- 不对历史已完成任务做回填（只影响 sprint 实现后新完成的任务）
- 不修改任务 `status` 逻辑，不新增任务状态
- 不对 `total_cost_usd` 做货币换算或格式化展示
- 不对 token 量做实时计算（由调用方提供，Brain 只负责存储）
