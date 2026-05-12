# Sprint PRD — playground 加 GET /subtract endpoint（W35 Walking Skeleton P1 final happy path 验，no restart）

## OKR 对齐

- **对应 KR**：W35 Walking Skeleton Phase 1 **final happy path 验**——接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`、W24 `/factorial`、W26 `/increment` 八条 endpoint 后的 P1 收官任务。本任务的 KR 含义是：**整套 harness pipeline（planner → proposer GAN → generator → evaluator）在历经 W19~W26 的多轮加固后，对一个"语义清晰、命名陷阱完备、零依赖"的新增 endpoint 任务，应在 first attempt 一次跑通**——proposer round-1 合同字面照搬 PRD、reviewer round-1 给 APPROVED、generator round-1 实现严守合同、evaluator round-1 final_evaluate=PASS、task=completed，**全程无 pipeline restart**（无 brain reset、无 task fail rollback、无 worktree 重建、无人工干预、无 evaluate 复跑）。
- **当前进度**：W19~W26 累计跑通 8 条 playground endpoint，覆盖五类 oracle 范式（值复算严格相等 / strict-schema 白名单 / 输入规则级拒 / 输出值级兜底 / 单调用语义不变量 / 多调用递推不变量 / schema 完整性 oracle）；proposer SKILL v7.5 死规则 + v8.2 query param `[BEHAVIOR]` ≥ 1 条强约束 + reviewer SKILL v6.2 七维评分（含 `verification_oracle_completeness` / `behavior_count_position`）+ generator SKILL inline pattern 全部到位；W26 PR-G 验收完成（proposer 字面照搬 PRD 字段名死规则真生效）
- **本次推进预期**：W35 是 Walking Skeleton P1 的 **final acceptance gate**——证明经过 W19~W26 的迭代加固后，harness pipeline 已收敛到"对一个标准格式 PRD 任务，pipeline 一次性跑通无 restart"的稳定态。pipeline 任何一处需要 restart（如 proposer 合同 round ≥ 2、generator 实现需 fix-round、evaluator 复跑、task 状态从 in_progress 回滚）即视为 P1 final 未达标，需重开 issue 排查残留漂移点；若 first attempt 全链路 PASS 则 P1 收官，进入 P2（多 endpoint 并行 / 跨 sprint 复用 / 自我修复）

## 背景

Walking Skeleton 方法论的核心是：**先跑通端到端 happy path，再加厚**。Cecelia harness pipeline 从 W19 开始用 playground 上一系列 mini-endpoint（`/sum` → `/multiply` → ... → `/increment`）作为"细骨架"验证 planner → proposer → reviewer → generator → evaluator 五段全链路，每个 W-task 故意放一个特定的"陷阱"来暴露 pipeline 某一层的潜在漂移（W19 起步、W20~W23 strict-schema 加固、W24 跨调用 oracle、W25 字段名漂移暴露、W26 PR-G 字段名死规则验收等）。

到 W26 为止，pipeline 各层的已知漂移点均已在死规则 / SKILL 强约束 / 多维评分中显式封堵：

| 漂移层 | 漂移形态 | 封堵机制 | 验收 W-task |
|---|---|---|---|
| proposer | response 字段名 "语义化优化" | SKILL v7.5 死规则黑名单 + grep 自查 | W26 PR-G |
| proposer | query param 名漂到 a/b/x/y | SKILL v7.4 每 query ≥ 1 条 `[BEHAVIOR]` 验 + v8.2 PRD 禁用别名清单 | W22 实证 + W26 收紧 |
| proposer | operation 字面量变体（"inc" / "incrementation"） | SKILL v7.5 字面字符串严格相等 + 禁用变体清单 | W26 PR-G |
| reviewer | 评分维度遗漏 | SKILL v6.2 七维（含 `verification_oracle_completeness`） | W24~W26 持续 |
| reviewer | 字面对比漏检 | 第 6 维强制按"死规则对比表"逐项审 | W26 PR-G |
| generator | 实现漂离合同 | SKILL inline pattern（PR-E） | W25 |
| evaluator | oracle 跳过 / 假绿 | schema 完整性 oracle 必须真起服务真 curl 真 jq | W19~W26 |

**W35 的核心使命**：在所有已知漂移点都堵住后，验 pipeline 对一个"标准格式 + 零特殊陷阱"的新任务是否真能一次跑通。**故意选最简单的二元算术（减法）作为 P1 final 用例**——若此用例都不能一次跑通，说明 pipeline 仍有未识别的隐性漂移点，P1 不可结题；若一次跑通则 P1 收官。

`/subtract` 设计目标（**故意保持简单**，把所有已知陷阱都低剂量铺一遍但不引入新陷阱）：

- **二元算术**（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 同范式），区分 W26 `/increment` 的一元
- **query 名故意非 `a/b`**：用 `minuend` / `subtrahend`（被减数 / 减数，数学语义清晰）——验 proposer / generator 是否字面照搬 PRD 自定义 query 名，不偷懒复用 `a/b`
- **strict-schema 用浮点 `^-?\d+(\.\d+)?$`**：与 W20~W23 同 regex 复用 `STRICT_NUMBER` 常量（这是合法复用，浮点四则运算同分类），区分 W24 整数非负 `^\d+$` 与 W26 整数允负 `^-?\d+$`
- **response 字段名 generic**：`{result, operation: "subtract"}`，与 W26 `/increment` 同模式，验 proposer 是否能维持 v7.5 死规则纪律（不再退化"语义化优化"成 `{difference}`）
- **不设输入规则级拒**（与减法无关——减法对任意 finite 输入都有定义，不存在除零 / 0^0 / 阶乘上溢 / 精度上界这类）
- **设输出值级兜底**：`Number.isFinite(result)` 兜底（与 W22 `/power` 同款），防 `Number.MAX_VALUE - (-Number.MAX_VALUE) = Infinity` 这类罕见但理论存在的浮点溢出
- **无跨调用语义不变量** / **无递推不变量**（W23/W24 引入的，W35 不再引入新 oracle 类型，已知 oracle 类型组合即可）

**P1 final 收官 success criteria**：

1. **planner 输出**（本 PRD）：模板字面齐全（Response Schema / Query Parameters / 禁用清单 / 边界情况）
2. **proposer round-1**：合同字面包含 query 名 `minuend` / `subtrahend`（不出现 `a/b/x/y/p/q/m/n` 任一禁用别名）+ response key `result` / `operation` + `operation: "subtract"` 字面 + 禁用字段名清单 grep 通过；每 query param ≥ 1 条 `[BEHAVIOR]`；reviewer round-1 = APPROVED（**round ≥ 2 即视为 P1 final 未达标**）
3. **generator round-1**：实现严守合同，无 fix-round、无 test 失败、无重试（**任一 fix-round 即视为 P1 final 未达标**）
4. **evaluator round-1**：final_evaluate = PASS（**任一 oracle FAIL 即视为 P1 final 未达标**）
5. **task 状态**：从 `in_progress` → `completed`，无 `failed` / `cancelled` 中间态、无人工干预

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /subtract?minuend=10&subtrahend=3` 请求] → 经过 [playground server 用 strict-schema `^-?\d+(\.\d+)?$` 校验 minuend / subtrahend、计算 `Number(minuend) - Number(subtrahend)`、对结果做 `Number.isFinite` 兜底、否则返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation", "result"]`，`result === Number(minuend) - Number(subtrahend)` 且 `operation === "subtract"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /subtract?minuend=<浮点数字符串>&subtrahend=<浮点数字符串>` 到 playground server（默认端口 3000）
2. server 对 minuend 和 subtrahend 做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`，与 W20/W21/W22/W23 同款，可复用 `STRICT_NUMBER` 常量；**禁止科学计数法 / 前导 + / 双重负号 / 十六进制 / 千分位 / 空格 / 空串 / Infinity / NaN / 字母**）
3. strict-schema 通过后，计算 `result = Number(minuend) - Number(subtrahend)`
4. 对 `result` 做 `Number.isFinite(result)` 兜底；若为 `Infinity` / `-Infinity` / `NaN` 则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`（理论上对 IEEE 754 双精度极端值如 `Number.MAX_VALUE - (-Number.MAX_VALUE)` 可触发上溢，故防御性兜底）
5. 返回 HTTP 200，JSON body 为 `{ "result": <Number(minuend) - Number(subtrahend)>, "operation": "subtract" }`（**两个字段都必填，字面字符串 "subtract" 不许变体**）
6. 任一参数缺失 / 不通过 strict-schema / 结果非有限数 → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 + query param 名 + operation 字面量 + schema 完整性 codify 成 oracle，proposer 在合同里把每条转成 `jq -e` / `curl` 命令，evaluator 真起服务真校验。
>
> **W35 P1 final 验收核心**：proposer 必须**字面照搬**本段所有字段名 / query 名 / 禁用清单 / operation 字面量 / schema keys 集合。任一漂移视为 P1 final 未达标。

### Endpoint: GET /subtract

**Query Parameters**（v8.2 — 强制约束 query param 名）:

- `minuend` (number-as-string, 必填): 被减数，必须完整匹配 strict-schema 正则 `^-?\d+(\.\d+)?$`（**十进制浮点字符串，允许前导负号；禁科学计数法 / 前导 + / 十六进制 / 千分位 / 空格**）
- `subtrahend` (number-as-string, 必填): 减数，必须完整匹配同款正则
- **强约束**: proposer / generator 必须**字面用** `minuend` 与 `subtrahend` 作为 query param 名；用错 query 名一律视为合同违约
- **禁用 query 名**: `a` / `b` / `x` / `y` / `p` / `q` / `m` / `n` / `i` / `j` / `k` / `lhs` / `rhs` / `left` / `right` / `op1` / `op2` / `arg1` / `arg2` / `input1` / `input2` / `v1` / `v2` / `first` / `second` / `from` / `to` / `start` / `end` / `value1` / `value2` / `num1` / `num2`
- 用错 query 名 endpoint 应返 400（缺参分支）

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "subtract"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(minuend) - Number(subtrahend)`；保证 `Number.isFinite(result) === true`
- `operation` (string, 必填): **字面字符串 `"subtract"`**，禁用变体 `sub` / `subtraction` / `minus` / `diff` / `difference` / `subtr` / `op` / `method` / `action` / `type` / `kind` / `name`
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `minuend` / `subtrahend` / `input` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束，由 generator 决定）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code` / `errors`

**禁用响应字段名**（response body 严禁出现，proposer / generator 不得自由发挥同义替代）:

- **首要禁用**（proposer 最易漂到的"语义化优化"名，W25 实证教训沿用）: `difference` / `diff` / `subtraction` / `subtraction_result` / `sub_result` / `minus_result` / `minus` / `delta`
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）/ `product`（W20）/ `quotient`（W21）/ `power`（W22）/ `remainder`（W23）/ `factorial`（W24）/ `negation`（W25 PRD）—— 不许复用任一旧 endpoint 的响应字段名

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "subtract"'`（operation 字面量，**字符串严格相等**）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number）
- 200 成功响应：`jq -e '.result == <独立 Number(minuend) - Number(subtrahend) 复算>'`（result 值正确）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（**与 W20/W21/W22/W23 同款，可复用 `STRICT_NUMBER` 常量；区分 W24 `^\d+$` 与 W26 `^-?\d+$`**）

| 输入示例 | strict-schema 判定 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|
| `minuend=10&subtrahend=3` | 合法 | 7 | 200，`{result: 7, operation: "subtract"}` |
| `minuend=0&subtrahend=0` | 合法 | 0 | 200，`{result: 0, operation: "subtract"}` |
| `minuend=5&subtrahend=10` | 合法 | -5 | 200，`{result: -5, operation: "subtract"}` |
| `minuend=-5&subtrahend=-3` | 合法 | -2 | 200，`{result: -2, operation: "subtract"}` |
| `minuend=-5&subtrahend=3` | 合法 | -8 | 200，`{result: -8, operation: "subtract"}` |
| `minuend=1.5&subtrahend=0.5` | 合法 | 1 | 200，`{result: 1, operation: "subtract"}` |
| `minuend=3.14&subtrahend=1.14` | 合法 | 2 | 200，`{result: 2, operation: "subtract"}` |
| `minuend=100&subtrahend=99` | 合法 | 1 | 200，`{result: 1, operation: "subtract"}` |
| `minuend=0&subtrahend=1` | 合法 | -1 | 200，`{result: -1, operation: "subtract"}` |
| `minuend=1e2&subtrahend=1` | strict 拒（科学计数法） | — | 400 |
| `minuend=+5&subtrahend=3` | strict 拒（前导 +） | — | 400 |
| `minuend=--5&subtrahend=3` | strict 拒（双重负号） | — | 400 |
| `minuend=0xff&subtrahend=1` | strict 拒（十六进制） | — | 400 |
| `minuend=1,000&subtrahend=1` | strict 拒（千分位） | — | 400 |
| `minuend=1 0&subtrahend=1` | strict 拒（含空格） | — | 400 |
| `minuend=&subtrahend=3` | strict 拒（空串） | — | 400 |
| `minuend=abc&subtrahend=3` | strict 拒 | — | 400 |
| `minuend=Infinity&subtrahend=1` | strict 拒（字面 Infinity） | — | 400 |
| `minuend=NaN&subtrahend=1` | strict 拒 | — | 400 |
| `minuend=10`（缺 subtrahend） | — | — | 400 |
| `subtrahend=3`（缺 minuend） | — | — | 400 |
| 缺 minuend 和 subtrahend（无 query） | — | — | 400 |
| `a=10&b=3`（错 query 名） | — | — | 400 |

## 边界情况

- **`minuend === subtrahend`**（两参数相等）返 `{result: 0, operation: "subtract"}`，显式断言防 off-by-one
- **`minuend === 0`**：与任意合法 subtrahend 都合法（不存在除零这类陷阱），返 `{result: -Number(subtrahend), operation: "subtract"}`
- **负结果**：`minuend < subtrahend` 时 `result < 0` 是合法的（与 `/factorial` 的 `^\d+$` 不同，减法允许负数）
- **浮点精度**：`minuend=0.1&subtrahend=0.2` 返 `result === -0.1` 或 IEEE 754 浮点表达的近似值（proposer 在合同中应使用 `Number(minuend) - Number(subtrahend)` 独立复算作为 oracle 值，**不要硬编码 `-0.1`**，因为 `0.1 - 0.2 === -0.1` 在 IEEE 754 下为 `false`，但 `Number("0.1") - Number("0.2")` 与独立复算相等）
- **判定顺序必须严格**：缺参 → strict-schema → 计算 `Number(minuend) - Number(subtrahend)` → `Number.isFinite(result)` 兜底 → 200。错任一阶段都返 400 且 body 不含 `result` / `operation`
- **`Number.isFinite` 兜底**：理论上对 IEEE 754 双精度极端值如 `Number.MAX_VALUE - (-Number.MAX_VALUE)` 可触发 `Infinity` 上溢；但 strict-schema `^-?\d+(\.\d+)?$` 已限制不能用 `Number.MAX_VALUE` 字面字符串（含 `e`）、不能用 `Infinity`，所以实际触发路径极窄。但兜底必须保留以闭合规约（与 W22 `/power` 同款 defensive 设计），proposer 在合同中可以选择**不要求**单独测此分支（因为构造不出合法触发），但实现里 `if (!Number.isFinite(result)) return 400` 这一行必须真实存在
- **零依赖**：playground 现有零依赖原则保持不变
- **strict-schema 顺序**：缺参 → 类型 + 正则 → 算术 → `Number.isFinite` 兜底（与 W20/W21/W22/W23 一致）
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/increment`、`/factorial` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **不引入跨调用 oracle**（W24 风格不需要，单调用 `result === Number(minuend) - Number(subtrahend)` 充分）
- **不引入符号 oracle**（W23 风格不需要，减法结果符号由参数大小关系决定，不像 modulo 有符号规约约束）

## P1 final 收官 success criteria（pipeline 层面，不在合同中体现，仅供 W35 task 收口判定）

> 这一节不是给 proposer 看的（proposer 不需要在合同中体现），仅供 W35 任务执行完后人工核查 P1 final 是否真达标。

1. **planner 输出本 PRD**：模板齐全（Response Schema / Query Parameters / 禁用清单 / Schema 完整性 oracle 八条 / 边界情况 / 范围限定 / journey_type）
2. **proposer round-1**：合同字面包含 `minuend` / `subtrahend` query 名（不出现 `a/b/x/y` 任一禁用别名）+ `result` / `operation` response key + `"subtract"` 字面 operation 值 + 禁用字段名清单 grep 通过 + 每 query param ≥ 1 条 `[BEHAVIOR]` 验
3. **reviewer round-1 = APPROVED**：七维评分齐全（含 `verification_oracle_completeness` 与 `behavior_count_position`），**round ≥ 2 即视为 P1 final 未达标**
4. **generator round-1**：实现严守合同（query 名 / 字段名 / operation 字面字符串），test 一次通过无 fix-round，**任一 fix-round 即视为 P1 final 未达标**
5. **evaluator round-1**：final_evaluate = PASS，所有 schema 完整性 oracle 真起服务真 curl 真 jq 校验通过；**任一 oracle FAIL 即视为 P1 final 未达标**
6. **task 状态**：`in_progress` → `completed`，无 `failed` / `cancelled` 中间态、无 brain reset、无 worktree 重建、无人工干预

> **P1 final 失败信号**（任一发生即重开 issue，记录残留漂移点）:
> - proposer round ≥ 2（reviewer round-1 给 REJECTED 或 NEEDS_REVISION）
> - generator fix-round ≥ 1（test 一次未通过）
> - evaluator 任一 oracle FAIL（schema 完整性 / 值复算 / strict 拒任一类）
> - task 中间态出现 `failed` / `cancelled` / `blocked`
> - 任一处需人工介入（brain reset / worktree 重建 / evaluate 复跑 / git rebase）

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/factorial` 之后（或 `/increment` 之后，按文件现有顺序）、`app.listen` 之前新增 `GET /subtract` 路由（含 strict-schema `^-?\d+(\.\d+)?$` 校验 + 算术 + `Number.isFinite` 兜底 + 返回 `{result, operation: "subtract"}`）
- 在 `playground/tests/server.test.js` 新增 `GET /subtract` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` describe 块平级，覆盖：
  - happy path（至少 9 条：`minuend=10&subtrahend=3`、`minuend=0&subtrahend=0`、`minuend=5&subtrahend=10`、`minuend=-5&subtrahend=-3`、`minuend=-5&subtrahend=3`、`minuend=1.5&subtrahend=0.5`、`minuend=3.14&subtrahend=1.14`、`minuend=0&subtrahend=1`、`minuend === subtrahend` 反 off-by-one 一条）
  - strict-schema 拒（至少 9 条：科学计数法 / 前导 + / 双重负号 / 十六进制 / 千分位 / 空格 / 空串 / 字母 / Infinity / NaN）
  - 缺参（至少 3 条：缺 minuend、缺 subtrahend、两个都缺）
  - 错 query 名 400（至少 1 条：`a=10&b=3`）
  - 至少 3 条 oracle 值断言：`expect(res.body.result).toBe(Number(minuend) - Number(subtrahend))`，证明返回值与独立复算严格相等
  - **W35 schema 完整性 oracle**：至少 2 条断言
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation','result']`（成功响应 keys 字面集合相等，不含多余字段）
    - 至少 1 条断言 `res.body.operation === 'subtract'`（operation 字面字符串严格相等，不是 contains/startsWith）
  - 至少 1 条断言：失败响应 body 不含 `result` 字段，也不含 `operation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/increment`、`/factorial` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/subtract`，给出 happy（含 `minuend === subtrahend` 边界、负结果、浮点）/ strict 拒 / 缺参 各示例至少 6 个
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / mathjs / 任何外部库；不引入 BigInt 重写）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/increment`、`/factorial` 的实现或单测（一字不动）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不引入"语义化优化"字段名（`difference` / `diff` / `subtraction` 等）；PRD 字面法定不可改
- 不引入 W23 单调用语义不变量 oracle（减法无固有符号规约）
- 不引入 W24 跨调用递推不变量 oracle（单调用 oracle 充分）
- 不引入 W26 输入域绝对值上界拒（减法对 strict-schema 允许的所有输入都有意义，无需上界）
- 不复用其他 endpoint 的响应字段名（`sum` / `product` / `quotient` / `power` / `remainder` / `factorial` / `negation` 等）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与现有 8 路由一致）]
- [ASSUMPTION: strict-schema 复用 `STRICT_NUMBER` 浮点 regex `^-?\d+(\.\d+)?$`（与 W20/W21/W22/W23 同款，合法复用——浮点四则运算同分类）；区分 W24 `^\d+$` 与 W26 `^-?\d+$`]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 v7.5 死规则不可改名）；operation 值严格为字符串 `"subtract"`（字面）]
- [ASSUMPTION: 算术用 `Number(minuend) - Number(subtrahend)`（普通 JS 浮点减法），不用 BigInt（浮点输入必须用 Number）]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串，具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `minuend` 与 `subtrahend`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 的 `a`/`b` 形成可区分集合；与 `/factorial` 的 `n`、`/increment` 的 `value` 区分；故意挑选数学语义清晰的非字母占位符，验 proposer / generator 字面照搬纪律）]
- [ASSUMPTION: `Number.isFinite` 兜底在实现中必须保留（与 W22 `/power` 同款 defensive 设计），即使触发路径极窄；proposer 可选择是否在合同中要求专门测此分支]
- [ASSUMPTION: 浮点精度断言（`0.1 - 0.2`）使用独立复算 `Number(minuend) - Number(subtrahend)` 作为期望值，不要硬编码十进制理想值]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 或 `/increment` 之后新增 `GET /subtract` 路由 + strict-schema `^-?\d+(\.\d+)?$` 校验（复用 `STRICT_NUMBER`）+ `Number(minuend) - Number(subtrahend)` 算术 + `Number.isFinite` 兜底 + 返回 `{result, operation: "subtract"}`（≈ 10-12 行）
- `playground/tests/server.test.js`：新增 `GET /subtract` describe 块（happy 9+ + strict 拒 9+ + 缺参 3+ + 错 query 名 1+ + 值 oracle 3+ + schema 完整性 oracle 2+ + 错误体不含 result/operation 断言 + 错误体 keys=["error"] 断言 + 8 路由回归 1 条/路由）
- `playground/README.md`：端点列表加 `/subtract`，补 happy（含 `minuend === subtrahend` 边界、负结果、浮点）/ strict 拒 / 缺参 各示例（至少 6 个）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W26 同分类）
