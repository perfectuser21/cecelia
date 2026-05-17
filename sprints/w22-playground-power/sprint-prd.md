# Sprint PRD — playground 加 GET /power endpoint（thin · strict-schema · result-finiteness oracle）

## OKR 对齐

- **对应 KR**：W22 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`）
- **当前进度**：W19 #2874+#2875 证明 generator → evaluator 能跑通；W20 #2878 把校验收紧到 strict-schema；W21 #2881 引入"除零兜底"作为 **输入规则级** oracle 探针（input-rule probe）
- **本次推进预期**：在 playground 上加第四个 endpoint `/power`，复用 W20 strict-schema + W21 显式兜底范式，新增 **结果有限性兜底**（result-finiteness gate）作为 **输出值级** oracle 探针——证明 harness pipeline 能识别"输入合法但输出不合法"这种更深一层的合同语义（W21 是"输入规则拒绝"，W22 是"结果不可表示拒绝"），evaluator 不仅复算算术值还要确认结果落在合法实数集内

## 背景

W21 `/divide` 通过"除零兜底"引入了第一个 **rule-based reject**——`b=0` 是输入侧的固定规则，看到就拒，不需要先做计算。

W22 `/power` 把 oracle 推到下一个层级：**只有先做完计算才能判断是否要拒绝**。指数函数 `a**b` 在多种 strict-schema 完全合法的输入下会得出 **不属于实数有限集** 的结果，必须显式拦截：

| 输入 | strict-schema | `Math.pow(a,b)` JS 原生结果 | 数学语义 | 必须 |
|---|---|---|---|---|
| `a=0, b=-1` | 双方合法 | `Infinity` | `1/0` 数学未定义 | **拒** |
| `a=0, b=-3` | 双方合法 | `Infinity` | 同上 | **拒** |
| `a=-2, b=0.5` | 双方合法 | `NaN` | 负数开平方非实数 | **拒** |
| `a=-8, b=0.5` | 双方合法 | `NaN` | 同上 | **拒** |
| `a=10, b=1000` | 双方合法（都是普通十进制） | `Infinity`（数值溢出） | 超出 IEEE 754 双精度范围 | **拒** |
| `a=2, b=10000` | 双方合法 | `Infinity`（溢出） | 同上 | **拒** |
| `a=0, b=0` | 双方合法 | JS 返回 `1`，但 `0^0` **数学未定义** | 形式不定式 | **拒**（保守） |

W22 的核心 oracle 探针：strict-schema 通过 → 计算 → **再** 用 `Number.isFinite(result) === true` **且** 显式拒掉 `0^0` 形式不定式 → 通过则 200 + `{power: result}`，否则 400。

这一设计强制 evaluator 必须能区分四类情况：
1. 输入非法（strict-schema 拒）→ 400
2. 输入合法 + 结果不可表示（0^负、负^分数、溢出、0^0）→ **400**（W22 新增路径）
3. 输入合法 + 结果可表示但 generator 写错算式 → 200 但 oracle 复算不等 → evaluator 判 FAIL
4. 输入合法 + 结果可表示 + 算式正确 → 200 + oracle 复算严格相等 → PASS

## Golden Path（核心场景）

HTTP 客户端从 [发起 GET /power?a=2&b=10 请求] → 经过 [playground server 用 strict-schema 校验 a/b、显式拒绝 `0^0` 不定式、计算 `a**b` 后用 `Number.isFinite` 拒绝非有限值、否则返回结果] → 到达 [收到 200 响应，body 为 `{ "power": 1024 }`，且 `power === Number(a) ** Number(b)` 严格成立]

具体：

1. 客户端发 `GET /power?a=<标准十进制字符串>&b=<标准十进制字符串>` 到 playground server（默认端口 3000）
2. server 对 a 和 b 各自做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`，与 `/multiply`、`/divide` 同款）
3. strict-schema 通过后，**显式判定 `Number(a) === 0 && Number(b) === 0`**，是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `power` 字段（拒掉数学不定式 `0^0`）
4. 计算 `result = Number(a) ** Number(b)`（JS 原生指数运算，等价于 `Math.pow(Number(a), Number(b))`）
5. 用 `Number.isFinite(result)` 判定，**`false` 则返回 HTTP 400** + `{ "error": "<非空说明字符串>" }`，body 不含 `power` 字段（覆盖 0^负 → Infinity、负^分数 → NaN、溢出 → Infinity）
6. 通过 → 返回 HTTP 200，JSON body 为 `{ "power": result }`（JS 原生指数结果，含浮点精度 — evaluator 用同一表达式复算比对）
7. 任一参数缺失 / 不通过 strict-schema → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `power`

## Response Schema

> 把响应字段 codify 成 oracle，让 proposer 把每个字段转成 `jq -e` 命令，evaluator 真起服务真 curl 真校验。

### Endpoint: GET /power

**Success (HTTP 200)**:
```json
{"power": <number>}
```
- `power` (number, 必填): JS 原生指数运算结果 `Number(a) ** Number(b)`，必为有限数（`Number.isFinite === true`）
- 顶层 keys 必须 **完全等于** `["power"]`，**不允许多余字段**（不允许加 `operation`、`result`、`a`、`b`、`input` 等任何附加字段）

**Error (HTTP 400)**:
```json
{"error": "<非空 string>"}
```
- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `power` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段

**禁用响应字段名**（response body 严禁出现，generator 不得自由发挥同义替代）：
- `result`、`value`、`answer`、`exp`、`exponent`、`exponentiation`、`pow`、`out`、`output`、`data`、`payload`、`response`
- `sum`、`product`、`quotient`（这是 W19/W20/W21 的字段名，不能复用到 /power）
- 错误时禁用 `message`、`msg`、`reason`、`detail`、`details`

**字段命名锁死的原因**：W19/W20 实测出 generator 倾向把结果字段写成 `result`（generic），违反"动作-结果名"一致命名规约（add→sum / multiply→product / divide→quotient / power→**power**）。本 endpoint 显式锁定 `power`，proposer 必须把"`jq -e '.power | type == \"number\"'`"和"`jq -e 'keys == [\"power\"]'`"作为强制 oracle 命令写进合同。

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（与 W20 `/multiply`、W21 `/divide` 完全一致，不重新发明）

| 输入示例 | strict-schema 判定 | 计算结果 | 期望响应 |
|---|---|---|---|
| `a=2&b=10` | 双方合法 | 1024（有限） | 200，`{power: 1024}` |
| `a=2&b=0.5` | 双方合法 | 1.4142135623730951（有限） | 200，`{power: 1.4142135623730951}` |
| `a=4&b=0.5` | 双方合法 | 2（有限） | 200，`{power: 2}` |
| `a=-2&b=3` | 双方合法 | -8（负整数指数有限） | 200，`{power: -8}` |
| `a=-2&b=2` | 双方合法 | 4（有限） | 200，`{power: 4}` |
| `a=2&b=-2` | 双方合法 | 0.25（有限） | 200，`{power: 0.25}` |
| `a=5&b=0` | 双方合法（5^0=1） | 1（有限） | 200，`{power: 1}` |
| `a=0&b=5` | 双方合法 | 0（有限） | 200，`{power: 0}` |
| `a=1&b=99999` | 双方合法 | 1（有限） | 200，`{power: 1}` |
| **`a=0&b=0`** | strict 通过但 0^0 不定式 | JS 返 1 但**拒** | **400**（不定式兜底） |
| **`a=0&b=-1`** | strict 通过但 0^负 | Infinity | **400**（结果非有限） |
| **`a=0&b=-3`** | strict 通过但 0^负 | Infinity | **400**（结果非有限） |
| **`a=-2&b=0.5`** | strict 通过但负^分数 | NaN | **400**（结果非有限） |
| **`a=-8&b=0.5`** | strict 通过但负^分数 | NaN | **400**（结果非有限） |
| **`a=10&b=1000`** | strict 通过但溢出 | Infinity | **400**（结果非有限） |
| **`a=2&b=10000`** | strict 通过但溢出 | Infinity | **400**（结果非有限） |
| `a=1e3&b=2` | a 非法（科学计数法） | — | 400 |
| `a=Infinity&b=2` | a 非法 | — | 400 |
| `a=2&b=NaN` | b 非法 | — | 400 |
| `a=+2&b=3` | a 非法（前导 +） | — | 400 |
| `a=.5&b=2` | a 非法（缺整数部分） | — | 400 |
| `a=2.&b=3` | a 非法（缺小数部分） | — | 400 |
| `a=0xff&b=2` | a 非法（十六进制） | — | 400 |
| `a=1,000&b=2` | a 非法（千分位） | — | 400 |
| `a=&b=3` | a 空串 | — | 400 |
| `a=abc&b=3` | a 非数字 | — | 400 |
| 缺 a 或缺 b 或全缺 | — | — | 400 |

## 边界情况

- **`0^0`** 是 W22 第一个核心拒绝路径：`Number(a) === 0 && Number(b) === 0` 必须显式判定并拒（JS 原生 `0 ** 0 === 1` 但数学意义未定义，保守拒掉）
- **结果非有限**（`Number.isFinite(result) === false`）是 W22 第二个核心拒绝路径，覆盖 `0^负` → Infinity、`负^分数` → NaN、`大底大指` 溢出 → Infinity
- **判定顺序必须严格**：缺参 → strict-schema → `0^0` 显式拒 → 计算 `a**b` → `Number.isFinite` 拒 → 否则 200。错任一阶段都返 400 且 body 不含 `power`
- **`5^0=1`、`0^5=0`、`1^N=1`** 等合法边界必须通过（不能误把所有含 0 / 含 1 / 含负数的也拒掉）
- **负数^整数** 合法（`-2^3 = -8`、`-2^2 = 4`）
- **小数指数（开方语义）**：仅当底数 ≥ 0 时合法（`4^0.5 = 2`），底数 < 0 必拒（`(-2)^0.5 = NaN`）
- **不能整除/无理数** 结果：`2^0.5 = 1.4142135623730951` 按 JS Number 浮点表示原样返回，不四舍五入
- **strict-schema 顺序与 W20/W21 一致**：缺参 → 类型 + 正则 → 业务规则 → 算术 → 结果有限性
- **`/health`、`/sum`、`/multiply`、`/divide` 现有行为不受影响**（不动这四条路由的代码与单测）
- **大数运算**：按 JS Number 原生处理，不引入 BigInt（与 W19/W20/W21 同立场）。溢出走 `Number.isFinite` 拒绝路径

## 范围限定

**在范围内**：

- 在 `playground/server.js` 新增 `GET /power` 路由（含 strict-schema 复用 + `0^0` 显式拒 + 结果有限性兜底）
- 在 `playground/tests/server.test.js` 新增 `GET /power` describe 块单测，与 `/sum`、`/multiply`、`/divide` describe 块平级，覆盖：
  - happy path（含 `2^10`、`2^0.5` 开方、`-2^3` 负底整指、`5^0`、`0^5`、`2^-2`、`1^N` 至少 6 条）
  - `0^0` 不定式拒绝（至少 1 条）
  - 结果非有限拒绝：`0^负`（≥1）+ `负^分数`（≥1）+ 溢出（≥1）共至少 3 条
  - strict-schema 拒绝（科学计数法、Infinity、NaN、前导 +、缺参、十六进制、千分位 各至少 1 条）
  - 至少 2 条 oracle 断言：`expect(res.body.power).toBe(Number(a) ** Number(b))`，证明返回值与独立复算严格相等（其中至少 1 条覆盖小数指数 / 开方场景）
  - 至少 1 条 schema oracle：断言 `Object.keys(res.body)` 严格等于 `['power']`（成功响应不含多余字段）
  - 至少 1 条断言：失败响应 body 不含 `power` 字段
- 在 `playground/README.md` 端点列表加 `/power`，给出 happy / `0^0` 拒绝 / 结果非有限拒绝 / strict 拒绝 各至少 1 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / decimal.js / bignumber.js / mathjs / 任何外部库）
- 不改 `/health`、`/sum`、`/multiply`、`/divide` 的实现或单测（一字不动）
- 不引入 BigInt / decimal 精度增强（指数浮点结果就按 JS Number 原生返回）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide` 一致）]
- [ASSUMPTION: strict-schema 用同一个原生 RegExp `^-?\d+(\.\d+)?$`（不重新发明，可与 `/multiply`、`/divide` 共享同一字面量或单独写一份均可，只要语义等价）]
- [ASSUMPTION: 响应 body 字段名为 `power`（与 `sum`、`product`、`quotient` 同一命名规约——动作的语义结果名，禁止漂移到 `result`、`value` 等通用名）]
- [ASSUMPTION: 指数运算用 JS 原生 `**` 算子或 `Math.pow`，二者结果完全等价（IEEE 754 双精度），允许任选一种]
- [ASSUMPTION: `0^0` 判定用 `Number(a) === 0 && Number(b) === 0`（覆盖 `0`、`0.0`、`-0` 都算零；strict-schema 已先排除 `0xff`、空串等假绿）]
- [ASSUMPTION: 结果有限性判定用 `Number.isFinite(result)`（同时覆盖 NaN、Infinity、-Infinity；不允许仅判 `result === Infinity`）]
- [ASSUMPTION: 浮点结果不做精度截断；evaluator 复算用同表达式 `Number(a) ** Number(b)` 比 `toBe` 严格相等]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与 `/sum`、`/multiply`、`/divide` 一致），具体文案由 generator 决定]

## 预期受影响文件

- `playground/server.js`：新增 `GET /power` 路由 + strict-schema 校验 + `0^0` 显式拒 + `Number.isFinite` 兜底
- `playground/tests/server.test.js`：新增 `GET /power` describe 块（happy + `0^0` 拒 + 结果非有限拒 + strict 拒 + oracle 复算断言 + schema oracle）
- `playground/README.md`：端点列表加 `/power`，补 happy / `0^0` 拒 / 结果非有限拒 / strict 拒 各示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19 /sum、W20 /multiply、W21 /divide 同分类）
