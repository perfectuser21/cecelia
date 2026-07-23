# Sprint PRD — playground GET /square 端点实现

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：+1%（harness pipeline 验证训练沙箱覆盖度）

## 背景

headless-contract-eval 管道验证运行，使用 playground 作为训练沙箱。playground 现有 12 个数学端点，本 sprint 新增 GET /square（x²）。兄弟任务 PR #4228 正在实现 GET /negate，本 sprint 选 /square 避免冲突。

## Golden Path（核心场景）

用户从 `GET /square?n=<数字>` → playground 计算 n² → 返回 `{ square: <number> }`

具体：
1. 客户端发送 `GET /square?n=5`（n 为合法数字，匹配 `^-?\d+(\.\d+)?$`）
2. playground/server.js 计算 `Number(n) ** 2`，结果必须为有限数
3. 响应返回 HTTP 200 + JSON `{ square: 25 }`

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 缺失参数 n → HTTP 400 `{ error: 'n 是必填 query 参数' }`
- 非法格式（科学计数法、Infinity、前导+、十六进制等）→ HTTP 400
- 结果溢出（如 n=1e308）→ HTTP 400（结果非有限数，拒绝返回）

## 范围限定

**在范围内**：playground/server.js 新增 GET /square 端点；playground/tests 新增对应测试
**不在范围内**：Brain API 路由变更；/negate 端点（兄弟任务 PR #4228）；dashboard UI 变更

## 假设

- [ASSUMPTION: n 参数使用与 /abs 相同的 STRICT_NUMBER 正则 `^-?\d+(\.\d+)?$`]
- [ASSUMPTION: 成功响应字段名为 `square`，类型 number]
- [ASSUMPTION: 负数输入合法（-3² = 9），结果始终 ≥ 0]

## 预期受影响文件

- `playground/server.js`: 新增 GET /square 路由
- `playground/tests/`: 新增 /square 端点测试用例

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无（playground 训练沙箱，无频控要求）
- 版本要求: Node.js ESM（与现有 server.js 保持一致）
- 可观测: playground E2E 脚本必须验证端点响应字段值

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [位置词死规则] playground 端点必须实现在 `playground/server.js`，禁止放 `packages/brain/src/`（来源: harness-planner skill）
- [e2e URL 死规则] playground E2E 脚本必须用 `localhost:3000`（或 `$PLAYGROUND_PORT`），不得调用 Brain 调度端口（来源: harness-planner skill）
- [参数验证] 所有数学端点入参必须严格校验格式，非法输入返回 HTTP 400（来源: area，playground 历史约束）
- [有限数保护] 计算结果非有限数（NaN/Infinity/-Infinity）必须返回 HTTP 400 拒绝（来源: area，/power 端点先例）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: playground 已实现端点历史 -->
- /health: GET /health → { ok: true }
- /sum: GET /sum?a=&b= → { sum: number }（缺参/非法 → 400）
- /multiply: GET /multiply?a=&b= → { product: number }（STRICT_NUMBER 验证）
- /divide: GET /divide?a=&b= → { quotient: number }（b=0 → 400）
- /power: GET /power?a=&b= → { power: number }（0^0 → 400；溢出 → 400）
- /modulo: GET /modulo?a=&b= → { remainder: number }（b=0 → 400）
- /subtract: GET /subtract?a=&b= → { result: number, operation: "subtract" }
- /increment: GET /increment?value= → { result: number, operation: "increment" }（仅整数）
- /decrement: GET /decrement?value= → { result: number, operation: "decrement" }（仅整数）
- /factorial: GET /factorial?n= → { factorial: number }（0≤n≤18）
- /abs: GET /abs?n= → { result: number, operation: "abs" }
- /echo: GET /echo?msg= → { msg: string }

## E2E 验收

> 最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出（按 target_environment=playground 模板）。

```bash
# 占位：proposer 将按 target_environment=playground 填入真实脚本
# 期望验收点（自然语言）：
# 1. 启动 playground server（PLAYGROUND_PORT=3001）
# 2. GET /square?n=5 → HTTP 200，响应 { square: 25 }
# 3. GET /square?n=-3 → HTTP 200，响应 { square: 9 }
# 4. GET /square?n=0 → HTTP 200，响应 { square: 0 }
# 5. GET /square（缺 n）→ HTTP 400
# 6. GET /square?n=abc → HTTP 400
# 7. 停止 playground server
```

## journey_type: autonomous
## journey_type_reason: 纯后端 playground server.js 端点实现，无 UI/agent 协议/engine 介入
## target_environment: playground
## target_environment_reason: playground 训练沙箱，本地 node playground/server.js 运行验证
## journey_id: none
## step_id: none
