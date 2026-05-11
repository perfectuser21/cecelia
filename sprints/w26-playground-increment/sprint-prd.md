# Sprint PRD — playground 加 GET /increment endpoint（PR-G 验收：proposer 字面用 PRD 字段名）

## OKR 对齐

- **对应 KR**：W26 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`、W24 `/factorial`），并作为 **PR-G 验收**——证明 Bug 8（#2893，commit 006a577e5）"proposer SKILL v7.5 死规则禁 PRD 字段名漂移" 修复后，proposer 在合同 GAN 阶段**字面照搬** PRD `## Response Schema` 段的字段名 / operation 字面量 / 禁用清单 / schema keys 集合，**不再"语义化优化"**到更直观的同义名
- **当前进度**：W19~W24 跑通六条 endpoint，演进出"strict-schema + 输入规则拒 + 输出值兜底 + 单调用语义不变量 + 多调用递推不变量"五类 oracle 范式；2026-05-10 #2884 完成 4-skill 协议对齐；2026-05-11 #2889（PR-D）修 Bug 6 reviewer/proposer inline SKILL pattern；#2891（PR-E）修 Bug 7 generator inline SKILL pattern；W25 跑出来 generator 已严守 contract（PR-E 真生效），但 contract 本身漂了 PRD（PRD `{result,operation}` → contract `{negation}`），漂移源从 generator 上移到 proposer；2026-05-11 #2893（PR-G）proposer SKILL.md v7.4 → v7.5 加"死规则"段（"PRD 是法律，proposer 是翻译，不许改字段名"）+ 4 类严禁对照表 + 自查 checklist
- **本次推进预期**：在 playground 上加第七个 endpoint `/increment`，作为 **PR-G 验收**——PRD 显式锁死 response 字段名为 generic 风格的 `{result, operation: "increment"}`（**同 W25 negate 的命名模式**），同时显式禁用大量"语义化优化"同义名（`incremented` / `next` / `successor` / `n_plus_one` / `plus_one` / `succ` / `inc` / `value` / `input` / `output` / `data` / `payload` 等）。**Proposer 必须字面照搬 PRD 字段名进入合同**——若仍漂移到任一禁用名，则视为 Bug 8 修复 **未真生效**，需重开 issue。Generator 严守 contract（PR-E 已修），contract 严守 PRD（PR-G 本次验），两层漂移都堵后 final_evaluate 必 PASS、task=completed

## 背景

W25 是 PR-E（generator inline SKILL pattern）的验收任务，目标是验 generator 不再漂移合同字段。结果 **generator 真严守了合同**（合同写 `{negation:-5}`，generator 实现也输出 `{negation:-5}`），但 **合同本身漂了 PRD**：PRD `## Response Schema` 明确写 `{result, operation: "negate"}`、并把 `negation` 列入"禁用响应字段名"，proposer 在合同 GAN 阶段把它"语义化优化"成了 `{negation}`。

漂移源 **从 generator 上移到了 proposer**——这反而是 PR-E 真生效的反面证据（generator 这一层已完全可控）。

根本原因（commit 006a577e5 learning 已闭环）：proposer SKILL v7.4 说"PRD response 字段必须 codify 成 jq -e"，但没强约束"**字面**使用 PRD 字段名"。LLM 看到 PRD 写 `negate` endpoint 后倾向把字段命名"语义化优化"成 `{negation}`（看起来更直观），即便 PRD 明确写禁用 `negation`。LLM 没把 PRD 字段名视为"不可改的字面法定"。

PR-G 在 proposer SKILL.md v7.5 加了 **死规则** 段，含 4 类严禁对照表（response key / operation 值 / 禁用清单 / schema keys 集合）+ 自查 checklist（写完 contract 前 grep PRD keys vs contract keys 字面相等）。

**W26 `/increment` 的核心使命**：用一个 **故意采用 generic 字段名**（`result` + `operation: "increment"`）的 endpoint 设计——这是 proposer 最容易"优化"成 `{incremented}` / `{next}` / `{result, operation: "inc"}` 的命名形态——来在新一轮真 GAN 跑里**验**：proposer v7.5 死规则是否真生效（合同字段 = PRD 字段，字面相等）。若 reviewer round-1+ 通过且 contract 用 `{result, operation: "increment"}` 字面照搬，则 PR-G 修复成功；若 contract 仍含 `incremented` / `next` / 等任一禁用字段名，则视为 v7.5 死规则失效，需重开 issue。

并行地，`/increment` 是首个 **单参数 + 允许负数** 的 endpoint：
- W24 `/factorial` 是单参但 `^\d+$` 仅非负整数；W26 用 `^-?\d+$` 单参整数允许负数
- W22~W23 是双参浮点 `^-?\d+(\.\d+)?$`
- generator 不许复用任一旧 regex 假绿

| oracle 形式 | W19 sum | W20 mul | W21 div | W22 pow | W23 mod | W24 fact | **W26 inc** |
|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`result === Number(value) + 1`） |
| strict-schema 白名单 | — | ✓（浮点） | ✓ | ✓ | ✓ | ✓（`^\d+$`） | ✓（**`^-?\d+$` 整数允负数**） |
| 输入规则级拒 | — | — | ✓（b=0） | ✓（0^0） | ✓（b=0） | ✓（n>18） | ✓（**`|value| > 9007199254740990` 拒**） |
| 输出值级兜底 | — | — | — | ✓ | — | — | —（上界已挡住） |
| 单调用语义不变量 | — | — | — | — | ✓（sign） | — | — |
| 多调用递推不变量 | — | — | — | — | — | ✓ | — |
| **字段名字面相等 oracle**（PR-G 验收专用） | — | — | — | — | — | — | **✓（PRD/contract/impl keys 字面三等）** |

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /increment?value=5` 请求] → 经过 [playground server 用 strict-schema `^-?\d+$` 校验 value、显式拒绝 `|Number(value)| > 9007199254740990`（精度上界）、计算 `Number(value) + 1` 并返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation", "result"]`，`result === Number(value) + 1` 且 `operation === "increment"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /increment?value=<十进制整数字符串，含可选前导负号>` 到 playground server（默认端口 3000）
2. server 对 value 做 strict-schema 校验（白名单正则 `^-?\d+$`，**与 W19~W23 浮点 regex `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同**——必须重新定义新常量或字面量，不许复用旧 regex 假绿）
3. strict-schema 通过后，**显式判定 `Math.abs(Number(value)) > 9007199254740990`**（即 `Number.MAX_SAFE_INTEGER - 1`），是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `result` 字段（拒掉精度超界；超此值则 `value + 1` 可能丢精度）
4. 计算 `result = Number(value) + 1`（普通整数加 1，JS Number 在此范围内精确）
5. 返回 HTTP 200，JSON body 为 `{ "result": <Number(value)+1>, "operation": "increment" }`（**两个字段都必填，字面字符串 "increment" 不许变体**）
6. 任一参数缺失 / 不通过 strict-schema / `|value| > 9007199254740990` → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名 + operation 字面量 + schema 完整性转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **PR-G 验收核心**：本段是 proposer **字面照搬**的唯一 ground truth。Proposer SKILL v7.5 死规则要求：contract `jq -e` 用的 key 名 / operation 字面量 / 禁用清单 / schema keys 集合，**全部必须与本段字面相等**（grep 对比通过）。任一漂移视为 Bug 8 修复未生效。

### Endpoint: GET /increment

**Query Parameters**（v8.2 — 强制约束 query param 名，避免 generator/proposer 漂移）:

- `value` (integer-as-string, 必填): 待加 1 的整数；必须完整匹配 strict-schema 正则 `^-?\d+$`（**十进制整数字符串，含可选前导负号；禁小数、禁前导 +、禁科学计数法、禁十六进制、禁千分位**），且 `Math.abs(Number(value)) <= 9007199254740990`
- **强约束**: proposer / generator 必须**字面用** `value` 作为 query param 名
- **禁用 query 名**: `n` / `x` / `y` / `m` / `k` / `i` / `j` / `a` / `b` / `p` / `q` / `val` / `num` / `number` / `int` / `integer` / `input` / `arg` / `arg1` / `input1` / `v1` / `v` / `count` / `size` / `len` / `length` / `target` —— 用错 query 名一律视为合同违约
- 用错 query 名 endpoint 应返 400（缺参分支）或 404

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "increment"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(value) + 1`；由于 `|value| ≤ 9007199254740990 < MAX_SAFE_INTEGER`，`result` 必为精确整数无浮点损失
- `operation` (string, 必填): **字面字符串 `"increment"`**，禁用变体 `inc` / `incr` / `incremented` / `incrementation` / `plus_one` / `add_one` / `succ` / `successor` / `next` / `op` / `method` / `action` / `type` / `kind`
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `value` / `input` / `n` / `output` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code`

**禁用响应字段名**（response body 严禁出现，proposer/generator 不得自由发挥同义替代）:

- **首要禁用**（W25 实证 proposer 最易漂到的同义名，PR-G 死规则黑名单）: `incremented` / `next` / `successor` / `n_plus_one` / `plus_one` / `succ` / `inc` / `incr` / `incrementation` / `addition`
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）、`product`（W20）、`quotient`（W21）、`power`（W22）、`remainder`（W23）、`factorial`（W24）、`negation`（W25）—— 不许复用

**字段命名锁死的原因**：W25 实证 proposer 看到 `/negate` endpoint PRD 写 `{result, operation: "negate"}` 后倾向把字段"语义化优化"成 `{negation}`（看起来更直观），违反 PRD 字面法定。本 endpoint 同样用 generic `{result, operation: "increment"}`，故意制造 proposer "优化"诱惑——若 proposer v7.5 死规则真生效，合同必须字面照搬 `result` + `"increment"`；若漂到 `{incremented}` / `{next}` / `{result, operation: "inc"}` 等任一禁用形态，则 PR-G 验收失败。

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "increment"'`（operation 字面量，**字符串严格相等**，不是 contains/startsWith）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number）
- 200 成功响应：`jq -e '.result == <独立 Number(value)+1 复算>'`（result 值正确）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+$`（**十进制整数，允许前导负号；与 W19~W23 浮点 `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同——必须重新写一份，不许复用旧 regex 假绿**）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|---|
| `value=0` | 合法 | 在范围内 | 1 | 200，`{result: 1, operation: "increment"}` |
| `value=1` | 合法 | 在范围内 | 2 | 200，`{result: 2, operation: "increment"}` |
| `value=5` | 合法 | 在范围内 | 6 | 200，`{result: 6, operation: "increment"}` |
| `value=-1` | 合法 | 在范围内 | 0 | 200，`{result: 0, operation: "increment"}` |
| `value=-5` | 合法 | 在范围内 | -4 | 200，`{result: -4, operation: "increment"}` |
| `value=100` | 合法 | 在范围内 | 101 | 200，`{result: 101, operation: "increment"}` |
| `value=-100` | 合法 | 在范围内 | -99 | 200，`{result: -99, operation: "increment"}` |
| `value=9007199254740990` | 合法 | 在范围内（**精度上界**） | 9007199254740991 | 200，`{result: 9007199254740991, operation: "increment"}` |
| `value=-9007199254740990` | 合法 | 在范围内（**精度下界**） | -9007199254740989 | 200，`{result: -9007199254740989, operation: "increment"}` |
| **`value=9007199254740991`** | strict 通过但超上界 | **拒** | — | **400**（`|value| > 9007199254740990` 上界拒） |
| **`value=-9007199254740991`** | strict 通过但超下界 | **拒** | — | **400**（`|value| > 9007199254740990` 下界拒） |
| **`value=99999999999999999999`** | strict 通过但远超上界 | **拒** | — | **400**（上界拒） |
| `value=01` | strict 通过（`^-?\d+$` 允许前导 0；`Number("01")=1`） | 在范围内 | 2 | **200**，`{result: 2, operation: "increment"}` |
| `value=-01` | strict 通过（前导 0 允许） | 在范围内 | 0 | 200，`{result: 0, operation: "increment"}` |
| `value=1.0` | strict 拒（小数点） | — | — | 400 |
| `value=1.5` | strict 拒（小数点） | — | — | 400 |
| `value=+5` | strict 拒（前导 +；regex 只允许前导负号） | — | — | 400 |
| `value=--5` | strict 拒（双重负号） | — | — | 400 |
| `value=5-` | strict 拒（尾部负号） | — | — | 400 |
| `value=1e2` | strict 拒（科学计数法） | — | — | 400 |
| `value=0xff` | strict 拒（十六进制） | — | — | 400 |
| `value=1,000` | strict 拒（千分位逗号） | — | — | 400 |
| `value=1 000` | strict 拒（含空格） | — | — | 400 |
| `value=` | strict 拒（空串） | — | — | 400 |
| `value=abc` | strict 拒 | — | — | 400 |
| `value=Infinity` | strict 拒 | — | — | 400 |
| `value=NaN` | strict 拒 | — | — | 400 |
| `value=-` | strict 拒（仅负号无数字） | — | — | 400 |
| 缺 value（无 query） | — | — | — | 400 |

## 边界情况

- **`value === 0` 与 `value === -1`**（结果分别为 1 和 0）合法且必须返 `{result: 1, operation: "increment"}` / `{result: 0, operation: "increment"}`；显式断言，防 off-by-one
- **`value === "9007199254740990"`**（精度上界字符串）合法且必须精确返 `{result: 9007199254740991, operation: "increment"}`；显式断言 `result === Number.MAX_SAFE_INTEGER`
- **`value === "9007199254740991"`**（精度上界 +1）必须 HTTP 400，body 不含 `result` 也不含 `operation`；这是 W26 唯一的 rule-based 拒绝路径（输入域级），与 W21 `b===0`、W22 `0^0`、W24 `n>18` 是同范式但不同维度（W26 是双侧"绝对值上界拒"）
- **`value === "-9007199254740990"`** 合法返 `{result: -9007199254740989, operation: "increment"}`；**`value === "-9007199254740991"`** 必须 400（下界拒）
- **判定顺序必须严格**：缺参 → strict-schema → `|Number(value)| > 9007199254740990` 显式拒 → 计算 `Number(value)+1` → 200。错任一阶段都返 400 且 body 不含 `result`/`operation`
- **前导 0** 处理：`value=01` 通过 strict（`^-?\d+$` 允许）且 `Number("01") === 1`，与 `value=1` 等价返 `{result: 2, operation: "increment"}`。这是 strict-schema 客观语义，proposer 须把此用例写进合同的 happy 分支
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `big-integer` / 任何外部库
- **JS Number 在范围内是精确整数**：`|value| ≤ 9007199254740990` 时 `Number(value) + 1` 精确无损；超过则 IEEE 754 双精度浮点表达不再唯一，故拒。**严禁 generator 用 BigInt 重写**（响应必为 JS Number 而非 BigInt 字符串）
- **strict-schema 顺序与 W20/W21/W22/W23/W24 一致**：缺参 → 类型 + 正则 → 业务规则（绝对值上界拒）→ 算术
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 现有行为不受影响**（不动这七条路由的代码、单测、README 段一个字符）
- **不出现结果非有限的情况**：对任意合法 `value`，`Number(value) + 1` 必有限精确——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底；绝对值上界已挡掉精度问题
- **不出现符号问题**：strict-schema 接受任意符号整数，结果可正可负可零；不需要 W23 风格符号 oracle
- **不出现跨调用关系**：单调用 oracle 充分（`result === Number(value) + 1`），不需要 W24 风格递推 oracle

## PR-G 验收：proposer v7.5 死规则真生效

W26 不仅是 W19~W24 oracle 链的延伸，**核心是 PR-G 验收任务**——验证 #2893（Bug 8 fix）之后 proposer 在合同 GAN 阶段**字面照搬**本 PRD `## Response Schema` 段的字段名 / operation 字面量 / 禁用清单 / schema keys 集合，而不再"语义化优化"。

**PR-G 验收 success criteria**（由 harness 运行后自动检查 / 人工最终签核）:

1. **proposer 输出合同**（任一 round）必须包含以下 **字面字段名**（grep PRD keys vs contract keys 字面相等）:
   - response success key 字面 = `result` 与 `operation`（**禁用任一禁用清单字段名替代**：`incremented` / `next` / `successor` / `n_plus_one` / `plus_one` / `succ` / `inc` / `incr` / `incrementation` 等）
   - operation 字面值 = 字符串 `"increment"`（**禁用变体**：`"inc"` / `"incr"` / `"plus_one"` / `"add_one"` / `"succ"` / `"next"` 等）
   - response error key 字面 = `error`（禁用 `message` / `msg` / `reason` 等）
   - schema 完整性断言 keys 集合 = `["operation","result"]`（成功）/ `["error"]`（错误），字面相等
2. **proposer 输出合同**必须有 **每个 query param ≥ 1 条独立 `[BEHAVIOR]` 验**（v7.4 + v8.2 强约束）：query param `value` 真出现 ≥ 1 条 `[BEHAVIOR]` 验
3. **reviewer 输出**：每 round reviewer 评分必须含 SKILL.md v6.2 全部 **7 个评分维度**（含 `verification_oracle_completeness` 与 `behavior_count_position`）；reviewer 第 6 维 `verification_oracle_completeness` 必须按"死规则"对比表（response key / operation 值 / 禁用清单 / schema keys 集合）逐项审 proposer 合同字面相等
4. **generator 输出**：实现真按合同 query 名 `value` + 响应字段名 `result` + `operation: "increment"` **字面照搬**，无 `incremented` / `next` / `incremented_value` / `result_value` 等漂移
5. **evaluator 输出**：合同里的 `value=9007199254740990 → result=9007199254740991` 精度边界、`value=9007199254740991 → 400` 上界拒、`value=-9007199254740991 → 400` 下界拒、`value=01 → result=2` 前导 0、`value=1.0 → 400` strict 拒 这五类 oracle 全部执行且通过；schema 完整性 oracle（`keys | sort == ["operation","result"]`）必须真起服务真 curl 真 jq 校验通过
6. **final_evaluate 状态**：PASS → task = completed

> **PR-G 验收的失败信号**（任一发生即重开 issue）:
> - proposer 任一 round 合同含 `{incremented}` / `{next}` / `{successor}` / `{result, operation: "inc"}` / `{result, operation: "incrementation"}` 等任一禁用形态
> - reviewer 任一 round 第 6 维 `verification_oracle_completeness` 评分 ≥ 7 但实际 contract 字段名漂移（reviewer 漏检）
> - generator 实现字段名不一致（合同 vs 实现差异）
> - evaluator schema 完整性 oracle 跳过 / 假绿

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /increment` 路由（含 strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + 普通加 1 算术 + 返回 `{result, operation: "increment"}`）
- 在 `playground/tests/server.test.js` 新增 `GET /increment` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` describe 块平级，覆盖：
  - happy path（含 `value=0`、`value=-1`、`value=1`、`value=5`、`value=-5`、`value=100`、`value=-100`、`value=9007199254740990`、`value=-9007199254740990` 至少 9 条；其中 `value=0` 和 `value=-1` 各必须有独立用例显式断言 `result === 1` / `result === 0` 防 off-by-one）
  - 上界 / 下界拒（`value=9007199254740991`、`value=-9007199254740991`、`value=99999999999999999999` 至少 3 条）
  - strict-schema 拒（小数 `1.5`、小数 `1.0`、前导 +、双重负号、尾部负号、科学计数法、十六进制、千分位、空格、空串、字母串、Infinity、NaN、仅负号 各至少 1 条）
  - 至少 3 条 oracle 值断言：`expect(res.body.result).toBe(<独立 Number(value)+1 复算>)`，证明返回值与独立复算严格相等（其中至少 1 条覆盖精度上界 `value=9007199254740990 → result=9007199254740991`）
  - **W26 PR-G 核心**：至少 2 条 **schema 完整性 oracle** 断言：
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation','result']`（成功响应 keys 字面集合相等，不含多余字段）
    - 至少 1 条断言 `res.body.operation === 'increment'`（operation 字面字符串严格相等，不是 contains/startsWith）
  - 至少 1 条断言：失败响应 body 不含 `result` 字段，也不含 `operation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/increment`，给出 happy（含 `value=0`、`value=-1` 边界、精度上界 `9007199254740990`）、上界拒（`value=9007199254740991`）、下界拒（`value=-9007199254740991`）、strict 拒（小数 / 科学计数法 / 千分位 各示例）至少 6 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / bignumber.js / big-integer / mathjs / 任何外部库；不引入 BigInt 重写）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 的实现或单测（一字不动）
- 不放宽上界（不接受 `|value| > 9007199254740990` 用 BigInt 或字符串大数表达）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（strict + 绝对值上界已保证结果有限精确；加多余兜底视为合同违约）
- 不写记忆化 / 缓存层（每次请求独立计算）
- 不引入"语义化优化"字段名（`incremented` / `next` / `successor` 等）；PRD 字面法定不可改
- 不引入 W23 单调用语义不变量 oracle（增量算术无符号问题）
- 不引入 W24 跨调用递推不变量 oracle（单调用 oracle 充分）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp `^-?\d+$`（与既有 `STRICT_NUMBER` 浮点 regex 不同，与 W24 整数非负 regex 不同——单独写一份新常量如 `STRICT_INTEGER` / `STRICT_INT_WITH_NEG` 或就地写字面量，二选一；严禁复用 `STRICT_NUMBER` 假绿）]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 PR-G 死规则不可改名）；operation 值严格为字符串 `"increment"`（字面）]
- [ASSUMPTION: 上界选 `9007199254740990` 的依据：`Number.MAX_SAFE_INTEGER === 9007199254740991`，所以 `value + 1 ≤ MAX_SAFE_INTEGER` 当且仅当 `value ≤ 9007199254740990`；负侧对称取 `value ≥ -9007199254740990`，避免减法相关精度问题，统一双侧绝对值上界]
- [ASSUMPTION: 加 1 计算用 `Number(value) + 1`（普通 JS 数值算术），不用 BigInt（无必要，且响应必须是 JS Number）]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `value`（与既有路由 `a`、`b`、`n` 形成可区分集合；不复用 `n` 避免 generator 复读 W24 模板）]
- [ASSUMPTION: `0` 与 `-0` 的 strict 判定：`^-?\d+$` 接受字符串 `-0`，`Number("-0") === -0`，`-0 + 1 === 1`，故 `value=-0` 合法返 `{result: 1, operation: "increment"}`；与 `value=0` 等价。proposer 可选择把此用例放进 happy 分支或 strict 边界讨论]
- [ASSUMPTION: 前导 0 `01`、`-01` 通过 strict 后 `Number()` 自动归一化为 `1` / `-1`，结果分别 `2` / `0`；proposer 须把此用例写进合同 happy 分支以挡 generator 错用 `parseInt(value, 8)` 八进制解析（虽 ES2015+ 已禁但仍可能踩坑）]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 之后新增 `GET /increment` 路由 + strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + `Number(value) + 1` 算术 + 返回 `{result, operation: "increment"}`（≈ 12-15 行）
- `playground/tests/server.test.js`：新增 `GET /increment` describe 块（happy 9+ + 上界/下界拒 3+ + strict 拒 13+ + 值 oracle 3+ + schema 完整性 oracle 2+ + 错误体不含 result/operation 断言 + 错误体 keys=["error"] 断言 + 回归断言 7+）
- `playground/README.md`：端点列表加 `/increment`，补 happy（含 `value=0`、`value=-1` 边界、精度上界）/ 上界拒 / 下界拒 / strict 拒 各示例（至少 6 个）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W24 同分类）
