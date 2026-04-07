# 合同审查反馈（第 2 轮）

**审查结论**：REVISION — 2 处必须修改

R1 四条反馈均已处理，本轮新发现 2 个关键问题：

---

## 必须修改

### 1. [描述矛盾] Feature 1 与 Feature 3 的写入触发条件互相冲突

**冲突位置**：

> Feature 1（行为描述）："当 `result` 中**含 `duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens` 字段**时，将这 5 个字段合并写入"

> Feature 3（硬阈值）："如果 callback payload 中 `result` 对象**存在上述 5 个键中的任意一个**，则全部 5 个键均必须写入（**缺失字段以 `0` 填充**，不允许漏写）"

**矛盾**：当 callback 的 `result` 中只包含 2 个字段（例如只有 `duration_ms` 和 `num_turns`）时：
- 按 Feature 1：这不满足"含全部 5 个字段"的前提，**不写入**
- 按 Feature 3：只要有 1 个键就触发，其余补 0，**写入 5 个**

Evaluator 无法根据现有合同判断哪个是正确行为。

**修改方向**（二选一，必须明确选择）：

**方案 A（全部到位才写）**：
> 当且仅当 callback 的 `result` 对象中同时包含全部 5 个字段时，才写入 DB。若只有部分字段，忽略整个 result 的元数据（不写入任何一个）。

Feature 3 删去"缺失字段以 0 填充"，改为"只有 all-5-present 的 callback 会触发写入"。

**方案 B（任意一个键就触发，补 0）**：
> 当 callback 的 `result` 对象中存在上述 5 个键中的任意一个时，触发写入。缺失的字段以 `0`（整数/浮点）填充写入 DB。

Feature 1 的行为描述需要改为：只要含任意一个键即触发，并补全其余缺失字段为 `0`。

---

### 2. [验证路径缺失] Feature 3 的"partial keys 补 0"路径无验证步骤

**问题**：若采用方案 B（任意一个键触发补 0），Feature 3 引入了一个新的行为路径（partial input → pad missing fields），但合同只提供了"全部 5 个键都在"的验证场景（Feature 1 的"验证前提"）。Evaluator 无法根据现有合同验证补 0 行为是否实际生效。

**修改方向**（若选方案 B）：
在 Feature 3 的验收标准中补充验证步骤，例如：

> Evaluator 可构造如下场景验证：
> 1. 创建测试任务（状态 `in_progress`）
> 2. 向 `POST /api/brain/execution-callback` 发送只含 `duration_ms` 的 result：
>    ```json
>    { "task_id": "<id>", "status": "completed", "result": { "duration_ms": 9999 } }
>    ```
> 3. 查询 `GET /api/brain/tasks/<id>`，验证 `result` 中：
>    - `duration_ms` = 9999
>    - `total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens` 均存在且值为 `0`（或 `0.0`）

若选方案 A（全部到位才写），则 Feature 3 应改为：验证"只发送部分键时，result 的 5 个元数据字段全部不存在"。

---

## 可选改进

- **POST 成功的 HTTP 状态码**：Feature 1 的验证场景发送 curl 后，Evaluator 用什么判断 callback 被接受？建议补充"POST 返回 HTTP 200，且响应体中 status 字段为 `completed`（或类似可验证标志）"，避免 Evaluator 靠猜测判断 POST 是否成功。

- **`total_cost_usd` 估算路径**：技术实现方向提到"若未传入 `total_cost_usd`，从 token 估算"，但验收标准仅覆盖"直接传入"的场景。若估算逻辑在实现中存在，建议在 Feature 1 或 Feature 3 中补充一个"不传 `total_cost_usd`、只传 tokens 的验证场景"；若估算不在本 sprint 范围，建议在"不在范围内"中明确注明。
