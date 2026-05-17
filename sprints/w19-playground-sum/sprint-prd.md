# Sprint PRD — playground 加 GET /sum endpoint

## OKR 对齐

- **对应 KR**：W19 Walking Skeleton — Cecelia harness pipeline 端到端协议层验证
- **当前进度**：bootstrap 已完成（playground 子项目 + `/health` + 单测骨架已合并 #2874）
- **本次推进预期**：在 playground 上加第一个"被 harness pipeline 增改"的真实 endpoint，证明 generator → evaluator 链路能针对外部代码对象工作

## 背景

W19 Walking Skeleton 用 playground 作为 harness pipeline 的"外部代码改动对象"——刻意与 brain/engine/dashboard 解耦，避免亲爹打亲爹环路。bootstrap PR (#2874) 已落地 `GET /health`，README 已预告下一步是 `GET /sum?a=N&b=M`。本 Sprint 即兑现这一步：让 generator container push PR 加 endpoint，evaluator container 自起 server 真验证 HTTP 行为，闭合最薄的 walking skeleton 第一环。

## Golden Path（核心场景）

HTTP 客户端从 [发起 GET /sum?a=2&b=3 请求] → 经过 [playground server 解析 query 参数 a/b 并求和] → 到达 [收到 200 响应，body 为 `{ "sum": 5 }`]

具体：
1. 客户端发 `GET /sum?a=<数字>&b=<数字>` 到 playground server（默认端口 3000）
2. server 读取 query 中的 a 和 b，转为数字相加
3. 客户端收到 HTTP 200，JSON body 包含字段 `sum`，值为 a + b 的算术结果

## 边界情况

- **a 或 b 缺失**：返回 HTTP 400，body 含错误说明字段（例如 `{ "error": "..." }`），不返回 200/sum:NaN
- **a 或 b 不是合法数字**（例：`a=abc`）：返回 HTTP 400，body 含错误说明
- **负数和零**：视为合法数字正常求和（`a=-1&b=1` → `{ "sum": 0 }`）
- **小数**：视为合法数字正常求和（`a=1.5&b=2.5` → `{ "sum": 4 }`）
- **超大数**：在 JS Number 安全范围内的请求按算术结果返回，不做 BigInt 处理
- **现有 `GET /health` 行为不受影响**

## 范围限定

**在范围内**：
- 在 `playground/server.js` 新增 `GET /sum` 路由
- 在 `playground/tests/server.test.js` 新增 `/sum` 的单测（happy path + 至少一个 error case）
- 保持 playground 的零依赖原则（除已有的 express/vitest/supertest 不引入新依赖）

**不在范围内**：
- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / 类型校验库等）
- 不做 rate-limit、auth、CORS 等非功能特性
- 不动 `GET /health`
- 不写跨子项目的集成测试

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应用 HTTP 400 + JSON body（最简方案，无 problem+json 等扩展）]
- [ASSUMPTION: 验收时 evaluator 通过 `npm test` 在 playground 子目录下跑单测；如需起真实 server 端到端，evaluator 自行 spawn `npm start` 并 curl，无需 PRD 规定]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body]

## 预期受影响文件

- `playground/server.js`：新增 `GET /sum` 路由处理
- `playground/tests/server.test.js`：新增 `/sum` 单测用例
- `playground/README.md`：更新"端点"段，把 `/sum` 从"不在 bootstrap 范围"改为已实现并给出示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次改动只涉及 server 路由 + 单测，无 UI、无 brain tick、无 engine hook、无远端 agent 协议，按规则归类为 autonomous（无路径线索的默认值）
