# 合同审查反馈（第 1 轮）

## 必须修改

### 1. [无法独立验证] Feature 1 — "写入延迟 < 500ms" 不可操作

**原文**：写入操作完成后，DB 中 result 字段更新延迟 < 500ms（从状态变更触发到 DB 写入完成）

**问题**：Evaluator 无法独立测量"从状态变更触发"到"DB 写入完成"的内部时间差。这是一个实现层指标，不是可观察的外部行为。

**修改方向**：改为从 API 视角的可验证指标，例如：
> 任务状态变更后，在 1 秒内对 GET /api/brain/tasks/:id 发起查询，返回的 result 字段中必须已包含执行元数据（不允许出现"状态已 completed 但 result 仍为 {}"的竞态窗口）

或直接删除该条（Feature 2 的 API 响应时间 < 500ms 已覆盖查询侧性能）。

---

### 2. [验证路径缺失] Feature 2 — Evaluator 不知道如何找到"实现后完成"的任务

**原文**（行为描述）：批量查询时，返回列表中每条任务的 result 字段均包含执行元数据（**若该任务是在本次 sprint 实现后完成的**）

**问题**：硬阈值中没有说明验证前提：如何触发一个新任务完成？现有已完成任务的 result 可能仍为空对象 {}，Evaluator 如果直接查 `GET /api/brain/tasks?status=completed&limit=5`，很可能全是历史任务，无法区分实现前后。

**修改方向**：补充验证前提步骤，例如：
> Evaluator 可通过以下方式获得一个实现后完成的任务：在实现部署后，等待任意一个任务自然完成（状态变为 completed），或由 Evaluator 手动触发一次任务执行。验证目标为该任务的 result 字段。

---

### 3. [无法独立验证] Feature 3 — "原子性"无法外部验证

**原文**：合并操作必须为原子性：DB 中不得出现只写入了部分元数据字段的中间状态

**问题**：Evaluator 无法在不注入故障（kill -9 mid-transaction）的情况下验证原子性。这是实现约束，不是行为约束。

**修改方向**：将原子性转化为可验证的外部行为：
> 对任意已完成任务，result 字段中的 5 个元数据键（duration_ms、total_cost_usd、num_turns、input_tokens、output_tokens）要么同时存在，要么同时不存在（不允许只有其中部分键）。  
> 验证命令：查询 result 字段后，统计上述 5 个键的存在数量，结果必须为 0 或 5，不能为 1-4。

---

### 4. [验证路径缺失] Feature 1 — execution callback 接收端点未明确

**问题**：合同说"由调用方（agent 执行回调）透传，Brain 接收后持久化"，但没有说明：
- execution callback 通过哪个 API 端点传入？（例如 `POST /api/brain/tasks/:id/complete`？还是 PATCH status？）
- callback 的 payload 格式是什么？Evaluator 需要知道这个才能构造测试场景验证 Feature 1。

**修改方向**：补充一行：
> 执行元数据通过 [具体端点，如 `PATCH /api/brain/tasks/:id`] 的 payload 中的 `result` 字段传入。Evaluator 可用 curl 向该端点发送含元数据字段的 PATCH 请求，随后查询 result 字段验证写入。

---

## 可选改进

- Feature 1 中"精度不低于 6 位小数"的表述可删除（PostgreSQL float8 本身精度足够，且 Evaluator 无需单独验证精度位数；非负约束已足够）。

- Feature 3 中"不得使用整体替换方式更新 result；必须使用 JSON merge"是实现约束而非行为约束。行为结果（pr_url 保留）已经覆盖了这个意图，可以删除或移入"技术实现方向"，不应放在验收标准里。

- "当同一任务被多次调用 complete 逻辑（重复触发）时" — 这个边界情况的触发方式和验证方式没有说明，Evaluator 无法独立验证。建议补充说明或降级为"可选行为"。
