# Sprint PRD — playground 加 GET /subtract endpoint（W34 WS P1 happy path 验 · uncapped fix 端到端验收）

## OKR 对齐

- **对应 KR**：Walking Skeleton P1 — Cecelia harness pipeline 端到端可用性。本任务是 #2924（commit 542f1b33f）"MAX_FIX_ROUNDS 3→20，质量优先无硬 cap"（P1 B11 fix）的端到端 **happy path 验收**——证明拆掉 fix 轮数硬 cap 后 harness 在最简单的合同上从 proposer → reviewer → contract approved → generator → evaluator → task=completed 全链跑通，没被 round 4+ 的旧 cap 提前打断
- **当前进度**：W19~W26 跑通 sum/multiply/divide/power/modulo/factorial/increment 七条 endpoint，演进出五类 oracle 范式（值复算严格相等 / strict-schema 白名单 / 输入规则级拒 / 输出值级兜底 / 跨调用递推不变量）。2026-05-12 #2924 把 brain `MAX_FIX_ROUNDS = 3` 改成 `20`（质量优先无硬 cap）；这是 P1 阶段一系列 B1~B11 修复中最后一环（B1~B10 已合：reportNode 回写 status / reaper 30→60min 加 harness_* 豁免 / dispatcher HOL blocking fix / slot accounting 实时对齐 / consciousness-loop guidance TTL / 僵尸 in_progress reaper / dispatch_events 真写入 / fleet heartbeat 可信度 / learning 入库强制 task_id 列绑定 / lookupHarnessThread harness-evaluate dispatch / evaluate_contract 复用 task graph thread_id）
- **本次推进预期**：在 playground 上加第八个 endpoint `/subtract`——这是迄今为止**最简单**的 endpoint（双参减法，无输入规则级拒，无输出非有限拒，无递推不变量，无精度边界）。**核心 oracle 仅两类**：strict-schema 白名单 + 值复算严格相等。任务规模有意保持极薄，目的是让 harness pipeline 在 P1 B1~B11 全部修复合并后**真正跑出 task=completed**——证明 brain 调度链 / dispatcher / harness graph / fix 轮数无硬 cap 全部正常工作。若仍卡在某一阶段（reaper 误杀 / dispatcher HOL / fix 轮 cap 等），则说明 P1 修复未真生效，需重开 issue 定位

## 背景

P1 阶段的目标是把 Walking Skeleton harness pipeline 推到"端到端能跑出 task=completed"。B1~B10 修了一系列调度链 / 状态机 / 心跳 / learning 入库 bug，B11（#2924）是最后一刀：把 `MAX_FIX_ROUNDS` 从 `3` 改 `20`——观察实证里 24h 失败 92% 的 RCA 显示，相当一部分失败是 fix 轮 3 次 cap 强行打断（contract round 还在进展、reviewer 还没批，cap 一触发就被判 FAIL）。3→20 实际上是"软上限"（质量优先无硬 cap），让 GAN 对抗自然收敛到 reviewer APPROVED 而不是被 cap 强切。

W34 的核心使命：在 **最简单** 的合同上（无任何业务规则陷阱）验证 P1 修复栈合并后 harness 是否真能跑通端到端。**故意选最简单**，因为 P1 验收要排除"任务本身复杂导致失败"这一干扰因素——若连 `a - b` 这种零陷阱合同都跑不出 task=completed，则 P1 修复未真生效；若能跑通，则 P1 验收阶段一 PASS，后续 P2 可以把任务复杂度推上来再验。

具体地，W34 不试图制造 fix 轮数压力（即不期望 GAN 真打到 round 4+），而是验"在简单合同上一切顺利"——proposer 起合同 round 1 reviewer APPROVED，generator 实现 round 1 evaluator PASS，全链 ≤ 2 round 跑完，task=completed。**如果**真因为某种偶发漂移打到 round 4+（W25 / W26 实证过 proposer/generator 偶尔会"语义化优化"PRD 字段名导致 contract 漂移），uncapped fix 给到 20 round 让 GAN 自然收敛，而不是 round 3 强切。

| oracle 形式 | W19 sum | W20 mul | W21 div | W22 pow | W23 mod | W24 fact | W26 inc | **W34 sub** |
|---|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`result === Number(a) - Number(b)`） |
| strict-schema 白名单 | — | ✓（浮点） | ✓ | ✓ | ✓ | ✓（整数非负） | ✓（整数允负） | ✓（**浮点 `^-?\d+(\.\d+)?$`**，复用 multiply/divide/power/modulo 同款） |
| 输入规则级拒 | — | — | ✓（b=0） | ✓（0^0） | ✓（b=0） | ✓（n>18） | ✓（\|value\|>9007199254740990） | **—（无）** |
| 输出值级兜底 | — | — | — | ✓ | — | — | — | **—（无：减法对任意 strict-schema 通过的浮点 a/b 必定结果有限，无 NaN/Infinity 路径）** |
| 单调用语义不变量 | — | — | — | — | ✓（sign） | — | — | — |
| 多调用递推不变量 | — | — | — | — | — | ✓ | — | — |
| 字段名字面相等 oracle（PR-G 验收） | — | — | — | — | — | — | ✓ | ✓（复用 W25/W26 generic 命名规约：`{result, operation: "subtract"}`） |
| **P1 B11 uncapped fix 验收**（task=completed 端到端） | — | — | — | — | — | — | — | **✓（核心 success criteria）** |

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /subtract?a=5&b=3` 请求] → 经过 [playground server 用 strict-schema `^-?\d+(\.\d+)?$` 校验 a 和 b、计算 `Number(a) - Number(b)` 并直接返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation", "result"]`，`result === Number(a) - Number(b)` 且 `operation === "subtract"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /subtract?a=<标准十进制字符串>&b=<标准十进制字符串>` 到 playground server（默认端口 3000）
2. server 检查 `req.query.a` 和 `req.query.b` 是否都存在，缺任一返 HTTP 400 + `{"error": "<非空字符串>"}`
3. server 对 a、b 各自做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`，与 `/multiply`、`/divide`、`/power`、`/modulo` 完全一致，**直接复用** `STRICT_NUMBER` 常量，不重新发明）；任一不匹配 → HTTP 400 + `{"error": "<非空字符串>"}`
4. 计算 `result = Number(a) - Number(b)`（JS 原生减法，IEEE 754 双精度）
5. 返回 HTTP 200，JSON body 为 `{ "result": <Number(a)-Number(b)>, "operation": "subtract" }`（**两个字段都必填，字面字符串 `"subtract"` 不许变体**）
6. 任一参数缺失 / 不通过 strict-schema → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名 + operation 字面量 + schema 完整性转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **W34 字段命名延续 W25/W26 PR-G generic 规约**：`{result, operation: "subtract"}`。proposer 必须**字面照搬**本段字段名、operation 字面量、禁用清单、schema keys 集合，**不许语义化优化**到 `{difference}` / `{minus}` / `{result, operation: "sub"}` 等任一同义形态。

### Endpoint: GET /subtract

**Query Parameters**（v8.2 — 强制约束 query param 名）:

- `a` (decimal-number-as-string, 必填): 被减数；必须完整匹配 strict-schema 正则 `^-?\d+(\.\d+)?$`（**十进制实数字符串，允许前导负号与小数；禁科学计数法、禁前导 `+`、禁十六进制、禁千分位、禁 `Infinity`、禁 `NaN`、禁空串、禁缺整数部分如 `.5`、禁缺小数部分如 `5.`**）
- `b` (decimal-number-as-string, 必填): 减数；strict-schema 与 a 完全相同
- **强约束**: proposer / generator 必须**字面用** `a` 和 `b` 作为 query param 名（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 一致）
- **禁用 query 名**: `x` / `y` / `m` / `n` / `p` / `q` / `i` / `j` / `k` / `val1` / `val2` / `num1` / `num2` / `input1` / `input2` / `v1` / `v2` / `minuend` / `subtrahend` / `lhs` / `rhs` / `left` / `right` / `first` / `second` / `arg1` / `arg2` / `value` —— 用错 query 名一律 400
- 用错 query 名（如 `?x=5&y=3`）endpoint 应返 400（缺参 `a`/`b` 分支）

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "subtract"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(a) - Number(b)`；对任意 strict-schema 通过的 a、b 必为有限数（IEEE 754 双精度减法对两个有限数永远不产生 `NaN` / `Infinity`）
- `operation` (string, 必填): **字面字符串 `"subtract"`**，禁用变体 `sub` / `minus` / `subtraction` / `diff` / `difference` / `op` / `method` / `action` / `type` / `kind`
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `a` / `b` / `input` / `output` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code`

**禁用响应字段名**（response body 严禁出现，proposer/generator 不得自由发挥同义替代）:

- **首要禁用**（W25/W26 PR-G 实证 proposer 最易漂到的同义名）: `difference` / `diff` / `minus` / `subtraction` / `sub` / `subtracted` / `delta` / `gap`
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta` / `a` / `b`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）、`product`（W20）、`quotient`（W21）、`power`（W22）、`remainder`（W23）、`factorial`（W24）、`negation`（W25）、`incremented`/`next` / `successor`（W26 禁用清单）—— 不许复用

**字段命名锁死的原因**：W25 实证 proposer 看到 `/negate` PRD 写 `{result, operation: "negate"}` 后倾向"语义化优化"成 `{negation}`；W26 实证同样在 `/increment` 上发生（"优化"成 `{incremented}` / `{next}`）。本 endpoint 同样用 generic `{result, operation: "subtract"}` 命名，故意制造 proposer "优化"诱惑——若 PR-G 死规则真生效，合同必须字面照搬 `result` + `"subtract"`；若漂到 `{difference}` / `{diff}` / `{result, operation: "sub"}` 等任一禁用形态，则视为 PR-G 死规则失效，需重开 issue。

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "subtract"'`（operation 字面量，**字符串严格相等**，不是 contains/startsWith）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number 类型）
- 200 成功响应：`jq -e '.result == <独立 Number(a)-Number(b) 复算>'`（result 值正确）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（**直接复用** `playground/server.js` 既有 `STRICT_NUMBER` 常量；与 `/multiply`、`/divide`、`/power`、`/modulo` 完全一致；**严禁** 重新写一份变体如 `^[+-]?\d+(\.\d+)?$` 或 `^-?\d*\.?\d+$` 假绿）

| 输入示例 | strict-schema 判定 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|
| `a=5&b=3` | 双方合法 | 2 | 200，`{result: 2, operation: "subtract"}` |
| `a=3&b=5` | 双方合法 | -2 | 200，`{result: -2, operation: "subtract"}` |
| `a=0&b=0` | 双方合法 | 0 | 200，`{result: 0, operation: "subtract"}`（无 0^0 那种不定式陷阱，0-0=0 数学合法） |
| `a=10&b=10` | 双方合法 | 0 | 200，`{result: 0, operation: "subtract"}` |
| `a=-5&b=3` | 双方合法 | -8 | 200，`{result: -8, operation: "subtract"}` |
| `a=5&b=-3` | 双方合法 | 8 | 200，`{result: 8, operation: "subtract"}` |
| `a=-5&b=-3` | 双方合法 | -2 | 200，`{result: -2, operation: "subtract"}` |
| `a=1.5&b=0.5` | 双方合法 | 1 | 200，`{result: 1, operation: "subtract"}` |
| `a=0.3&b=0.1` | 双方合法 | 0.19999999999999998（IEEE 754 浮点损失） | 200，`{result: 0.19999999999999998, operation: "subtract"}`（**严格不做精度截断**，evaluator 用同表达式复算 `toBe` 严相等） |
| `a=100.5&b=0.5` | 双方合法 | 100 | 200，`{result: 100, operation: "subtract"}` |
| `a=1e3&b=2` | a 非法（科学计数法） | — | 400 |
| `a=Infinity&b=2` | a 非法 | — | 400 |
| `a=2&b=NaN` | b 非法 | — | 400 |
| `a=+5&b=3` | a 非法（前导 +） | — | 400 |
| `a=.5&b=2` | a 非法（缺整数部分） | — | 400 |
| `a=5.&b=3` | a 非法（缺小数部分） | — | 400 |
| `a=0xff&b=2` | a 非法（十六进制） | — | 400 |
| `a=1,000&b=2` | a 非法（千分位） | — | 400 |
| `a=&b=3` | a 非法（空串） | — | 400 |
| `a=abc&b=3` | a 非法 | — | 400 |
| `a=--5&b=3` | a 非法（双重负号） | — | 400 |
| 缺 a 或缺 b 或全缺 | — | — | 400 |
| `?x=5&y=3`（错 query 名） | a 与 b 都缺 | — | 400 |

## 边界情况

- **`a===b`**（结果为 0）：必须返 `{result: 0, operation: "subtract"}`，**不**返 `-0`（JS Number 中 `0 === -0` 但 JSON 序列化 `-0` 会被 `JSON.stringify` 转成 `"0"`，故 0 与 -0 在响应里等价；evaluator 用 `toBe(0)` 与 `=== 0` 都通过）
- **结果 `-0` 边界**：若实现里出现 `0 - 0 = 0`（不是 `-0`，JS 标准减法行为），evaluator 与独立复算 `Number("0") - Number("0") === 0` 一致；无需特殊处理
- **浮点精度**：`0.3 - 0.1 === 0.19999999999999998`（IEEE 754 双精度损失）；evaluator 必须用**同表达式**独立复算并 `toBe` 严等比对，**严禁**用 `Math.abs(actual - expected) < EPSILON` 容差比较——容差比较会让 generator 用 `parseFloat` / `Number.EPSILON` / 四舍五入算法假绿
- **判定顺序**：缺参 → strict-schema → 计算 → 200。任一前两阶段失败都返 400 且 body 不含 `result`/`operation`
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `decimal.js` / `mathjs` / 任何外部库；不引入 BigInt 重写
- **JS Number 双精度对减法封闭**：对任意 strict-schema 通过的字符串 a、b，`Number(a)` 与 `Number(b)` 都是有限 IEEE 754 双精度数；两个有限双精度数相减结果仍为有限双精度（不会产生 `NaN` / `Infinity` / `-Infinity`，区别于 `/power` 的溢出 / `0^负` 路径）。因此**不需要** `Number.isFinite(result)` 兜底；加多余兜底视为合同违约
- **strict-schema 顺序与 `/multiply`、`/divide`、`/power`、`/modulo` 一致**：缺参 → 类型 + 正则 → 算术
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **`-0` 输入** 处理：`Number("-0") === -0`，`-0 - 0 === -0`（JS 标准）；strict-schema `^-?\d+(\.\d+)?$` 接受 `-0`；proposer 可不写专门用例，evaluator 复算也用 `Number("-0") - Number("0")` 自然对齐

## P1 B11 uncapped fix 验收：task=completed 端到端

W34 的**核心**不在 endpoint 本身（极薄），而在 **harness pipeline 端到端跑通** 这一事实——验 #2924（commit 542f1b33f）`MAX_FIX_ROUNDS = 20` 在 P1 B1~B11 全部修复栈合并后真生效。

**P1 B11 验收 success criteria**（由 harness 运行后自动检查 / brain dispatch 状态机轨迹回放）:

1. **task 终态 = `completed`**：W34 task 在 brain `/api/brain/tasks/{task_id}` 终态查询返回 `status: "completed"`、`result.verdict === "PASS"`，**不**是 `failed` / `timed_out` / `cancelled`
2. **GAN 收敛轮数 ≤ 20**：proposer ↔ reviewer 在 ≤ 20 轮内达成 contract APPROVED；如果实际只用了 1~3 轮（最常见情况），更好——说明合同质量高 + reviewer 不挑刺；如果用了 4~20 轮（不常见但允许），说明 uncapped fix 真生效，旧 cap=3 会在 round 3 强切，新 cap=20 不会
3. **generator → evaluator round 数 ≤ 20**：generator 实现 round ↔ evaluator 验收 round 在 ≤ 20 轮内达到 PASS；同上，常见 1~2 轮，允许 4~20 轮
4. **brain 调度链无失败**：`/api/brain/dev-records?task_id=...` 查询 W34 任务的整个 dispatch_events 流，无 `reaper_killed` / `dispatcher_skipped_HOL` / `slot_accounting_drift` / `learning_orphan` / `thread_id_mismatch` 等 P1 B1~B10 修复涵盖的失败信号
5. **playground 端 PR 合并 + CI 绿**：generator container push 的 PR 加 `playground/server.js` + `playground/tests/server.test.js` + `playground/README.md` 三处改动，CI（lint + 单测 + 回归 8 路由）全绿后 merge 到 main
6. **harness pre-merge evaluator gate 通过**（#2901）：合并前的 final_evaluate 节点真起 playground server 真 curl 真 jq 校验 schema 完整性 oracle 通过

> **P1 B11 验收的失败信号**（任一发生即重开 issue 定位 P1 B*）:
>
> - task 终态非 `completed`（说明某 P1 B* 修复未真生效，需对照 dispatch_events 反查）
> - GAN 轮数 > 20（说明合同质量持续震荡或 reviewer 标准漂；不归 B11 而归 SKILL 质量）
> - generator/evaluator 轮数 > 20（同上）
> - dispatch_events 流出现 P1 B1~B10 任一已修复 bug 信号（说明某 B* 回归）
> - PR merge 卡 CI（lint / 单测 / 回归红）
> - pre-merge evaluator gate 跳过 / 假绿

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /subtract` 路由（含 strict-schema `STRICT_NUMBER` 复用 + 缺参校验 + 计算 `Number(a) - Number(b)` + 返回 `{result, operation: "subtract"}`）
- 在 `playground/tests/server.test.js` 新增 `GET /subtract` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` describe 块平级，覆盖：
  - happy path（含 `a=5,b=3`、`a=3,b=5`、`a=0,b=0`、`a=10,b=10`、`a=-5,b=3`、`a=5,b=-3`、`a=-5,b=-3`、`a=1.5,b=0.5`、`a=100.5,b=0.5` 至少 9 条；其中 `a=5,b=3 → 2`、`a=3,b=5 → -2`、`a=0,b=0 → 0` 各 1 条显式断言）
  - 浮点精度损失断言：`a=0.3,b=0.1` 必须返 `result: 0.19999999999999998`（**严格不容差**，至少 1 条）
  - strict-schema 拒（科学计数法、Infinity、NaN、前导 +、缺整数部分 `.5`、缺小数部分 `5.`、十六进制、千分位、空格、空串、字母串、双重负号 各至少 1 条）
  - 缺参拒（缺 a / 缺 b / 全缺 各 1 条）
  - 错 query 名拒（`?x=5&y=3`、`?value=5&value2=3` 至少 2 条）
  - 至少 3 条 oracle 值断言：`expect(res.body.result).toBe(<独立 Number(a)-Number(b) 复算>)`，证明返回值与独立复算严格相等
  - **核心 schema 完整性 oracle 断言**（W34 PR-G 验收延续）：
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation','result']`（成功响应 keys 字面集合相等，不含多余字段）
    - 至少 1 条断言 `res.body.operation === 'subtract'`（operation 字面字符串严格相等，不是 contains/startsWith）
    - 至少 1 条断言 `typeof res.body.result === 'number'`（result 是 number 类型）
  - 至少 1 条断言：失败响应 body 不含 `result` 字段，也不含 `operation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 至少各 1 条 happy 用例仍然通过（8 路由回归）
- 在 `playground/README.md` 端点列表加 `/subtract`，给出 happy（含 `a===b → 0`、负数、浮点精度损失 `0.3-0.1`）、strict 拒（科学计数法 / 十六进制 / 千分位 各示例）至少 5 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / decimal.js / bignumber.js / mathjs / 任何外部库；不引入 BigInt 重写）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现或单测（一字不动）
- 不引入 `Number.isFinite` 结果兜底（减法对 strict 通过的输入结果必定有限，加多余兜底视为合同违约）
- 不引入容差比较（`Math.abs(a-b) < EPSILON`）；evaluator 必须用**同表达式**独立复算 + `toBe` 严等
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不引入 W21/W22/W23/W24 风格的输入规则级拒 / 输出值级兜底 / 单调用语义不变量 / 跨调用递推不变量 oracle（减法对 strict 通过的输入是全函数，无任何拒绝路径，**故意保持极薄**以验 P1 B11 happy path）
- 不引入 W26 风格的精度上下界拒（减法不放大精度损失，无需上下界）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 一致）]
- [ASSUMPTION: strict-schema 直接复用 `playground/server.js` 既有 `STRICT_NUMBER` 常量（`^-?\d+(\.\d+)?$`）；不重新定义同义常量，避免 generator 写歪]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 PR-G 死规则不可改名）；operation 值严格为字符串 `"subtract"`（字面）；命名规约延续 W25 negate / W26 increment 的 generic 模式，**不**沿用 W19~W24 的"动作-结果名"模式（`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`）]
- [ASSUMPTION: 减法计算用 `Number(a) - Number(b)`（普通 JS 数值算术）；不用 BigInt（无必要，且响应必须是 JS Number）]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `a` 与 `b`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 一致；不引入 `minuend`/`subtrahend` 等领域专名避免 generator 复读 W26 单参 query 锁死模板）]
- [ASSUMPTION: 浮点精度损失（如 `0.3 - 0.1 === 0.19999999999999998`）按 JS 原生减法行为照原样返回；不四舍五入；不引入 `toFixed` / `parseFloat` 等截断]
- [ASSUMPTION: P1 B11 验收只看 task 终态 + GAN/generator 收敛轮数 + dispatch_events 流；不看具体 fix 轮数是否 >3——uncapped 的设计目标是"质量优先无硬 cap"，能 1 轮跑完最好，能 20 轮内跑完也行]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 之后、`app.listen` 之前新增 `GET /subtract` 路由（≈ 10-12 行）；含 `req.query.a` / `req.query.b` 取参、缺参 400、`STRICT_NUMBER` 复用校验 400、`Number(a) - Number(b)` 计算、`res.json({result, operation: "subtract"})` 返回
- `playground/tests/server.test.js`：新增 `GET /subtract` describe 块（happy 9+ 含浮点精度 + 0 边界 + 负数 + strict 拒 12+ + 缺参 3 + 错 query 名 2 + 值 oracle 3+ + schema 完整性 oracle 3+ + 错误体不含 result/operation 断言 + 错误体 keys=["error"] 断言 + 8 路由回归 1 条/路由）
- `playground/README.md`：端点列表加 `/subtract`，补 happy（含 `a===b → 0`、负数、浮点精度损失 `0.3-0.1`）/ strict 拒 各示例（至少 5 个）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W26 同分类）
