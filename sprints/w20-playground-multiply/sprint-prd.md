# Sprint PRD — playground 加 GET /multiply endpoint（thin · strict-schema）

## OKR 对齐

- **对应 KR**：W20 Walking Skeleton — Cecelia harness pipeline 端到端协议层验证（接续 W19）
- **当前进度**：W19 已合并 #2874（bootstrap）+ #2875（`/sum` 第一个真改动），证明 generator → evaluator 链路能针对外部代码对象工作
- **本次推进预期**：在 playground 上加第二个 endpoint `/multiply`，并把"输入校验"从 W19 的宽松 `Number()` 升级为 strict-schema（白名单正则），证明 harness pipeline 能跟得上"合同更严"的迭代

## 背景

W19 `/sum` 用 `Number(x)` + `Number.isFinite()` 做校验，能接受 `Infinity`、`NaN`（被 isFinite 拒）、科学计数法（`1e3` → 1000）、十六进制（`0xff` → 255）、前导 `+` 等"看起来像数字"但不规范的输入。

W20 把 endpoint 从加法换成乘法（`a*b`），同时把校验升级到 strict-schema：**只接受形如 `-?\d+(\.\d+)?` 的标准十进制字面量**。这一收紧是对 harness pipeline 的真正考验——generator 必须读懂"strict"意图、evaluator 必须能识别"宽松通过 / 严格不通过"的微妙差异。

## Golden Path（核心场景）

HTTP 客户端从 [发起 GET /multiply?a=2&b=3 请求] → 经过 [playground server 用 strict-schema 校验 query 参数 a/b 并相乘] → 到达 [收到 200 响应，body 为 `{ "product": 6 }`]

具体：
1. 客户端发 `GET /multiply?a=<标准十进制字符串>&b=<标准十进制字符串>` 到 playground server（默认端口 3000）
2. server 对 a 和 b 各自做 strict-schema 校验（白名单正则：可选前导负号 + 至少一位整数部分 + 可选小数部分；详见"strict-schema 定义"段）
3. 校验通过则把 a 和 b 转为 JS Number 相乘，返回 HTTP 200，JSON body 为 `{ "product": <a*b 的算术结果> }`
4. 任一参数缺失或不通过 strict-schema → 返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `product` 字段

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`

落到具体行为：

| 输入示例 | strict-schema 判定 | 期望响应 |
|---|---|---|
| `2`、`-3`、`0`、`1.5`、`-0.5`、`100.000` | 合法 | 200，参与乘法 |
| `1e3`（科学计数法） | 非法 | 400 |
| `0xff`、`0b10`（其它进制字面量） | 非法 | 400 |
| `Infinity`、`-Infinity`、`NaN` | 非法 | 400 |
| `+2`（前导正号） | 非法 | 400 |
| `.5`、`5.`（小数点缺整数/小数部分） | 非法 | 400 |
| `1,000`（含千分位） | 非法 | 400 |
| `2 `（含空格）、空字符串 `""` | 非法 | 400 |
| `abc`、`null`、`undefined` 等非数字 | 非法 | 400 |

## 边界情况

- **a 或 b 缺失**（query 中无该字段）→ 400
- **零参与乘法**（`a=0&b=5`）→ 200，`{ "product": 0 }`
- **负数参与乘法**（`a=-2&b=3`）→ 200，`{ "product": -6 }`
- **小数参与乘法**（`a=1.5&b=2`）→ 200，`{ "product": 3 }`
- **乘积超出 JS Number 安全范围**：按 JS 原生算术结果返回，不做 BigInt 处理（与 W19 `/sum` 同立场）
- **现有 `GET /health`、`GET /sum` 行为不受影响**（不动这两条路由的代码与单测）

## 范围限定

**在范围内**：

- 在 `playground/server.js` 新增 `GET /multiply` 路由，含 strict-schema 校验
- 在 `playground/tests/server.test.js` 新增 `/multiply` 单测：覆盖至少 1 条 happy path + 多条 strict-schema 拒绝路径（建议覆盖科学计数法、Infinity、前导 `+`、`.5`、缺参 各至少 1 条）
- 在 `playground/README.md` 把 `/multiply` 加进端点列表，给出 happy + 严格拒绝示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / 任何 schema 校验库；strict-schema 用原生正则实现）
- 不改 `/health`、`/sum` 的实现或单测
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不把 `/sum` 也改成 strict-schema（只动新加的 `/multiply`，避免"打 W19 旧账"）
- 不写跨子项目的集成测试

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应用 HTTP 400 + `{ error: "<字符串>" }`（与 `/sum` 相同形态，保证 playground 内部错误协议一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp 实现（`^-?\d+(\.\d+)?$`），不引入 zod/joi/ajv]
- [ASSUMPTION: 验收时 evaluator 通过 `npm test` 在 playground 子目录下跑单测；如需端到端真起 server，evaluator 自行 spawn `npm start` 并 curl，无需 PRD 规定]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与 `/sum` 一致），具体文案由 generator 决定]

## 预期受影响文件

- `playground/server.js`：新增 `GET /multiply` 路由 + strict-schema 校验逻辑
- `playground/tests/server.test.js`：新增 `/multiply` 单测套件（happy path + strict-schema 拒绝路径 + 边界）
- `playground/README.md`：端点列表加 `/multiply`，补 happy + 严格拒绝示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次改动只涉及 server 路由 + 单测 + README，无 UI、无 brain tick、无 engine hook、无远端 agent 协议；按规则归类为 autonomous（与 W19 `/sum` 同分类）
