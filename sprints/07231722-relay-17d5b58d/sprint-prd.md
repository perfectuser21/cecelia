# Sprint PRD — playground 加 GET /negate endpoint

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：headless-contract-test pipeline 端到端验收通过

## 背景

playground 是 headless-contract-test pipeline 的训练沙箱，已有 11 个端点（/sum /multiply /divide /power /modulo /subtract /increment /decrement /factorial /abs /echo）。本 sprint 新增第 12 个端点 GET /negate，用于 pipeline 端到端验收演练。

## Golden Path（核心场景）

系统从 [GET /negate?value=<整数>] → 经过 [参数校验 + 取反运算] → 到达 [返回 HTTP 200 JSON {result, operation}]

具体：
1. 客户端发送 GET /negate?value=5（或任意匹配 ^-?\d+$ 的整数字符串，|Number(value)| ≤ 9007199254740990）
2. 系统校验 value 存在且格式合法；计算 -Number(value)
3. 返回 HTTP 200：`{"result": -5, "operation": "negate"}`；其中 operation 字面值必须是 "negate"（禁 negation/neg/negative），result 键名必须是 "result"（禁 negated/value/output）

## 边界情况

- value 缺失 → HTTP 400 `{error: "<非空字符串>"}`
- value 不匹配 ^-?\d+$（含小数、前导 +、科学计数法、空串、Infinity、NaN 等）→ HTTP 400
- |Number(value)| > 9007199254740990 → HTTP 400
- value=0 → HTTP 200 `{result: 0, operation: "negate"}`（-0 规范化为 0）
- value=-5 → HTTP 200 `{result: 5, operation: "negate"}`（负数取反为正数）

## 范围限定

**在范围内**：playground/server.js 新增 GET /negate 路由；playground/tests/server.test.js 新增 describe('GET /negate') 测试块
**不在范围内**：其他端点改动；Brain API 路由；dashboard；任何 /negate 以外的功能

## 假设

- [ASSUMPTION: playground 已有测试框架（vitest/jest），新增 describe 块沿用现有风格]
- [ASSUMPTION: 本端点仅接受单参 value，不接受多余 query 参数（参考 /increment /decrement 严格单参设计）]

## 预期受影响文件

- `playground/server.js`：新增 GET /negate 路由（第 12 个端点）
- `playground/tests/server.test.js`：新增 describe('GET /negate') 测试块

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无
- 版本要求: 无
- 可观测: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
（本 line 暂无历史 invariant）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块为占位。最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=playground，bash 脚本，playground 端口）。

```bash
# 占位：proposer 将按 target_environment=playground 填入真实脚本
# 期望验收点（自然语言）：
# 1. 启动 playground（playground/server.js，PLAYGROUND_PORT=3001）
# 2. GET /negate?value=5 → HTTP 200 + {result: -5, operation: "negate"}
# 3. GET /negate?value=-5 → HTTP 200 + {result: 5, operation: "negate"}
# 4. GET /negate?value=0 → HTTP 200 + {result: 0, operation: "negate"}
# 5. GET /negate?value=9007199254740990 → HTTP 200 + {result: -9007199254740990, operation: "negate"}
# 6. GET /negate?value=9007199254740991 → HTTP 400 + {error: "<非空字符串>"}
# 7. GET /negate（缺 value）→ HTTP 400
# 8. GET /negate?value=3.14 → HTTP 400
# 9. GET /negate?value=abc → HTTP 400
# 10. 停止 playground
```

## journey_type: autonomous
## journey_type_reason: 纯后端端点实现，无 UI 交互，无远端 agent 协议，无 dashboard
## target_environment: playground
## target_environment_reason: thin_prd 含 "playground" 且为本地训练 sprint，走本地 node playground/server.js
## journey_id: playground-negate
## step_id: none（PrepPRD 未锚定）
