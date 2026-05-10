# Sprint PRD — playground 加 GET /divide endpoint（thin · strict-schema · oracle）

## OKR 对齐

- **对应 KR**：W21 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`）
- **当前进度**：W19 #2874+#2875 证明 generator → evaluator 能跑通；W20 #2878 证明 strict-schema 收紧后 pipeline 仍能跟上
- **本次推进预期**：在 playground 上加第三个 endpoint `/divide`，复用 W20 strict-schema，新增"除零拒绝"作为 oracle 探针——证明 harness pipeline 能识别"算术结果可外部独立复算"（oracle）的合同语义，evaluator 不再只看 200/400 通过率，而是真正比对算术值

## 背景

W19 `/sum` 是宽松校验（接受 `1e3`、`Infinity`），W20 `/multiply` 把校验收紧到 strict-schema（白名单正则 `^-?\d+(\.\d+)?$`）。两者验证的都是"输入合规性"。

W21 把 endpoint 换成除法（`a/b`），核心目的是验证 **oracle 链路**：除法天然存在两个值得测的算术语义——

1. **正向 oracle**：对任意合法 `(a, b)` 且 `b ≠ 0`，response body 的 `quotient` 必须严格等于 `Number(a) / Number(b)`（JS 原生算术结果）。evaluator 能用同一个公式独立复算，对比相等性，不靠"硬编码期望值"。
2. **反向 oracle（除零兜底）**：当 `b = 0` 时，JS 原生算术会得出 `Infinity` / `-Infinity` / `NaN`——这些不是合法的数学商。endpoint 必须在做除法前显式拒绝 `b = 0`，返回 HTTP 400，body 不含 `quotient`。这是 W19/W20 都没有的"算术语义级"拒绝路径。

这一设计让 evaluator 必须能区分"strict-schema 通过 + 算术结果错"和"strict-schema 通过 + 算术结果对"，而不是只盯 HTTP 状态码。是对 harness pipeline 的更深一层考验。

## Golden Path（核心场景）

HTTP 客户端从 [发起 GET /divide?a=6&b=2 请求] → 经过 [playground server 用 strict-schema 校验 a/b、显式拒绝 b=0、否则计算 a÷b] → 到达 [收到 200 响应，body 为 `{ "quotient": 3 }`，且 `quotient === Number(a)/Number(b)` 严格成立]

具体：

1. 客户端发 `GET /divide?a=<标准十进制字符串>&b=<标准十进制字符串>` 到 playground server（默认端口 3000）
2. server 对 a 和 b 各自做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`，与 `/multiply` 同款）
3. strict-schema 通过后，**显式判定 `Number(b) === 0`，是则返回 HTTP 400** + `{ "error": "<非空说明字符串>" }`，body 不含 `quotient` 字段
4. b ≠ 0 → 返回 HTTP 200，JSON body 为 `{ "quotient": Number(a) / Number(b) }`（JS 原生除法结果，含浮点精度 — evaluator 用同一表达式复算比对）
5. 任一参数缺失 / 不通过 strict-schema → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `quotient`

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（与 W20 `/multiply` 完全一致，不重新发明）

| 输入示例 | strict-schema 判定 | 期望响应（结合除零兜底） |
|---|---|---|
| `a=6&b=2` | 双方合法 | 200，`{quotient: 3}` |
| `a=1&b=3` | 双方合法 | 200，`{quotient: 0.3333333333333333}`（JS Number 原生表示） |
| `a=-6&b=2` | 双方合法 | 200，`{quotient: -3}` |
| `a=6&b=-2` | 双方合法 | 200，`{quotient: -3}` |
| `a=0&b=5` | 双方合法（0/5 = 0） | 200，`{quotient: 0}` |
| `a=5&b=0` | strict 通过但 b=0 | **400**（除零兜底，body 不含 quotient） |
| `a=0&b=0` | strict 通过但 b=0 | **400**（除零兜底） |
| `a=1e3&b=2` | a 非法（科学计数法） | 400 |
| `a=Infinity&b=2` | a 非法 | 400 |
| `a=6&b=NaN` | b 非法 | 400 |
| `a=+6&b=2` | a 非法（前导 +） | 400 |
| `a=.5&b=2` | a 非法（缺整数部分） | 400 |
| `a=6.&b=2` | a 非法（缺小数部分） | 400 |
| `a=0xff&b=2` | a 非法（十六进制） | 400 |
| `a=1,000&b=2` | a 非法（千分位） | 400 |
| `a=&b=3` | a 空串 | 400 |
| `a=abc&b=3` | a 非数字 | 400 |
| 缺 a 或缺 b 或全缺 | — | 400 |

## 边界情况

- **b = 0** 是 W21 新增的核心拒绝路径，必须在 strict-schema 通过 **之后** 显式拦截（不能依赖 JS 自动产 Infinity）
- **a = 0 且 b ≠ 0** → 200，`{quotient: 0}`（不能误把 a=0 也拒掉）
- **负数除以负数** → 商为正，按 JS 原生算术返回
- **不能整除**（如 `1/3`、`10/3`） → 200，按 JS Number 浮点表示原样返回，不做四舍五入 / 不强制整数
- **strict 校验顺序**：缺参检查 → strict-schema 检查 → 除零检查 → 算术（错任一阶段都返 400，且 body 不含 `quotient`）
- **`/health`、`/sum`、`/multiply` 现有行为不受影响**（不动这三条路由的代码与单测）
- **大数运算**：按 JS Number 原生处理，不做 BigInt（与 W19/W20 同立场）

## 范围限定

**在范围内**：

- 在 `playground/server.js` 新增 `GET /divide` 路由（含 strict-schema 复用 + 除零兜底）
- 在 `playground/tests/server.test.js` 新增 `/divide` describe 块单测：覆盖
  - happy path（含正/负/小数/0 作被除数）
  - 除零拒绝（b=0、a=0&b=0 各至少 1 条）
  - strict-schema 拒绝（科学计数法、Infinity、前导 +、缺参 各至少 1 条）
  - 至少 1 条 oracle 断言：`expect(res.body.quotient).toBe(Number(a) / Number(b))`，证明返回值与独立复算严格相等
- 在 `playground/README.md` 端点列表加 `/divide`，给出 happy / 除零拒绝 / strict 拒绝 各至少 1 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / decimal.js / bignumber.js / 任何外部库）
- 不改 `/health`、`/sum`、`/multiply` 的实现或单测（一字不动）
- 不引入 BigInt / decimal 精度增强（除法浮点结果就按 JS Number 原生返回）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply` 一致）]
- [ASSUMPTION: strict-schema 用同一个原生 RegExp `^-?\d+(\.\d+)?$`（不重新发明，可与 `/multiply` 共享同一字面量或单独写一份均可，只要语义等价）]
- [ASSUMPTION: 响应 body 字段名为 `quotient`（与 `sum`、`product` 同一命名风格——动作的语义结果名）]
- [ASSUMPTION: 除零判定用 `Number(b) === 0`（覆盖 `0`、`0.0`、`-0` 都算零；strict-schema 已先排除 `0xff` 等假绿）]
- [ASSUMPTION: 浮点结果不做精度截断；evaluator 复算用同表达式 `Number(a)/Number(b)` 比 `toBe` 严格相等]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与 `/sum`、`/multiply` 一致），具体文案由 generator 决定]

## 预期受影响文件

- `playground/server.js`：新增 `GET /divide` 路由 + strict-schema 校验 + 除零兜底
- `playground/tests/server.test.js`：新增 `/divide` describe 块（happy + 除零 + strict 拒绝 + oracle 复算断言）
- `playground/README.md`：端点列表加 `/divide`，补 happy / 除零 / strict 拒绝示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19 /sum、W20 /multiply 同分类）
