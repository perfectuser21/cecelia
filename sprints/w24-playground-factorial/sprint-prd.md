# Sprint PRD — playground 加 GET /factorial endpoint（thin · int-only strict-schema · 上界 18 拒 · 递推不变量 oracle · inline SKILL pattern 真生效 PR-D 验收）

## OKR 对齐

- **对应 KR**：W24 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`），并作为 **PR-D 验收**——证明 Bug 6（#2889，commit 151eabedf）"inline SKILL pattern in GAN prompt builders" 修复后，reviewer 真正按 SKILL.md v6.2 的 **7 维 rubric** 评分，而非 brain hardcoded 5 维 rubric
- **当前进度**：W19 #2874+#2875 跑通 generator → evaluator；W20 #2878 收紧 strict-schema；W21 #2881 引入"除零兜底"作为 **输入规则级** oracle 探针；W22 #2882 引入"结果有限性兜底"作为 **输出值级** oracle 探针；W23 #2885 引入"符号不变量"作为 **单调用语义不变量级** oracle 探针；2026-05-10 #2884 完成 4-skill（planner/proposer/reviewer/generator）协议对齐；2026-05-11 #2889 修 Bug 6（reviewer/proposer prompt 改 inline SKILL pattern + 删除 brain hardcoded 53 行 5-dim rubric → SKILL.md 成为唯一 SSOT）
- **本次推进预期**：在 playground 上加第六个 endpoint `/factorial`，作为 **PR-D 验收**——证明 Bug 6 修复后 reviewer 真按 7 维 rubric 评分（W23 实测只输 5 维即为 Bug 6 现象，本次必须输 7 维）；同时新增 **跨调用递推不变量**（recursive invariant）作为 **多调用关系级** oracle 探针——W19~W22 oracle 都是"单次调用值复算"，W23 引入"单次调用值满足某不变量"，W24 第一次引入 **"多次调用之间的值满足递推关系"**：`factorial(n) === n * factorial(n-1)` 当 `n > 0`，evaluator 须发 ≥ 2 次 curl 抓两端响应再比对。若 generator 错用 floor 近似 / 误差累积浮点实现 / 错把 1! 写成 0 / 错把 0! 写成 0 等，必被该递推 oracle 抓住

## 背景

W21 `/divide` 引入"除零兜底"是 **输入规则级** 拒绝（看到 `b=0` 就拒，不计算）。
W22 `/power` 引入"结果有限性兜底"是 **输出值级** 拒绝（先算再用 `Number.isFinite` 兜底）。
W23 `/modulo` 引入"符号不变量"是 **单调用语义级** oracle（`sign(a%b) === sign(a)` 当 `a≠0`）。
W24 `/factorial` 把 oracle 推到 **多调用关系级**：单次调用 `factorial(n)` 的返回值正确性可以靠"内部独立复算" oracle 验证（`Number(n) <= 1 ? 1 : <product>`，evaluator 单 curl 即可），**但还要额外断言** `factorial(n) === n * factorial(n-1)`（n > 0 时），这要求 evaluator 在同一 oracle 块里发两次 curl，把两端响应 join 之后再做关系断言。这是 W19~W23 单 curl 单 oracle 范式的首次扩展。

并行地，W24 是 **PR-D 验收任务**：Bug 6（commit 151eabedf）把 buildProposerPrompt + buildReviewerPrompt 从"slash command + brain 内 hardcoded rubric"改成"inline SKILL pattern（'你是 X agent。按下面 SKILL 指令工作。\\n\\n[SKILL 全文]\\n\\n...'）"，并删除 brain 中 53 行 hardcoded 5-dim rubric，使 SKILL.md（含 v6.1 `verification_oracle_completeness` 和 v6.2 `behavior_count_position` 两个新维度）成为唯一 SSOT。W23 跑出来 reviewer 仅 5 维是 Bug 6 现象。W24 本次 reviewer 报告必须输 **7 维** 完整 rubric（含两新维），否则视为 Bug 6 修复失效，**这就是"PR-D-acceptance：验 inline SKILL pattern 真生效"的含义**。

此外，W24 是首条 **单参数** endpoint（W19~W23 全是双参），强制 generator 不能复用旧的双参 query 解析模板；strict-schema regex 也从允许浮点 / 负号的 `^-?\d+(\.\d+)?$` 切换到 **整数非负** 的 `^\d+$`，强制 generator 真理解"整数 only"语义，不许复读双参旧 regex 假绿。

W24 oracle 设计：

| oracle 形式 | W19 sum | W20 multiply | W21 divide | W22 power | W23 modulo | **W24 factorial** |
|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（独立 product 复算） |
| strict-schema 白名单 | — | ✓（`^-?\d+(\.\d+)?$`） | ✓ | ✓ | ✓ | ✓（**`^\d+$` 不同 regex**） |
| 输入规则级拒 | — | — | ✓（b=0） | ✓（0^0） | ✓（b=0） | ✓（**n > 18 上界拒**） |
| 输出值级兜底 | — | — | — | ✓（`Number.isFinite`） | — | — |
| 单调用语义不变量 | — | — | — | — | ✓（sign） | — |
| **多调用递推不变量** | — | — | — | — | — | **✓（`f(n) === n * f(n-1)`）** ← W24 新增 |

W24 强制 evaluator 在标准的"值复算严格相等"之外，**额外**断言 **跨调用递推关系**：
1. 输入非法（缺参 / strict-schema 拒 / n > 18）→ 400
2. 输入合法 + `n` 在 `[0, 18]` 区间 → 200 + `{factorial: result}`，且必须满足：
   - **值正确**：`factorial === <独立 product 复算>`（标准 oracle，沿用 W19~W23 范式）
   - **递推不变量**：当 `n > 0` 时，独立发起第二次请求 `GET /factorial?n=<n-1>`，断言 `factorial(n) === n * factorial(n-1)`（W24 新增 oracle 形式）
   - **边界**：`factorial(0) === 1`、`factorial(1) === 1`（数学定义显式断言）

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /factorial?n=5` 请求] → 经过 [playground server 用 strict-schema（非负整数白名单）校验 n、显式拒绝 `n > 18`（精度上界）、用迭代/递归独立复算 `n!` 并返回] → 到达 [收到 200 响应，body 为 `{ "factorial": 120 }`，且 `factorial === <独立复算 0..n 累积乘积>` 严格成立，且对 `n > 0` 满足 `factorial(n) === n * factorial(n-1)`（evaluator 发第二次请求验证）严格成立]

具体：

1. 客户端发 `GET /factorial?n=<非负十进制整数字符串>` 到 playground server（默认端口 3000）
2. server 对 n 做 strict-schema 校验（白名单正则 `^\d+$`，**与 W20/W21/W22/W23 的双参浮点 regex 不同**——必须是非负整数字面量，不允许小数点 / 负号 / 前导 + / 前导 0 之外的形式 / 科学计数法 / 十六进制）
3. strict-schema 通过后，**显式判定 `Number(n) > 18`**，是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `factorial` 字段（拒掉精度超界；JS Number 在 19! = 121645100408832000 已超 `Number.MAX_SAFE_INTEGER === 2^53 - 1 === 9007199254740991`，会丢失整数精度；18! = 6402373705728000 是 MAX_SAFE_INTEGER 之下最大的阶乘）
4. 计算 `result = 1; for (i = 2; i <= Number(n); i++) result *= i`（迭代实现；`n === 0` 或 `n === 1` 直接得 1）
5. 返回 HTTP 200，JSON body 为 `{ "factorial": result }`（整数，精确无精度损失）
6. 任一参数缺失 / 不通过 strict-schema / `n > 18` → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `factorial`

## Response Schema

> 把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名转成 `jq -e` / `curl` 命令，evaluator 真起服务真校验。避免 generator 自由发挥 query 名（W22 实证 generator 漂移到 `a/b`，但 W24 是单参，generator 极易漂移到 `value/x/num/number/input` 等同义词）或漂移结果字段名（W19/W20 实证 generator 倾向把字段写成 generic `result`）。

### Endpoint: GET /factorial

**Query Parameters**:
- `n` (non-negative-integer-as-string, 必填): 阶乘的输入参数；必须完整匹配 strict-schema 正则 `^\d+$`（**纯非负十进制整数字符串**），且 `Number(n) <= 18`
- **强约束**: generator 必须**字面用** `n` 作为 query param 名
- **禁用 query 名**: `x` / `y` / `m` / `k` / `i` / `j` / `a` / `b` / `p` / `q` / `value` / `val` / `num` / `number` / `int` / `integer` / `input` / `arg` / `arg1` / `input1` / `v1` / `v` / `count` / `size` / `len` / `length` —— generator 不得用任何别名替代 `n`；用错 query 名 endpoint 应返 400（缺参分支）或 404
- 用错 query 名一律视为合同违约（与 W22 v8.2 / W23 加固保持一致）

**Success (HTTP 200)**:
```json
{"factorial": <number>}
```
- `factorial` (number, 必填): JS Number，等于独立迭代复算 `1 * 2 * ... * Number(n)`（n=0 或 n=1 时为 1）；由于 `n ≤ 18`，结果必为 ≤ 6402373705728000 的精确整数，无浮点精度损失
- 顶层 keys 必须 **完全等于** `["factorial"]`，**不允许多余字段**（不允许加 `operation`、`result`、`n`、`input`、`value`、`fact`、`f`、`output` 等任何附加字段）

**Error (HTTP 400)**:
```json
{"error": "<非空 string>"}
```
- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `factorial` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info`

**禁用响应字段名**（response body 严禁出现，generator 不得自由发挥同义替代）：
- `result`、`value`、`answer`、`fact`、`f`、`n!`、`out`、`output`、`data`、`payload`、`response`、`product`（**注意 `product` 是 W20 字段名，不能复用到 `/factorial`**）
- `sum`、`quotient`、`power`、`remainder`（这是 W19/W21/W22/W23 的字段名，不能复用）

**字段命名锁死的原因**：W19/W20 实测出 generator 倾向把结果字段写成 `result`（generic），违反"动作-结果名"一致命名规约（add→sum / multiply→product / divide→quotient / power→power / modulo→remainder / **factorial→factorial**）。本 endpoint 显式锁定 `factorial`，proposer 必须把 `jq -e '.factorial | type == "number"'` 与 `jq -e 'keys == ["factorial"]'` 作为强制 oracle 命令写进合同。

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^\d+$`（**纯非负十进制整数**；与 W20/W21/W22/W23 浮点 regex `^-?\d+(\.\d+)?$` 不同——必须重新写一份，不许复用浮点 regex 假绿）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|---|
| `n=0` | 合法 | 在 `[0, 18]` 范围 | 1（0!=1，数学定义） | 200，`{factorial: 1}` |
| `n=1` | 合法 | 在 `[0, 18]` 范围 | 1（1!=1） | 200，`{factorial: 1}` |
| `n=2` | 合法 | 在 `[0, 18]` 范围 | 2 | 200，`{factorial: 2}` |
| `n=3` | 合法 | 在 `[0, 18]` 范围 | 6 | 200，`{factorial: 6}` |
| `n=5` | 合法 | 在 `[0, 18]` 范围 | 120 | 200，`{factorial: 120}` |
| `n=10` | 合法 | 在 `[0, 18]` 范围 | 3628800 | 200，`{factorial: 3628800}` |
| `n=12` | 合法 | 在 `[0, 18]` 范围 | 479001600 | 200，`{factorial: 479001600}` |
| `n=18` | 合法 | 在 `[0, 18]` 范围（**精度上界**） | 6402373705728000 | 200，`{factorial: 6402373705728000}` |
| **`n=19`** | strict 通过但超上界 | **拒** | — | **400**（n > 18 上界拒，超 MAX_SAFE_INTEGER） |
| **`n=20`** | strict 通过但超上界 | **拒** | — | **400**（n > 18 上界拒） |
| **`n=100`** | strict 通过但超上界 | **拒** | — | **400**（n > 18 上界拒） |
| `n=-1` | strict 拒（负号不合 `^\d+$`） | — | — | 400 |
| `n=-5` | strict 拒（负号） | — | — | 400 |
| `n=5.5` | strict 拒（小数点） | — | — | 400 |
| `n=5.0` | strict 拒（小数点；即使数值是整数也拒） | — | — | 400 |
| `n=+5` | strict 拒（前导 +） | — | — | 400 |
| `n=05` | strict 通过（`^\d+$` 允许前导 0；Number("05")=5） | 在 `[0, 18]` 范围 | 120 | **200**，`{factorial: 120}`（与 `n=5` 等价） |
| `n=1e2` | strict 拒（科学计数法） | — | — | 400 |
| `n=0xff` | strict 拒（十六进制 / 含非数字字符 x） | — | — | 400 |
| `n=1,000` | strict 拒（千分位） | — | — | 400 |
| `n=` | strict 拒（空串） | — | — | 400 |
| `n=abc` | strict 拒 | — | — | 400 |
| `n=Infinity` | strict 拒 | — | — | 400 |
| `n=NaN` | strict 拒 | — | — | 400 |
| 缺 n（无 query） | — | — | — | 400 |

## 边界情况

- **`n === 0` 与 `n === 1`**（数学定义 0! = 1! = 1）合法且必须返 `{factorial: 1}`；显式断言，防 generator 错写 `0! = 0` 或 off-by-one
- **`n === 18`**（精度上界）合法且必须精确返 `6402373705728000`；显式断言此值与 `Number.MAX_SAFE_INTEGER` 的关系（`6402373705728000 < 9007199254740991`，整数精度无损）
- **`n === 19`**（精度上界外）必须 HTTP 400，body 不含 `factorial`；这是 W24 唯一的 rule-based 拒绝路径（输入域级），与 W21 `/divide` 的 `b === 0`、W22 `/power` 的 `0^0` 是同范式但不同维度（W24 是"范围拒"而非"单点拒"）
- **递推不变量**（W24 核心 oracle 探针）：所有 `Number(n) > 0` 的成功响应必须满足跨调用关系 `factorial(n) === n * factorial(n-1)`；evaluator 须发 ≥ 2 次 curl 抓 `n` 与 `n-1` 两端响应，再做乘法关系断言；若 generator 用 Stirling 近似、Lanczos gamma 近似、浮点累积误差实现，必被抓
- **判定顺序必须严格**：缺参 → strict-schema → `n > 18` 显式拒 → 计算 `n!` → 200。错任一阶段都返 400 且 body 不含 `factorial`
- **前导 0** 处理：`n=05` 通过 strict（`^\d+$` 允许）且 `Number("05") === 5`，与 `n=5` 等价返 `{factorial: 120}`。这是 strict-schema 的客观语义，proposer 须把此用例写进合同的 happy 分支
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `decimal.js` / 任何外部库
- **大整数**：18! 在 JS Number 内是精确整数（< MAX_SAFE_INTEGER），不需要 BigInt。严禁 generator 用 BigInt 重写（响应必为 JS Number 而非 BigInt 字符串）
- **strict-schema 顺序与 W20/W21/W22/W23 一致**：缺参 → 类型 + 正则 → 业务规则（`n > 18` 拒）→ 算术
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 现有行为不受影响**（不动这六条路由的代码、单测、README 段一个字符）
- **不出现结果非有限的情况**：对任意 `n ∈ [0, 18]`，`n!` 一定有限且精确——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底；上界 18 已经把"结果可能丢精度"的输入挡在 strict 之后的业务规则那层
- **不出现符号问题**：strict-schema 已禁负数，结果必为正整数；不需要 W23 风格符号 oracle

## PR-D 验收：Bug 6 inline SKILL pattern 真生效

W24 不仅是 W23 oracle 链的延伸，**同时是 PR-D 验收任务**——验证 #2889（Bug 6 fix）之后 GAN 链路真按 SKILL.md v6.2 的 **7 维 rubric** 跑，而不再是 brain hardcoded 5 维。

**PR-D 验收 success criteria**（由 harness 运行后自动检查 / 人工最终签核）：

1. **reviewer 输出**：本次 sprint 的 reviewer round-1+ 输出必须包含 SKILL.md v6.2 的全部 7 个评分维度，含 W23 之前缺失的两个：
   - `verification_oracle_completeness`（v6.1 新增）
   - `behavior_count_position`（v6.2 新增）
   - 缺任一即视为 Bug 6 修复 **未真生效**，需重开 issue
2. **proposer 输出**：合同包含 ≥ 1 条 `[BEHAVIOR]` per query param，且 query param `n` 真出现 ≥ 1 条独立 `[BEHAVIOR]` 验（v7.4 新增约束）
3. **generator 输出**：实现真按合同 query 名 `n` + 响应字段名 `factorial` 字面照搬，无 `value/x/num/result/fact` 等漂移
4. **evaluator 输出**：合同里的 `n=18 → factorial=6402373705728000` 精度边界与 `n=19 → 400` 上界拒、以及 **跨调用递推不变量**（`f(5)===5*f(4)` 之类）三类 oracle 全部执行且通过

> PR-D 验收的失败信号：任一 reviewer round 输出 5 维（缺 v6.1/v6.2 两维）；或 generator 用 `value` / `num` / `result` 字段；或合同没有跨调用 oracle。

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/modulo` 之后、`app.listen` 之前新增 `GET /factorial` 路由（含 strict-schema `^\d+$` 校验 + `n > 18` 显式上界拒 + 迭代复算）
- 在 `playground/tests/server.test.js` 新增 `GET /factorial` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo` describe 块平级，覆盖：
  - happy path（含 `n=0`、`n=1`、`n=2`、`n=5`、`n=10`、`n=12`、`n=18` 至少 7 条；其中 `n=0` 和 `n=1` 各必须有独立用例显式断言 `factorial === 1`）
  - 上界拒（`n=19`、`n=20`、`n=100` 至少 3 条）
  - strict-schema 拒（负数、小数、前导 +、科学计数法、十六进制、千分位、空串、字母串、缺参 各至少 1 条）
  - 至少 3 条 oracle 值断言：`expect(res.body.factorial).toBe(<独立复算>)`，证明返回值与独立复算严格相等（其中至少 1 条覆盖 `n=18` 边界，断言值严格等于 `6402373705728000`）
  - **W24 核心**：至少 2 条 **跨调用递推不变量** oracle 断言：在同一测试用例里发两次 supertest 请求（`GET /factorial?n=k` 与 `GET /factorial?n=k-1`），断言 `body_k.factorial === k * body_(k-1).factorial`；至少 1 条覆盖 `k=5`（小数），至少 1 条覆盖 `k=18`（精度上界，断言 `body_18.factorial === 18 * body_17.factorial` 严格相等）
  - 至少 1 条 schema oracle：断言 `Object.keys(res.body).sort()` 严格等于 `['factorial']`（成功响应不含多余字段）
  - 至少 1 条断言：失败响应 body 不含 `factorial` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段，含 `factorial` 即失败）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/factorial`，给出 happy（含 `n=0` 边界）、上界拒（`n=19`）、strict 拒、递推不变量示例 各至少 1 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / bignumber.js / decimal.js / mathjs / 任何外部库；不引入 BigInt 重写阶乘）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 的实现或单测（一字不动）
- 不引入 Stirling / Lanczos gamma 近似（明确锁死整数迭代精确复算）
- 不支持负数阶乘 / 浮点阶乘 / 复数阶乘（gamma 函数延拓）；本 endpoint 仅支持非负整数阶乘
- 不放宽上界（不接受 `n > 18` 用 BigInt 或字符串大数表达）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（strict + `n ≤ 18` 已保证结果有限精确；加多余兜底视为合同违约）
- 不写记忆化 / 缓存层（每次请求独立计算）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp `^\d+$`（与既有 `STRICT_NUMBER` 浮点 regex 不同——单独写一份新常量如 `STRICT_NON_NEG_INT` 或就地写字面量，二选一；严禁复用 `STRICT_NUMBER` 假绿）]
- [ASSUMPTION: 响应 body 字段名为 `factorial`（与 `sum`、`product`、`quotient`、`power`、`remainder` 同一命名规约——动作的语义结果名）]
- [ASSUMPTION: 阶乘计算用迭代实现（`for` 循环或 `Array.from({length: n+1}, ...).reduce`），不用递归（避免极端边界栈深；虽 n≤18 不会真栈溢出，但迭代更直白可读）]
- [ASSUMPTION: `n > 18` 判定用 `Number(n) > 18`（strict-schema 已先排除 `0xff`、空串、负数等假绿，进入此判定的 n 必是非负十进制整数字面量）]
- [ASSUMPTION: 上界选 18 的依据：`18! === 6402373705728000 < 9007199254740991 === Number.MAX_SAFE_INTEGER`，整数精度无损；`19! === 121645100408832000 > MAX_SAFE_INTEGER`，会进入双精度浮点近似（实际 19! 的 Number 表达是 121645100408832000，恰好可表达，但 20! = 2432902008176640000 已被 round 到非精确值；为了 hard cap，统一在 18 处拒，不在 19 处给"边界假绿"）]
- [ASSUMPTION: 0! = 1 是数学定义（空积），不是计算结果；显式 if 短路或迭代初值 1 + 循环不执行均可]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: 跨调用递推 oracle 在单测层用 supertest 在同一 `it()` 里两次 `await request(app).get(...)`；不要求 evaluator 在 contract 层一定用两条 `curl`（contract 层 evaluator 可以仍是单 curl + jq，但必须有至少一条独立的递推关系命令——这部分细则由 proposer 在合同 GAN 时定，本 PRD 只锁 What）]

## 预期受影响文件

- `playground/server.js`：在 `/modulo` 之后新增 `GET /factorial` 路由 + strict-schema `^\d+$` 校验 + `n > 18` 显式上界拒 + 迭代复算（≈ 12 行）
- `playground/tests/server.test.js`：新增 `GET /factorial` describe 块（happy 7+ + 上界拒 3+ + strict 拒 8+ + 值 oracle 3+ + 跨调用递推 oracle 2+ + schema oracle 2+ + 错误体不含 `factorial` 断言 + 回归断言 6+）
- `playground/README.md`：端点列表加 `/factorial`，补 happy（含 `n=0`）/ 上界拒 / strict 拒 / 跨调用递推示例 各示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19 /sum、W20 /multiply、W21 /divide、W22 /power、W23 /modulo 同分类）
