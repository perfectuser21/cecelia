# Sprint PRD — playground 加 GET /modulo endpoint（thin · strict-schema · sign-of-dividend oracle）

## OKR 对齐

- **对应 KR**：W23 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`）
- **当前进度**：W19 #2874+#2875 跑通 generator → evaluator；W20 #2878 收紧 strict-schema；W21 #2881 引入"除零兜底"作为 **输入规则级** oracle 探针；W22 #2882 引入"结果有限性兜底"作为 **输出值级** oracle 探针；2026-05-10 #2884 完成 4-skill（planner/proposer/reviewer/generator）协议对齐
- **本次推进预期**：在 playground 上加第五个 endpoint `/modulo`，作为 **PR-C 验收**——证明 4-skill 协议对齐后链路仍跑通；新增 **被除数符号不变量**（sign-of-dividend invariant）作为 **语义不变量级** oracle 探针——W19~W22 的 oracle 都是"值等于复算"，W23 第一次引入"值满足某个不变量"的 oracle 形式（具体：`sign(a % b) === sign(a)` 当 `a !== 0`），证明 evaluator 能识别符号语义错误（区分 JS truncated mod vs 数学 floored mod，generator 若错用 `((a%b)+b)%b` 之类的 floored 包装必挂）

## 背景

W21 引入"除零兜底"是 **输入规则级** 拒绝（看到 `b=0` 就拒，不计算）。

W22 引入"结果有限性兜底"是 **输出值级** 拒绝（先算再用 `Number.isFinite` 兜底）。

W23 `/modulo` 把 oracle 推到 **不变量级**：strict-schema 通过 + `b !== 0` 之后，JS 原生 `a % b` 对任意有限 a / 有限 b≠0 的输入 **必然** 返回有限数，所以 W22 那种"结果非有限"的兜底在这里不会触发；这层不再有"结果不可表示"问题。W23 的核心 oracle 是 **符号语义**：

| 输入 | JS truncated 结果（本 endpoint 期望） | 数学 floored 结果（错的实现） | 区别 |
|---|---|---|---|
| `a=5, b=3` | `5 % 3 = 2` | `2` | 同号一致 |
| `a=-5, b=3` | `-5 % 3 = -2` | `1` | **不同号！** |
| `a=5, b=-3` | `5 % -3 = 2` | `-1` | **不同号！** |
| `a=-5, b=-3` | `-5 % -3 = -2` | `-2` | 同号一致 |
| `a=0, b=5` | `0 % 5 = 0` | `0` | 一致（0 无符号） |

W23 oracle 强制每个 `a !== 0` 的成功响应满足 `Math.sign(remainder) === Math.sign(Number(a))` —— 如果 generator 实现了 floored mod，符号会和 a 不一致（举例 `-5 % 3` floored 是 `1`，符号是 `+1`，与 `Math.sign(-5) === -1` 不等），oracle 必然抓住。

这一设计强制 evaluator 在标准的"值复算严格相等"之外，**额外**断言 **不变量**：
1. 输入非法（缺参 / strict-schema 拒）→ 400
2. 输入合法 + `b === 0` → 400（rule-based reject，复用 W21 范式）
3. 输入合法 + `b !== 0` → 200 + `{remainder: result}`，且必须满足：
   - **值正确**：`remainder === Number(a) % Number(b)`（标准 oracle，沿用 W19~W22 范式）
   - **符号不变量**：`Math.sign(remainder) === Math.sign(Number(a))` 当 `Number(a) !== 0`（W23 新增 oracle 形式）

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /modulo?a=5&b=3` 请求] → 经过 [playground server 用 strict-schema 校验 a/b、显式拒绝 `b=0`、计算 `Number(a) % Number(b)` 并返回] → 到达 [收到 200 响应，body 为 `{ "remainder": 2 }`，且 `remainder === Number(a) % Number(b)` 严格成立，且 `Math.sign(remainder) === Math.sign(Number(a))`（当 `a !== 0` 时）严格成立]

具体：

1. 客户端发 `GET /modulo?a=<标准十进制字符串>&b=<标准十进制字符串>` 到 playground server（默认端口 3000）
2. server 对 a 和 b 各自做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`，与 `/multiply`、`/divide`、`/power` 同款）
3. strict-schema 通过后，**显式判定 `Number(b) === 0`**，是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `remainder` 字段（拒掉除零，复用 W21 范式）
4. 计算 `result = Number(a) % Number(b)`（JS 原生取模运算符）
5. 返回 HTTP 200，JSON body 为 `{ "remainder": result }`（JS 原生 truncated 取模结果，符号跟随被除数 a；浮点输入按 JS Number 原生精度返回，evaluator 用同一表达式复算比对）
6. 任一参数缺失 / 不通过 strict-schema / `b=0` → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `remainder`

## Response Schema

> 把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名转成 `jq -e` / `curl` 命令，evaluator 真起服务真校验。避免 generator 自由发挥 query 名（W22 实证 generator 漂移到 `a/b`，但 W23 与 W22 完全沿用 `a/b` 字面 query 名以保持回归一致性）或漂移结果字段名（W19/W20 实证 generator 倾向把字段写成 generic `result`）。

### Endpoint: GET /modulo

**Query Parameters**:
- `a` (number-as-string, 必填): 被除数（dividend）；必须完整匹配 strict-schema 正则 `^-?\d+(\.\d+)?$`
- `b` (number-as-string, 必填): 除数（divisor）；必须完整匹配 strict-schema 正则 `^-?\d+(\.\d+)?$`，且 `Number(b) !== 0`
- **强约束**: generator 必须**字面用** `a` 和 `b` 作为 query param 名（与 W19~W22 一致）
- **禁用 query 名**: `x` / `y` / `p` / `q` / `n` / `m` / `dividend` / `divisor` / `numerator` / `denominator` / `input1` / `input2` / `v1` / `v2` / `arg1` / `arg2` —— generator 不得用任何别名替代 `a` / `b`；用错 query 名 endpoint 应返 400（缺参分支）或 404
- 用错 query 名一律视为合同违约（与 W22 v8.2 加固保持一致）

**Success (HTTP 200)**:
```json
{"remainder": <number>}
```
- `remainder` (number, 必填): JS 原生取模结果 `Number(a) % Number(b)`，必为有限数（对任意 strict-schema 合法 a 与 `b !== 0` 都有限）；保留原生浮点精度，不四舍五入
- 顶层 keys 必须 **完全等于** `["remainder"]`，**不允许多余字段**（不允许加 `operation`、`result`、`a`、`b`、`input`、`quotient`、`dividend`、`divisor` 等任何附加字段）

**Error (HTTP 400)**:
```json
{"error": "<非空 string>"}
```
- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `remainder` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info`

**禁用响应字段名**（response body 严禁出现，generator 不得自由发挥同义替代）：
- `result`、`value`、`answer`、`mod`、`modulo`、`rem`、`rest`、`residue`、`out`、`output`、`data`、`payload`、`response`
- `sum`、`product`、`quotient`、`power`（这是 W19/W20/W21/W22 的字段名，不能复用到 `/modulo`）

**字段命名锁死的原因**：W19/W20 实测出 generator 倾向把结果字段写成 `result`（generic），违反"动作-结果名"一致命名规约（add→sum / multiply→product / divide→quotient / power→power / **modulo→remainder**）。本 endpoint 显式锁定 `remainder`，proposer 必须把 `jq -e '.remainder | type == "number"'` 与 `jq -e 'keys == ["remainder"]'` 作为强制 oracle 命令写进合同。

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（与 W20 `/multiply`、W21 `/divide`、W22 `/power` 完全一致，不重新发明）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（JS truncated） | 期望响应 |
|---|---|---|---|---|
| `a=5&b=3` | 双方合法 | b≠0 | 2 | 200，`{remainder: 2}` |
| `a=10&b=3` | 双方合法 | b≠0 | 1 | 200，`{remainder: 1}` |
| `a=7&b=2` | 双方合法 | b≠0 | 1 | 200，`{remainder: 1}` |
| `a=6&b=2` | 双方合法 | b≠0 | 0（整除） | 200，`{remainder: 0}` |
| `a=5.5&b=2` | 双方合法 | b≠0 | 1.5（浮点） | 200，`{remainder: 1.5}` |
| `a=-5&b=3` | 双方合法 | b≠0 | **-2**（符号跟随 a，**W23 关键 oracle**） | 200，`{remainder: -2}` |
| `a=5&b=-3` | 双方合法 | b≠0 | **2**（符号跟随 a） | 200，`{remainder: 2}` |
| `a=-5&b=-3` | 双方合法 | b≠0 | **-2**（符号跟随 a） | 200，`{remainder: -2}` |
| `a=0&b=5` | 双方合法 | b≠0 | 0（被除数为 0） | 200，`{remainder: 0}` |
| `a=0&b=-5` | 双方合法 | b≠0 | 0 | 200，`{remainder: 0}` |
| **`a=5&b=0`** | strict 通过但 b=0 | **拒** | — | **400**（除零兜底） |
| **`a=0&b=0`** | strict 通过但 b=0 | **拒** | — | **400**（除零兜底，0%0 也归此分支） |
| **`a=-5&b=0`** | strict 通过但 b=0 | **拒** | — | **400**（除零兜底） |
| `a=1e3&b=2` | a 非法（科学计数法） | — | — | 400 |
| `a=Infinity&b=2` | a 非法 | — | — | 400 |
| `a=2&b=NaN` | b 非法 | — | — | 400 |
| `a=+2&b=3` | a 非法（前导 +） | — | — | 400 |
| `a=.5&b=2` | a 非法（缺整数部分） | — | — | 400 |
| `a=2.&b=3` | a 非法（缺小数部分） | — | — | 400 |
| `a=0xff&b=2` | a 非法（十六进制） | — | — | 400 |
| `a=1,000&b=2` | a 非法（千分位） | — | — | 400 |
| `a=&b=3` | a 空串 | — | — | 400 |
| `a=abc&b=3` | a 非数字 | — | — | 400 |
| 缺 a 或缺 b 或全缺 | — | — | — | 400 |

## 边界情况

- **`b === 0`**（包括 `0`、`0.0`、`-0`、`-0.0`）是 W23 唯一的 rule-based 拒绝路径，与 W21 `/divide` 完全同款（`Number(b) === 0`）；JS 原生 `a % 0 === NaN`，必须显式拒掉而不是返 NaN
- **符号语义**（W23 核心 oracle 探针）：所有 `Number(a) !== 0` 的成功响应必须满足 `Math.sign(remainder) === Math.sign(Number(a))`；JS truncated mod 符号跟随被除数；若 generator 用 floored mod（`((a % b) + b) % b`）实现，`-5 % 3` 会返 `1` 而非 `-2`，oracle 必抓
- **判定顺序必须严格**：缺参 → strict-schema → `b === 0` 显式拒 → 计算 `a % b` → 200。错任一阶段都返 400 且 body 不含 `remainder`
- **整除场景**（`a=6&b=2`、`a=10&b=5`）合法，`remainder === 0`
- **浮点取模**（`a=5.5&b=2 → 1.5`）合法，按 JS Number 原生精度返回，不四舍五入
- **负数场景**全部按 JS truncated 语义：
  - `(-5) % 3 = -2`（符号跟随 -5）
  - `5 % (-3) = 2`（符号跟随 5）
  - `(-5) % (-3) = -2`（符号跟随 -5）
- **`a === 0`** 场景：`0 % N = 0` 对任意 `N !== 0` 合法；`Math.sign(0) === 0`，oracle 对 a=0 不施加符号断言（仅断言 `remainder === 0`）
- **strict-schema 顺序与 W20/W21/W22 一致**：缺参 → 类型 + 正则 → 业务规则（b=0 拒）→ 算术
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power` 现有行为不受影响**（不动这五条路由的代码、单测、README 段一个字符）
- **大数运算**：按 JS Number 原生处理，不引入 BigInt（与 W19~W22 同立场）
- **不出现结果非有限的情况**：对任意 strict-schema 合法的 a 与 `b !== 0`，`a % b` 一定有限——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底，proposer / generator 也不允许加这层多余兜底（与"合同外不加一字"原则一致）

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/power` 之后、`app.listen` 之前新增 `GET /modulo` 路由（含 strict-schema 复用 + `b=0` 显式拒）
- 在 `playground/tests/server.test.js` 新增 `GET /modulo` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power` describe 块平级，覆盖：
  - happy path（含正正、正负、负正、负负、整除、浮点、`0%N` 至少 6 条）
  - `b=0` 除零拒绝（至少 2 条，含 `a=5&b=0` 与 `a=0&b=0`）
  - strict-schema 拒绝（科学计数法、Infinity、NaN、前导 +、缺参、十六进制、千分位 各至少 1 条）
  - 至少 2 条 oracle 值断言：`expect(res.body.remainder).toBe(Number(a) % Number(b))`，证明返回值与独立复算严格相等（其中至少 1 条覆盖负被除数场景）
  - **W23 核心**：至少 2 条 **符号不变量** oracle 断言：`expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number(a)))`，至少 1 条为负被除数（如 `a=-5&b=3` 期望 `Math.sign === -1`），至少 1 条为正被除数（如 `a=5&b=-3` 期望 `Math.sign === 1`）
  - 至少 1 条 schema oracle：断言 `Object.keys(res.body).sort()` 严格等于 `['remainder']`（成功响应不含多余字段）
  - 至少 1 条断言：失败响应 body 不含 `remainder` 字段
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/modulo`，给出 happy / `b=0` 拒绝 / 符号语义示例 / strict 拒绝 各至少 1 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / decimal.js / bignumber.js / mathjs / 任何外部库）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power` 的实现或单测（一字不动）
- 不引入 BigInt / decimal 精度增强（浮点取模结果就按 JS Number 原生返回）
- 不实现数学 floored mod 或 Euclidean mod 语义（明确锁死 JS truncated 语义）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（W22 的范式不适用，因为 strict + b≠0 已保证结果有限；加多余兜底视为合同违约）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power` 一致）]
- [ASSUMPTION: strict-schema 用同一个原生 RegExp `^-?\d+(\.\d+)?$`（可复用现有 `STRICT_NUMBER` 常量或单独写一份语义等价的，二选一）]
- [ASSUMPTION: 响应 body 字段名为 `remainder`（与 `sum`、`product`、`quotient`、`power` 同一命名规约——动作的语义结果名，禁止漂移到 `result`、`value`、`mod`、`modulo`、`rem` 等）]
- [ASSUMPTION: 取模运算用 JS 原生 `%` 算子（truncated semantics），不用 `Math.floorDiv` / 自定义 floored mod 包装]
- [ASSUMPTION: `b === 0` 判定用 `Number(b) === 0`（同时覆盖 `0`、`0.0`、`-0`、`-0.0`；strict-schema 已先排除 `0xff`、空串等假绿）]
- [ASSUMPTION: 浮点结果不做精度截断；evaluator 复算用同表达式 `Number(a) % Number(b)` 比 `toBe` 严格相等]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: 符号 oracle 仅对 `Number(a) !== 0` 施加（因 `Math.sign(0) === 0`，对 a=0 单独断言 `remainder === 0` 即可）]

## 预期受影响文件

- `playground/server.js`：在 `/power` 之后新增 `GET /modulo` 路由 + strict-schema 校验 + `b=0` 显式拒（≈ 10 行）
- `playground/tests/server.test.js`：新增 `GET /modulo` describe 块（happy + 除零拒 + strict 拒 + 值 oracle + 符号不变量 oracle + schema oracle + 失败响应不含 `remainder` 断言）
- `playground/README.md`：端点列表加 `/modulo`，补 happy / `b=0` 拒 / 符号语义 / strict 拒 各示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19 /sum、W20 /multiply、W21 /divide、W22 /power 同分类）
