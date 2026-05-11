# Sprint PRD — playground 加 GET /decrement endpoint（PR-H 验收：proposer v7.6 Bug 9 修复 — 每个合同 ≥4 条 [BEHAVIOR] + 0 借口）

## OKR 对齐

- **对应 KR**：W27 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`、W24 `/factorial`、W26 `/increment`），并作为 **PR-H 验收**——证明 Bug 9（proposer v7.6）"每个合同至少 4 条 [BEHAVIOR] + 0 借口" 修复后，proposer 不再以"路由小"/"功能简单"/"PRD 没列出"/"没找到对应字段" 等借口少写 [BEHAVIOR] 条目
- **当前进度**：W19~W26 跑通七条 endpoint，演进出"strict-schema + 输入规则拒 + 输出值兜底 + 单调用语义不变量 + 多调用递推不变量 + 字段名字面相等 oracle" 六类 oracle 范式；2026-05-11 #2893（PR-G）proposer SKILL.md v7.4 → v7.5 加"死规则"段（"PRD 是法律，proposer 是翻译，不许改字段名"）；2026-05-11 #2894（W26）真 GAN 跑验 PR-G 字段名字面照搬 PASS，但实证 proposer 在 [BEHAVIOR] 数量上仍倾向"省略"——v7.4 模板示例写"至少 4 条" 但被当作"软建议"，proposer 实际 round-1 输出常只给 1-2 条 [BEHAVIOR]（仅 happy + error），漏 schema 完整性 + 禁用字段反向 + 边界拒等关键 oracle
- **本次推进预期**：在 playground 上加第八个 endpoint `/decrement`，作为 **PR-H 验收**——PRD 显式要求所有 4 类 [BEHAVIOR] 必填且不可由 proposer 自由裁量跳过（schema 字段值 oracle / schema 完整性 oracle / 禁用字段反向 oracle / error path oracle 四类**强制各 ≥1 条**，合计 ≥4 条）。**Proposer v7.6 必须把"≥4 条 [BEHAVIOR] 且每类 ≥1 条"作为硬规则**——若 proposer 任一 round 合同 [BEHAVIOR] 总数 < 4 或缺失任一类，则视为 Bug 9 修复 **未真生效**，需重开 issue

## 背景

W26 是 PR-G（proposer 字段名字面照搬）的验收任务，目标是验 proposer 在合同 GAN 阶段不再"语义化优化" PRD 字段名。结果 **proposer 真照搬了字段名**（PRD `{result, operation: "increment"}` → 合同也用 `{result, operation: "increment"}`），PR-G 修复成功。

但 W26 真 GAN 跑实证暴露了下一个漂移点：**proposer 在 [BEHAVIOR] 数量上自由裁量**。

具体观察（W26 round-1 / round-2 proposer 草案）：
- proposer 倾向只写 1-2 条 [BEHAVIOR]（典型："happy + error"）就 stop，理由各种各样：
  - "路由太简单不需要那么多 [BEHAVIOR]"
  - "PRD 没显式列出所有 oracle"
  - "schema 完整性可以由 success behavior 间接保证"
  - "禁用字段反向 oracle 是多余的，generator 不会自由发挥"
  - "边界拒可以放进 vitest 不用 [BEHAVIOR]"
- proposer v7.4 SKILL Step 2b 模板**写了** "至少 4 条 [BEHAVIOR] 严示例（schema 字段 + 完整性 + 禁用字段反向 + error path）"，但表达成"示例建议"被 proposer 当**软建议**忽略；v7.5 加了字段名死规则但**没碰** [BEHAVIOR] 数量与类型分布
- 后果：evaluator round-1 verdict 是 PASS（happy + error 命中），但 schema 完整性 / 禁用字段反向 / 边界拒等关键 oracle **从未被 evaluator 真跑过**——只有当 W26 PRD 显式在范围限定写出"至少 X 条 oracle" 才补回；这是合同护栏在 [BEHAVIOR] **数量与类型分布**维度的漏洞

根本原因（推断 Cortex Insight）：proposer SKILL v7.4 ~ v7.5 把 [BEHAVIOR] 数量与类型描述成"示例 / 建议"，没把"≥4 条 + 4 类各 ≥1 条" codify 成**硬规则**（如：合同 lint / Reviewer 评分维度直接卡数量与类型分布）。LLM 看到"至少 4 条" 后倾向理解为"4 条是上限"或"可以 ≤4 条" —— 跟 v7.4 之前的字段名漂移问题同质，都是**软约束被 LLM 弱化**的典型。

PR-H（proposer v7.6 — 待合入）应在 SKILL.md 加 **硬规则**：每个 endpoint 合同必须 **总数 ≥ 4 条 [BEHAVIOR]** 且 **4 类各 ≥ 1 条**：

1. **schema 字段值 oracle** （每个 response 字段 1 条，证明字段值与独立复算严格相等）
2. **schema 完整性 oracle** （≥ 1 条断言 `keys | sort == [...]` 顶层 keys 字面集合相等，**不允许多余字段**）
3. **禁用字段反向 oracle** （≥ 1 条断言禁用清单中每个字段名 `has("xxx") | not`，证明 response 不含 PRD 禁用同义名）
4. **error path oracle** （≥ 1 条断言错误响应 HTTP 400 + `{error: <非空字符串>}` 且 body 不含成功字段）

**proposer 不许以任何借口跳过任一类**：
- 不许说"路由简单"
- 不许说"PRD 没显式列出"
- 不许说"vitest 已覆盖"
- 不许说"reviewer 会卡所以可省略"
- 不许说"4 条太多写不下"

**W27 `/decrement` 的核心使命**：用一个 **结构最简单**（单参整数，加减算术对偶 /increment）的 endpoint，故意制造 proposer "这么简单还需要 4 条 [BEHAVIOR] 吗？" 的偷懒诱惑——来在新一轮真 GAN 跑里**验**：proposer v7.6 硬规则是否真生效（合同 [BEHAVIOR] 总数 ≥ 4 且 4 类各 ≥ 1 条）。若 reviewer round-1+ 通过且 contract 含 4 类 [BEHAVIOR] 各 ≥ 1 条，则 PR-H 修复成功；若 contract [BEHAVIOR] 总数 < 4 或缺任一类，则视为 v7.6 硬规则失效，需重开 issue。

并行地，`/decrement` 是 `/increment` 的对偶：
- W26 `/increment`：`Number(value) + 1`，上界 `value === 9007199254740990 → result = MAX_SAFE_INTEGER`，再 +1 拒
- W27 `/decrement`：`Number(value) - 1`，下界 `value === -9007199254740990 → result = -MAX_SAFE_INTEGER`，再 -1 拒
- 同样 strict-schema `^-?\d+$`，同样绝对值上界 `9007199254740990`（保证 `value - 1` 在 `[-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER - 1]` 内）
- generator 不许复用 W26 模板假绿（响应字段值是 `-1`，operation 字面 `decrement`，禁用清单不同）

| oracle 形式 | W19 sum | W20 mul | W21 div | W22 pow | W23 mod | W24 fact | W26 inc | **W27 dec** |
|---|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`result === Number(value) - 1`） |
| strict-schema 白名单 | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（**`^-?\d+$` 整数允负数**） |
| 输入规则级拒 | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（**`|value| > 9007199254740990` 拒**） |
| 输出值级兜底 | — | — | — | ✓ | — | — | — | —（上界已挡住） |
| 单调用语义不变量 | — | — | — | — | ✓ | — | — | — |
| 多调用递推不变量 | — | — | — | — | — | ✓ | — | — |
| 字段名字面相等 oracle（PR-G 验收专用） | — | — | — | — | — | — | ✓ | ✓ |
| **[BEHAVIOR] 数量与类型分布 oracle**（PR-H 验收专用） | — | — | — | — | — | — | — | **✓（4 类各 ≥1 条，总数 ≥ 4）** |

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /decrement?value=5` 请求] → 经过 [playground server 用 strict-schema `^-?\d+$` 校验 value、显式拒绝 `|Number(value)| > 9007199254740990`（精度上界）、计算 `Number(value) - 1` 并返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation", "result"]`，`result === Number(value) - 1` 且 `operation === "decrement"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /decrement?value=<十进制整数字符串，含可选前导负号>` 到 playground server（默认端口 3000）
2. server 对 value 做 strict-schema 校验（白名单正则 `^-?\d+$`，**与 W19~W23 浮点 regex `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同，与 W26 的 `^-?\d+$` 等价但必须独立定义或字面量、不许跨路由共享常量假绿**）
3. strict-schema 通过后，**显式判定 `Math.abs(Number(value)) > 9007199254740990`**，是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `result` 字段（拒掉精度超界；超此值则 `value - 1` 可能丢精度）
4. 计算 `result = Number(value) - 1`（普通整数减 1，JS Number 在此范围内精确）
5. 返回 HTTP 200，JSON body 为 `{ "result": <Number(value)-1>, "operation": "decrement" }`（**两个字段都必填，字面字符串 "decrement" 不许变体**）
6. 任一参数缺失 / 不通过 strict-schema / `|value| > 9007199254740990` → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名 + operation 字面量 + schema 完整性 + 禁用字段反向 + error path **共 4 类 oracle 各 ≥ 1 条** 转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **PR-H 验收核心**：本段是 proposer **字面照搬 + 强制覆盖**的唯一 ground truth。Proposer SKILL v7.6 硬规则要求：合同 [BEHAVIOR] 总数 **≥ 4** 且 **4 类各 ≥ 1 条**（schema 字段值 / schema 完整性 / 禁用字段反向 / error path）；任一类 = 0 条视为 Bug 9 修复未生效。

### Endpoint: GET /decrement

**Query Parameters**（v8.2 — 强制约束 query param 名）:

- `value` (integer-as-string, 必填): 待减 1 的整数；必须完整匹配 strict-schema 正则 `^-?\d+$`（**十进制整数字符串，含可选前导负号；禁小数、禁前导 +、禁科学计数法、禁十六进制、禁千分位**），且 `Math.abs(Number(value)) <= 9007199254740990`
- **强约束**: proposer / generator 必须**字面用** `value` 作为 query param 名
- **禁用 query 名**: `n` / `x` / `y` / `m` / `k` / `i` / `j` / `a` / `b` / `p` / `q` / `val` / `num` / `number` / `int` / `integer` / `input` / `arg` / `arg1` / `input1` / `v1` / `v` / `count` / `size` / `len` / `length` / `target` / `from` / `start` —— 用错 query 名一律视为合同违约
- 用错 query 名 endpoint 应返 400（缺参分支）或 404

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "decrement"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(value) - 1`；由于 `|value| ≤ 9007199254740990 < MAX_SAFE_INTEGER`，`result` 必为精确整数无浮点损失
- `operation` (string, 必填): **字面字符串 `"decrement"`**，禁用变体 `dec` / `decr` / `decremented` / `decrementation` / `minus_one` / `sub_one` / `subtract_one` / `pred` / `predecessor` / `prev` / `previous` / `op` / `method` / `action` / `type` / `kind`
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `value` / `input` / `n` / `output` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code`

**禁用响应字段名**（response body 严禁出现，proposer/generator 不得自由发挥同义替代）:

- **首要禁用**（W26 镜像同义名 + W25 实证 proposer 易漂同义名，PR-G + PR-H 死规则黑名单）: `decremented` / `prev` / `previous` / `predecessor` / `n_minus_one` / `minus_one` / `sub_one` / `subtract_one` / `pred` / `dec` / `decr` / `decrementation` / `subtraction` / `difference`
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）、`product`（W20）、`quotient`（W21）、`power`（W22）、`remainder`（W23）、`factorial`（W24）、`negation`（W25）、`incremented`（W26 禁用名复用）—— 不许复用任一

**字段命名 + [BEHAVIOR] 数量 双重锁死的原因**：W25 实证 proposer 会"语义化优化"字段名（→ PR-G 字段名死规则）；W26 实证 proposer 会"省略"[BEHAVIOR] 条目（→ PR-H 数量与类型分布死规则）。本 endpoint 故意结构最简单（单参整数减 1），诱惑 proposer 偷懒——若 proposer v7.6 硬规则真生效，合同必须 **同时** 字面照搬字段名 **且** 输出 ≥ 4 条 [BEHAVIOR]（4 类各 ≥ 1 条）。

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令，分布到 4 类 [BEHAVIOR]）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等 — schema 完整性类）
- 200 成功响应：`jq -e '.operation == "decrement"'`（operation 字面量严格相等 — schema 字段值类）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number — schema 字段值类）
- 200 成功响应：`jq -e '.result == <独立 Number(value)-1 复算>'`（result 值正确 — schema 字段值类）
- 200 成功响应：`jq -e 'has("decremented") | not'`（禁用字段反向类 — 至少 1 条）
- 200 成功响应：`jq -e 'has("prev") | not'`（禁用字段反向类 — 同类多条加固）
- 200 成功响应：`jq -e 'has("predecessor") | not'`（禁用字段反向类 — 同类多条加固）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（error path 类）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error path 类）
- 400 错误响应：`jq -e 'has("result") | not'`（error path 类）
- 400 错误响应：`jq -e 'has("operation") | not'`（error path 类）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+$`（**十进制整数，允许前导负号；与 W19~W23 浮点 `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同，与 W26 等价但必须独立定义或就地字面量，不许跨路由共享常量假绿**）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|---|
| `value=0` | 合法 | 在范围内 | -1 | 200，`{result: -1, operation: "decrement"}` |
| `value=1` | 合法 | 在范围内 | 0 | 200，`{result: 0, operation: "decrement"}` |
| `value=5` | 合法 | 在范围内 | 4 | 200，`{result: 4, operation: "decrement"}` |
| `value=-1` | 合法 | 在范围内 | -2 | 200，`{result: -2, operation: "decrement"}` |
| `value=-5` | 合法 | 在范围内 | -6 | 200，`{result: -6, operation: "decrement"}` |
| `value=100` | 合法 | 在范围内 | 99 | 200，`{result: 99, operation: "decrement"}` |
| `value=-100` | 合法 | 在范围内 | -101 | 200，`{result: -101, operation: "decrement"}` |
| `value=9007199254740990` | 合法 | 在范围内（**精度上界**） | 9007199254740989 | 200，`{result: 9007199254740989, operation: "decrement"}` |
| `value=-9007199254740990` | 合法 | 在范围内（**精度下界**） | -9007199254740991 | 200，`{result: -9007199254740991, operation: "decrement"}`（**等于 -Number.MAX_SAFE_INTEGER**） |
| **`value=9007199254740991`** | strict 通过但超上界 | **拒** | — | **400**（`|value| > 9007199254740990` 上界拒） |
| **`value=-9007199254740991`** | strict 通过但超下界 | **拒** | — | **400**（`|value| > 9007199254740990` 下界拒） |
| **`value=99999999999999999999`** | strict 通过但远超上界 | **拒** | — | **400**（上界拒） |
| `value=01` | strict 通过（`^-?\d+$` 允许前导 0；`Number("01")=1`） | 在范围内 | 0 | **200**，`{result: 0, operation: "decrement"}` |
| `value=-01` | strict 通过（前导 0 允许） | 在范围内 | -2 | 200，`{result: -2, operation: "decrement"}` |
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

- **`value === 0` 与 `value === 1`**（结果分别为 -1 和 0）合法且必须返 `{result: -1, operation: "decrement"}` / `{result: 0, operation: "decrement"}`；显式断言，防 off-by-one
- **`value === "-9007199254740990"`**（精度下界字符串）合法且必须精确返 `{result: -9007199254740991, operation: "decrement"}`；显式断言 `result === -Number.MAX_SAFE_INTEGER`（即 `-9007199254740991`）
- **`value === "-9007199254740991"`**（精度下界 -1）必须 HTTP 400，body 不含 `result` 也不含 `operation`；这是 W27 唯一的 rule-based 拒绝路径（输入域级），与 W21 `b===0`、W22 `0^0`、W24 `n>18`、W26 上界 同范式但不同维度（W27 是双侧"绝对值上界拒"，与 W26 对偶但下界更紧）
- **`value === "9007199254740990"`** 合法返 `{result: 9007199254740989, operation: "decrement"}`；**`value === "9007199254740991"`** 必须 400（上界拒）
- **判定顺序必须严格**：缺参 → strict-schema → `|Number(value)| > 9007199254740990` 显式拒 → 计算 `Number(value)-1` → 200。错任一阶段都返 400 且 body 不含 `result`/`operation`
- **前导 0** 处理：`value=01` 通过 strict（`^-?\d+$` 允许）且 `Number("01") === 1`，与 `value=1` 等价返 `{result: 0, operation: "decrement"}`。这是 strict-schema 客观语义，proposer 须把此用例写进合同的 happy 分支
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `big-integer` / 任何外部库
- **JS Number 在范围内是精确整数**：`|value| ≤ 9007199254740990` 时 `Number(value) - 1` 精确无损；超过则 IEEE 754 双精度浮点表达不再唯一，故拒。**严禁 generator 用 BigInt 重写**（响应必为 JS Number 而非 BigInt 字符串）
- **strict-schema 顺序与 W20/W21/W22/W23/W24/W26 一致**：缺参 → 类型 + 正则 → 业务规则（绝对值上界拒）→ 算术
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **不出现结果非有限的情况**：对任意合法 `value`，`Number(value) - 1` 必有限精确——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底；绝对值上界已挡掉精度问题
- **不出现符号问题**：strict-schema 接受任意符号整数，结果可正可负可零；不需要 W23 风格符号 oracle
- **不出现跨调用关系**：单调用 oracle 充分（`result === Number(value) - 1`），不需要 W24 风格递推 oracle
- **与 W26 对偶但独立**：proposer 不许在合同里把 `/decrement` 描述为"等于 -1 × /increment 输入" 或类似跨路由依赖；本路由必须独立定义、独立 oracle、独立 [BEHAVIOR]

## PR-H 验收：proposer v7.6 [BEHAVIOR] 硬规则真生效

W27 不仅是 W19~W26 oracle 链的延伸，**核心是 PR-H 验收任务**——验证 #PR-H（Bug 9 fix）之后 proposer 在合同 GAN 阶段输出 **总数 ≥ 4 条 [BEHAVIOR] + 4 类各 ≥ 1 条** 的硬规则真生效。

**PR-H 验收 success criteria**（由 harness 运行后自动检查 / 人工最终签核）:

1. **proposer 输出合同**（任一 round）必须包含 **≥ 4 条 [BEHAVIOR]** 条目（grep `\[BEHAVIOR\]` 行数 ≥ 4）
2. **proposer 输出合同**必须 **4 类各 ≥ 1 条**（缺任一类即视为 Bug 9 修复未生效）：
   - 类 1 — **schema 字段值 oracle**：≥ 1 条断言 `result` 字段值与独立复算严格相等（如 `[BEHAVIOR] GET /decrement?value=5 → 200 + {result:4, operation:"decrement"}`）
   - 类 2 — **schema 完整性 oracle**：≥ 1 条断言成功响应顶层 keys 字面集合 == `["operation", "result"]`（如 `[BEHAVIOR] GET /decrement?value=5 顶层 keys 字面集合 == [operation, result]`）
   - 类 3 — **禁用字段反向 oracle**：≥ 1 条断言响应不含禁用同义名（如 `[BEHAVIOR] GET /decrement?value=5 响应不含任一禁用字段 decremented/prev/previous/predecessor/...`）
   - 类 4 — **error path oracle**：≥ 1 条断言错误响应 HTTP 400 + `{error: <非空字符串>}` 且 body 不含 `result` / `operation`（如 `[BEHAVIOR] GET /decrement?value=1.5 → 400 + {error: 非空字符串}，不含 result 也不含 operation`）
3. **proposer 输出合同**字段名仍字面照搬 PRD（PR-G 死规则不退化）：
   - response success key 字面 = `result` 与 `operation`（不退化到 `decremented` / `prev` / 等任一禁用同义名）
   - operation 字面值 = 字符串 `"decrement"`（不退化到 `"dec"` / `"prev"` 等）
   - response error key 字面 = `error`
4. **proposer 输出合同**必须每个 query param ≥ 1 条独立 `[BEHAVIOR]` 验（v7.4 + v8.2 强约束）：query param `value` 真出现 ≥ 1 条 `[BEHAVIOR]` 验
5. **reviewer 输出**：每 round reviewer 评分必须含 SKILL.md v6.2 全部 **7 个评分维度**；reviewer 第 6 维 `verification_oracle_completeness` 必须按"4 类 [BEHAVIOR] 各 ≥ 1 条" 死规则审查；如果新增第 8 维 `behavior_count_distribution`（PR-H 配套），则该维度必须出现且评分 ≥ 7
6. **generator 输出**：实现真按合同 query 名 `value` + 响应字段名 `result` + `operation: "decrement"` **字面照搬**，无 `decremented` / `prev` / 等漂移；CI vitest 真跑 4 类 oracle 全过
7. **evaluator 输出**：合同里的 schema 字段值 + 完整性 + 禁用字段反向 + error path 4 类 oracle **全部真起服务真 curl 真 jq 校验通过**；任一类被跳过 / 假绿 = 评测失败
8. **final_evaluate 状态**：PASS → task = completed

> **PR-H 验收的失败信号**（任一发生即重开 issue）:
> - proposer 任一 round 合同 [BEHAVIOR] 总数 < 4
> - proposer 任一 round 合同缺任一类 [BEHAVIOR]（schema 字段值 / 完整性 / 禁用字段反向 / error path）
> - proposer 给出"路由太简单" / "PRD 没显式列出" / "vitest 已覆盖" / "reviewer 会卡" / "数量是建议不是硬规则" 等借口少写
> - reviewer 任一 round 漏检 [BEHAVIOR] 数量与类型分布（评分给 ≥ 7 但实际 contract 缺类）
> - generator 实现字段名退化（合同 vs 实现差异）
> - evaluator schema 完整性 / 禁用字段反向 / error path 任一类 oracle 跳过 / 假绿

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/increment` 之后、`app.listen` 之前新增 `GET /decrement` 路由（含 strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + 普通减 1 算术 + 返回 `{result, operation: "decrement"}`）
- 在 `playground/tests/server.test.js` 新增 `GET /decrement` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` describe 块平级，覆盖：
  - happy path（含 `value=0`、`value=1`、`value=-1`、`value=5`、`value=-5`、`value=100`、`value=-100`、`value=9007199254740990`、`value=-9007199254740990` 至少 9 条；其中 `value=0` 和 `value=1` 各必须有独立用例显式断言 `result === -1` / `result === 0` 防 off-by-one）
  - 上界 / 下界拒（`value=9007199254740991`、`value=-9007199254740991`、`value=99999999999999999999` 至少 3 条）
  - strict-schema 拒（小数 `1.5`、小数 `1.0`、前导 +、双重负号、尾部负号、科学计数法、十六进制、千分位、空格、空串、字母串、Infinity、NaN、仅负号 各至少 1 条）
  - 至少 3 条 oracle 值断言：`expect(res.body.result).toBe(<独立 Number(value)-1 复算>)`，证明返回值与独立复算严格相等（其中至少 1 条覆盖精度下界 `value=-9007199254740990 → result=-9007199254740991 === -Number.MAX_SAFE_INTEGER`）
  - **W27 PR-H 核心**：至少 2 条 **schema 完整性 oracle** 断言：
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation','result']`（成功响应 keys 字面集合相等，不含多余字段）
    - 至少 1 条断言 `res.body.operation === 'decrement'`（operation 字面字符串严格相等）
  - 至少 1 条断言：失败响应 body 不含 `result` 字段，也不含 `operation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段）
  - 至少 1 条断言：成功响应不含任一禁用字段名（`decremented` / `prev` / `previous` / `predecessor` / `dec` / `decr` 等 — 反向断言）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/decrement`，给出 happy（含 `value=0`、`value=1` 边界、精度下界 `-9007199254740990`）、上界拒（`value=9007199254740991`）、下界拒（`value=-9007199254740991`）、strict 拒（小数 / 科学计数法 / 千分位 各示例）至少 6 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / bignumber.js / big-integer / mathjs / 任何外部库；不引入 BigInt 重写）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现或单测（一字不动）
- 不放宽上界（不接受 `|value| > 9007199254740990` 用 BigInt 或字符串大数表达）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（strict + 绝对值上界已保证结果有限精确；加多余兜底视为合同违约）
- 不写记忆化 / 缓存层（每次请求独立计算）
- 不引入"语义化优化"字段名（`decremented` / `prev` / `predecessor` 等）；PRD 字面法定不可改
- 不引入 W23 单调用语义不变量 oracle（减量算术无符号问题）
- 不引入 W24 跨调用递推不变量 oracle（单调用 oracle 充分）
- **不许 proposer 以任何借口跳过 4 类 [BEHAVIOR] 任一类**（路由简单 / PRD 没列 / vitest 已覆盖 / reviewer 会卡 / 数量是建议 等借口一律拒绝）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp `^-?\d+$`（与既有 `STRICT_NUMBER` 浮点 regex 不同，与 W24 整数非负 regex 不同——单独写一份新常量如 `STRICT_INT_WITH_NEG_DEC` 或就地写字面量，二选一；严禁跨路由复用同名常量假绿）]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 PR-G 死规则不可改名）；operation 值严格为字符串 `"decrement"`（字面）]
- [ASSUMPTION: 上界选 `9007199254740990` 的依据：`Number.MAX_SAFE_INTEGER === 9007199254740991`，所以 `value - 1 ≥ -MAX_SAFE_INTEGER` 当且仅当 `value ≥ -9007199254740990`；正侧对称取 `value ≤ 9007199254740990`，避免溢出相关精度问题，统一双侧绝对值上界]
- [ASSUMPTION: 减 1 计算用 `Number(value) - 1`（普通 JS 数值算术），不用 BigInt（无必要，且响应必须是 JS Number）]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `value`（与既有路由 `a`、`b`、`n` 形成可区分集合；与 W26 `/increment` 同名是有意为之——故意让 proposer 不能借口"复用 W26 模板"少写 [BEHAVIOR]）]
- [ASSUMPTION: `0` 与 `-0` 的 strict 判定：`^-?\d+$` 接受字符串 `-0`，`Number("-0") === -0`，`-0 - 1 === -1`，故 `value=-0` 合法返 `{result: -1, operation: "decrement"}`；与 `value=0` 等价]
- [ASSUMPTION: 前导 0 `01`、`-01` 通过 strict 后 `Number()` 自动归一化为 `1` / `-1`，结果分别 `0` / `-2`；proposer 须把此用例写进合同 happy 分支以挡 generator 错用 `parseInt(value, 8)` 八进制解析]
- [ASSUMPTION: proposer v7.6 SKILL.md 已合入"≥ 4 条 [BEHAVIOR] + 4 类各 ≥ 1 条"硬规则段；若未合入，本 PRD 仍然成立——硬规则信号通过 PRD `## PR-H 验收` 段传递给 proposer]

## 预期受影响文件

- `playground/server.js`：在 `/increment` 之后新增 `GET /decrement` 路由 + strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`（≈ 12-15 行）
- `playground/tests/server.test.js`：新增 `GET /decrement` describe 块（happy 9+ + 上界/下界拒 3+ + strict 拒 13+ + 值 oracle 3+ + schema 完整性 oracle 2+ + 错误体不含 result/operation 断言 + 错误体 keys=["error"] 断言 + 禁用字段反向断言 1+ + 回归断言 8+）
- `playground/README.md`：端点列表加 `/decrement`，补 happy（含 `value=0`、`value=1` 边界、精度下界）/ 上界拒 / 下界拒 / strict 拒 各示例（至少 6 个）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W26 同分类）
