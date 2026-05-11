# Sprint PRD — playground /divide endpoint 响应字面统一为 `{result, operation: "divide"}`（W28：pre-merge gate 真任务验收）

## OKR 对齐

- **对应 KR**：W28 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`、W24 `/factorial`、W26 `/increment`），并作为 **PR #2901 pre-merge evaluator gate 真验收任务**——证明 evaluator 已迁到 task 子图（poll_ci → evaluate_contract → merge_pr / fix_dispatch）后，PR 合并前必先经 evaluator 行为层 PASS，能真挡住"CI 全绿但行为漂"的污染（W19/W20/W26 历史问题），最终 task=completed 才视为 gate 真生效
- **当前进度**：2026-05-11 PR #2901 已 merge——SC-1 evaluateContractNode 加入 task 子图（poll_ci → evaluate_contract → merge_pr / fix_dispatch）；SC-2 omelette quota 字段 + Opus 跳过 ≥95% 账号；SC-3 harness_planner/propose/review docker mem=2048m；SC-4 circuit breaker HALF_OPEN cap + /reset；SC-5 4 个 SKILL host 改动入 main（proposer v7.6 / reviewer v6.4 / generator v6.3 / evaluator v1.3）；smoke 脚本（harness-pre-merge-gate-smoke.sh）L1 静态路由断言绿。**SC-6 端到端真验** 由本 W28 任务承担——派一条真 harness pipeline 任务，期望 task=completed 在 timeout_sec=3600 内达成
- **本次推进预期**：本任务 **改造现有 `/divide` 端点响应**——把 W21 #2881 引入的 `{quotient: a/b}` 形态，统一为本仓 W26 `/increment` 起开始采纳的 generic `{result, operation: "<endpoint 名>"}` 模式（即 `{result: a/b, operation: "divide"}`），同时保留 W21 全部输入校验（strict-schema `^-?\d+(\.\d+)?$` + b=0 拒）。本任务的核心使命是 **验 pre-merge gate**——若任一阶段（contract / impl / CI / evaluator）字段名漂回 `quotient` 或漂到 `division` / `result_value` / `divided` 等同义名，pre-merge gate 必须真挡住，PR 不许 merge。Task 最终 status=completed 当且仅当 evaluator 行为层 PASS（schema 完整性 + 字段名字面相等 + b=0 拒 + 算术 oracle 全部通过），合同 GAN + impl + CI + evaluator 四道关全过，PR merge 成功

## 背景

### W28 在 walking skeleton 链路里的位置

W19~W26 累积出"strict-schema + 输入规则拒 + 输出值兜底 + 单调用语义不变量 + 多调用递推不变量 + 字段名字面相等"六类 oracle 范式：

| oracle 形式 | W19 sum | W20 mul | W21 div | W22 pow | W23 mod | W24 fact | W26 inc | **W28 div** |
|---|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`result === Number(a)/Number(b)`） |
| strict-schema 白名单 | — | ✓（浮点） | ✓（复用浮点） | ✓ | ✓ | ✓ | ✓（整数允负） | ✓（**完全复用 W21 浮点 regex `^-?\d+(\.\d+)?$`**，因输入域与 W21 等价） |
| 输入规则级拒 | — | — | ✓（b=0） | ✓（0^0） | ✓（b=0） | ✓（n>18） | ✓（绝对值上界） | ✓（**完全复用 W21 b=0 拒**） |
| 输出值级兜底 | — | — | — | ✓ | — | — | — | —（浮点除法在 strict 通过 + b≠0 后必为 JS Number 有限值，无需 isFinite 兜底——同 W21 立场） |
| 字段名字面相等 oracle | — | — | — | — | — | — | ✓（W26 PR-G 验） | **✓（W28 pre-merge gate 真任务验，与 W26 共一对照表）** |
| **pre-merge gate 真验收** | — | — | — | — | — | — | — | **✓（首次：evaluator 跑在 PR merge 前）** |

### 与 W21 `/divide` 的关系：本次是 **响应形态统一改造**，不是新加 endpoint

W21 #2881 引入 `/divide` 时使用 `{quotient}` 字段名（动作的语义结果名风格，与 `/sum` 的 `{sum}`、`/multiply` 的 `{product}` 同款）。W26 #2894 引入 `/increment` 时切换到 generic `{result, operation: "<endpoint 名>"}` 模式（PR-G 验收的核心范式）。

W28 把 **现有** `/divide` 端点的响应形态从 `{quotient}` 改为 `{result, operation: "divide"}`，与 W26 `/increment` 范式对齐。这是一次**破坏性变更**（W21 的 `{quotient}` 字段消失），需要：

1. `playground/server.js` `/divide` 路由的成功响应 body 改为 `{result: Number(a)/Number(b), operation: "divide"}`（**字面**字符串 `"divide"`，不许变体）
2. `playground/tests/server.test.js` 中 `GET /divide` describe 块所有断言从 `res.body.quotient` 改为 `res.body.result`，并新增 `res.body.operation === "divide"`、`Object.keys(res.body).sort() === ["operation","result"]` 等 schema 完整性断言（与 W26 同款）
3. `playground/README.md` `/divide` 段更新示例响应

### W28 的"refactor 不是 add"性质对 pre-merge gate 的额外考验

`/divide` 是已有端点，本次改的是它的响应形态。这给 pre-merge gate 增加了一类额外的失败模式：generator 若部分改动（如改了 server.js 但漏改 tests，或反之），CI 可能仍可绿（如果新旧字段共存兜底）但 evaluator 行为层会真挂——因为 evaluator 调用真 endpoint 用 `jq -e '.result == ...'` + `jq -e '.operation == "divide"'` + `jq -e 'keys | sort == ["operation","result"]'` 校验。pre-merge gate 必须在此场景下拦下 PR。

`/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment` 这 6 个端点的响应形态**不动**——它们的回归断言由本任务 oracle 链路守住。

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /divide?a=6&b=2` 请求] → 经过 [playground server 用 strict-schema `^-?\d+(\.\d+)?$` 校验 a/b、显式拒绝 `Number(b) === 0`、计算 `Number(a) / Number(b)` 并按新形态返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation","result"]`，`result === 3` 且 `operation === "divide"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /divide?a=<标准十进制字符串>&b=<标准十进制字符串>` 到 playground server（默认端口 3000）
2. server 对 a 和 b 各自做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`，与 W20 `/multiply`、W21 `/divide` 原版完全一致——可复用现有 `STRICT_NUMBER` 常量）
3. strict-schema 通过后，**显式判定 `Number(b) === 0`**，是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `result` 也不含 `operation` 字段（与 W21 行为一致；只是响应形态切换，输入规则不变）
4. b ≠ 0 → 返回 HTTP 200，JSON body 为 `{ "result": Number(a) / Number(b), "operation": "divide" }`（JS 原生除法结果，含浮点精度；evaluator 用同表达式 `Number(a)/Number(b)` 独立复算比对严格相等）
5. 任一参数缺失 / 不通过 strict-schema → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名 + operation 字面量 + schema 完整性转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **本任务（W28）作为 pre-merge gate 真验收**：本段是 proposer **字面照搬**的唯一 ground truth。Contract 字段名 / operation 字面量 / 禁用清单 / schema keys 集合，**全部必须与本段字面相等**。任一漂移由 reviewer GAN 阻挡；若漏过 reviewer 进 generator，由 evaluator 行为层挡住；evaluator 真挡得住即 pre-merge gate 真生效。

### Endpoint: GET /divide

**Query Parameters**（v8.2 — 强制约束 query param 名，避免 generator 漂移到 a/b 之外的别名）:

- `a` (number-as-string, 必填): 被除数；必须完整匹配 strict-schema 正则 `^-?\d+(\.\d+)?$`（**十进制数；禁科学计数法、Infinity、前导 +、十六进制、千分位、空格、空串、NaN**）
- `b` (number-as-string, 必填): 除数；同 `a` 的 strict-schema 校验，且 `Number(b) !== 0`（业务规则拒）
- **强约束**: proposer / generator 必须**字面用** `a` 与 `b` 作为 query param 名（与现有 `/divide` 一致；与 W19/W20/W21/W22/W23 同款）
- **禁用 query 名**: `x` / `y` / `p` / `q` / `n` / `m` / `numerator` / `denominator` / `dividend` / `divisor` / `num` / `den` / `top` / `bottom` / `over` / `under` / `v1` / `v2` / `input1` / `input2` / `arg1` / `arg2` / `base` / `exp` / `value` —— 用错 query 名一律视为合同违约
- 用错 query 名（如 `numerator=6&denominator=2`）endpoint 应返 400（缺参分支）或 404

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "divide"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(a) / Number(b)`（JS 原生除法，浮点精度按 IEEE 754 双精度原样返回，不做四舍五入 / 不强制整数 / 不做精度截断）
- `operation` (string, 必填): **字面字符串 `"divide"`**，禁用变体 `div` / `division` / `divided` / `divisor_op` / `op` / `method` / `action` / `type` / `kind` / `divide_result` / `divided_by`
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `a` / `b` / `quotient` / `dividend` / `divisor` / `value` / `input` / `output` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code` / `status` / `kind`

**禁用响应字段名**（response body 严禁出现，proposer/generator 不得自由发挥同义替代）:

- **首要禁用**（W21 历史形态 + proposer 最易漂的同义名，pre-merge gate 黑名单）: `quotient` / `division` / `divided` / `divisor_result` / `divide_result` / `div` / `ratio` / `share`
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta` / `dividend` / `divisor` / `numerator` / `denominator`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）、`product`（W20）、`power`（W22）、`remainder`（W23）、`factorial`（W24）—— 不许复用

**字段命名锁死的原因**：W21 原版 `/divide` 用 `{quotient}` 形态，W26 起切换到 generic `{result, operation: "<endpoint 名>"}`。本任务把 `/divide` 也切到此模式，与 `/increment` 对齐。LLM（proposer / generator）看到 endpoint 名 `divide` 后倾向把字段命名"语义化回流"成 `{quotient}`（看起来更专业 + 与历史 W21 形态一致）或漂到 `{division}` / `{result, operation: "div"}`，均违反 PRD 字面法定。Pre-merge gate（evaluator 行为层）必须真挡得住——任一漂移 evaluator schema 完整性 oracle 直接 FAIL。

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令，evaluator 真起服务真 curl 真 jq 校验）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "divide"'`（operation 字面量，**字符串严格相等**，不是 contains/startsWith）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number）
- 200 成功响应：`jq -e '.result == <独立 Number(a)/Number(b) 复算>'`（result 值正确，至少 happy + 负数 + 浮点 + 0/N 各一条）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）
- 400 除零拒响应（`?a=5&b=0`）：以上 4 条错误响应断言全成立 + `jq -e 'has("result") | not'` 显式重复确认

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（**与 W20 `/multiply`、W21 `/divide` 原版完全一致；可复用 `STRICT_NUMBER` 常量；严禁 Number()/parseFloat() 假绿**）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|---|
| `a=6&b=2` | 双方合法 | 在范围内 | 3 | 200，`{result: 3, operation: "divide"}` |
| `a=1&b=3` | 双方合法 | 在范围内 | 0.3333333333333333（JS 原生浮点） | 200，`{result: 0.3333333333333333, operation: "divide"}` |
| `a=1.5&b=0.5` | 双方合法 | 在范围内 | 3 | 200，`{result: 3, operation: "divide"}` |
| `a=-6&b=2` | 双方合法 | 在范围内 | -3 | 200，`{result: -3, operation: "divide"}` |
| `a=6&b=-2` | 双方合法 | 在范围内 | -3 | 200，`{result: -3, operation: "divide"}` |
| `a=-6&b=-2` | 双方合法 | 在范围内 | 3 | 200，`{result: 3, operation: "divide"}` |
| `a=0&b=5` | 双方合法 | 在范围内 | 0 | 200，`{result: 0, operation: "divide"}` |
| `a=0&b=-5` | 双方合法 | 在范围内 | -0 / 0（JS Number 中 -0 == 0，按 `===` 严格相等于 `Number("0")/Number("-5")` 即 -0） | 200（**详见边界讨论；与 evaluator 同表达式复算严格相等即可**） |
| `a=10&b=3` | 双方合法 | 在范围内 | 3.3333333333333335 | 200，`{result: 3.3333333333333335, operation: "divide"}` |
| `a=5&b=0` | strict 通过但 b=0 | **拒** | — | **400**（除零兜底，与 W21 一致；body 不含 result 也不含 operation） |
| `a=0&b=0` | strict 通过但 b=0 | **拒** | — | **400**（0/0 也拒） |
| `a=6&b=0.0` | strict 通过但 b=0（`Number("0.0") === 0`） | **拒** | — | **400**（防字符串等值漏判） |
| `a=6&b=-0` | strict 通过但 b=0（`Number("-0") === 0` 且 `=== -0`） | **拒** | — | **400**（`-0` 也算零；与 W21 行为兼容） |
| `a=1e3&b=2` | a 非法（科学计数法） | — | — | 400 |
| `a=Infinity&b=2` | a 非法 | — | — | 400 |
| `a=6&b=NaN` | b 非法 | — | — | 400 |
| `a=+6&b=2` | a 非法（前导 +） | — | — | 400 |
| `a=.5&b=2` | a 非法（缺整数部分） | — | — | 400 |
| `a=6.&b=2` | a 非法（缺小数部分） | — | — | 400 |
| `a=0xff&b=2` | a 非法（十六进制） | — | — | 400 |
| `a=1,000&b=2` | a 非法（千分位） | — | — | 400 |
| `a= 6&b=2` | a 非法（含前导空格） | — | — | 400 |
| `a=&b=3` | a 空串 | — | — | 400 |
| `a=abc&b=3` | a 非数字 | — | — | 400 |
| 缺 a 或缺 b 或全缺 | — | — | — | 400 |

## 边界情况

- **b = 0 拒** 是 W21 已存在的核心拒绝路径，本任务 **保留**不变；显式判定在 strict-schema 通过 **之后**、除法运算 **之前**
- **`b = 0.0` / `b = -0`** 都必须按 `Number(b) === 0` 真值判定（`Number("0.0") === 0` 为真、`Number("-0") === 0` 为真），均拒
- **`a = 0 且 b ≠ 0`** → 200，`{result: 0, operation: "divide"}`（不能误把 a=0 也拒掉，这是 W21 已稳定行为）
- **负数除以负数** → 商为正，按 JS 原生算术返回；显式断言 `result === Number("-6")/Number("-2")` 严格相等
- **不能整除**（如 `1/3`、`10/3`） → 200，按 JS Number 浮点表示原样返回，不做四舍五入 / 不强制整数 / 不引入 BigInt 或 decimal
- **strict 校验顺序**：缺参 → strict-schema → 除零 → 算术（错任一阶段都返 400 且 body 不含 `result` / `operation`）
- **响应形态切换的两类常见漏洞**（pre-merge gate 主要拦截目标）:
  1. generator 漏改 server.js / 漏改 tests / 漏改 README 之一 → schema 完整性 oracle FAIL
  2. generator 把 `quotient` 字段 **并存**（既给 `result` 又给 `quotient` 兼容旧 client）→ `keys | sort == ["operation","result"]` 集合相等 oracle FAIL
- **`/health`、`/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这七条路由的代码、单测、README 段一个字符；本任务唯一改的是 `/divide`）
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `zod` / `joi` / `ajv` / `decimal.js` / `bignumber.js` / 任何外部库

## pre-merge gate 真验收：本任务 success criteria

本任务作为 PR #2901 SC-6 的真验收，必须满足：

1. **harness pipeline 全链路跑通**：planner → contract proposer → contract reviewer → generator → CI → **evaluator (pre-merge gate)** → merge_pr
2. **evaluate_contract 节点真跑**：task 子图必须经过 `evaluate_contract` 节点（不是直连 poll_ci → merge_pr），evaluator container 真起 + 真跑 contract-dod-ws*.md 里的 manual:bash / jq -e 命令
3. **evaluator verdict = PASS** 才允许 merge：若任一 oracle FAIL（字段名漂 / schema keys 集合不等 / operation 字面量不等 / b=0 未拒 / 算术值不等 / 错误响应混入 result 字段），verdict = FAIL → fix_dispatch，**禁止** merge
4. **最终 task = completed**：当 evaluate verdict = PASS + merge_pr 成功后达成；timeout_sec = 3600s 内必达
5. **PR diff 最小**：只改 `playground/server.js`（`/divide` 路由 ≈ 1 行响应体修改 + 可能的常量复用）、`playground/tests/server.test.js`（`GET /divide` describe 块所有 `quotient` 断言替换 + 新增 schema 完整性 oracle）、`playground/README.md`（`/divide` 段示例响应更新）。**禁止改 server.js 中 `/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment` 路由代码或 test describe 块**
6. **回归不破坏**：本任务 PR merge 后，`/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment` 全部 6 条端点的 happy + 边界用例仍 PASS（test/server.test.js 全绿）

> **pre-merge gate 真生效的失败信号**（任一发生即视为 PR #2901 SC-6 未达成、需重开 issue）:
> - evaluator verdict = FAIL 但 PR 仍 merge（gate 漏过）
> - task 子图直接从 poll_ci → merge_pr（绕过 evaluate_contract 节点）
> - evaluator container 起不来 / 跑挂 / 返回 unknown verdict（gate 形同虚设）
> - generator 实现 / contract / PRD 字段名漂移但 pipeline 仍 task=completed（说明 oracle 链路漏检）
> - task = failed（gate 没问题但 pipeline 跑不动）

## 范围限定

**在范围内**：

- **改 `playground/server.js` `/divide` 路由的成功响应**：从 `res.json({ quotient: Number(a) / Number(b) })` 改为 `res.json({ result: Number(a) / Number(b), operation: 'divide' })`。其余该路由代码（缺参检查、strict-schema 校验、b=0 拒）一字不动
- **改 `playground/tests/server.test.js` `GET /divide` describe 块**：所有 `res.body.quotient` 断言改为 `res.body.result`；新增 schema 完整性断言（`Object.keys(res.body).sort() === ["operation","result"]`）+ operation 字面值断言（`res.body.operation === "divide"`）+ 错误响应 keys 字面集合断言（`Object.keys(res.body).sort() === ["error"]`）+ 错误响应不含 result/operation 断言；保留 happy（正/负/小数/被除数为 0 至少 4 条）+ b=0 除零拒（≥3 条，含 a=0&b=0、b=0.0、b=-0）+ strict 拒（≥5 条）+ 至少 2 条 oracle 值断言（`expect(res.body.result).toBe(Number('<a>')/Number('<b>'))`）
- **改 `playground/README.md` `/divide` 段**：把示例响应 `{"quotient": 3}` 改为 `{"result": 3, "operation": "divide"}`；保留 happy / 除零拒 / strict 拒 各 ≥1 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / decimal.js / bignumber.js / 任何外部库）
- 不改 `/health`、`/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现 / 单测 / README 段一字不动
- 不改 `/divide` 的 query param 名（仍是 `a` 与 `b`）、strict-schema 正则（仍是 `^-?\d+(\.\d+)?$`）、b=0 拒规则
- 不引入 BigInt / decimal 精度增强（除法浮点结果就按 JS Number 原生返回，同 W21）
- 不并存 `quotient` 字段（不许返 `{result, operation, quotient}` 兼容形态——schema 完整性 oracle 会挡）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不引入 `Number.isFinite` 结果兜底（strict + b=0 拒已保证结果为有限 JS Number；加多余兜底视为合同违约）
- 不动 `playground/package.json`（除非 vitest / supertest / express 版本升级——本任务不需要升级）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与所有现有路由一致；不引入额外字段）]
- [ASSUMPTION: strict-schema 复用 W20/W21 既有的 `STRICT_NUMBER` 常量 `^-?\d+(\.\d+)?$`（不重新发明；严禁就地写新正则字面量绕开常量复用）]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 pre-merge gate 死规则不可改名）；operation 值严格为字符串 `"divide"`（字面，不许 `"div"` / `"division"` 等变体）]
- [ASSUMPTION: 除零判定保持 `Number(b) === 0`（与 W21 一致；覆盖 `0`、`0.0`、`-0` 都算零）]
- [ASSUMPTION: 浮点结果不做精度截断；evaluator 复算用同表达式 `Number(a)/Number(b)` 比 `toBe` 严格相等]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `a` 与 `b`（与 W21 一致；不引入 `numerator` / `denominator` 等"语义化"名）]
- [ASSUMPTION: 本任务不需要 db migration / 不需要 brain 重启 / 不需要 docker 重建——纯 playground 子项目改动]
- [ASSUMPTION: harness pipeline 跑本任务时遵循 `journey_type: autonomous` 分类，evaluator 真起 playground server 真 curl 真 jq 校验]

## 预期受影响文件

- `playground/server.js`：`/divide` 路由 **成功响应** 由 `{quotient: Number(a)/Number(b)}` 改为 `{result: Number(a)/Number(b), operation: 'divide'}`（≈ 1 行修改，其余该路由代码一字不动）
- `playground/tests/server.test.js`：`GET /divide` describe 块所有断言重写——`quotient` → `result`、新增 `operation` 字面断言、新增 schema 完整性 keys 断言、新增错误响应 keys 断言；保留 happy + 除零拒 + strict 拒覆盖；其余 describe 块（health/sum/multiply/power/modulo/factorial/increment）一字不动
- `playground/README.md`：`/divide` 段示例响应 `{"quotient": 3}` 改为 `{"result": 3, "operation": "divide"}`；其余端点段一字不动

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本任务只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W26 同分类）。pre-merge gate 验收发生在 harness 编排层（task 子图 poll_ci → evaluate_contract → merge_pr），不影响本端点本身的 journey 分类
