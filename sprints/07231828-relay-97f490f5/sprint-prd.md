# Sprint PRD — playground 加 GET /sign endpoint

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：headless-c3-verify pipeline 端到端验收通过

## 背景

playground 是 headless relay pipeline 的训练沙箱，已有 12 个端点（/sum /multiply /divide /power /modulo /subtract /increment /decrement /factorial /abs /echo + /negate in PR #4228）。本 sprint 新增第 13 个端点 GET /sign，实现数学符号函数（signum），用于 pipeline 端到端验收演练。

## Golden Path（核心场景）

系统从 [GET /sign?value=<整数>] → 经过 [参数校验 + 符号判断] → 到达 [返回 HTTP 200 JSON {result, operation}]

具体：
1. 客户端发送 `GET /sign?value=5`（或任意匹配 `^-?\d+$` 的整数字符串）
2. 系统校验 value 存在且格式合法；判断符号
3. 返回 HTTP 200：`{"result": 1, "operation": "sign"}`
   - value > 0 → result: 1
   - value = 0 → result: 0
   - value < 0 → result: -1
   - operation 字面值必须是 "sign"

## Response Schema

```
GET /sign?value=<整数>
→ 200 OK
{
  "result": -1 | 0 | 1,   // 符号值
  "operation": "sign"      // 字面值固定
}
```

## 边界情况

- value 缺失 → HTTP 400 `{error: "<非空字符串>"}`
- value 不匹配 `^-?\d+$`（含小数、前导 +、科学计数法、空串、Infinity、NaN 等）→ HTTP 400
- value = 0 → HTTP 200 `{result: 0, operation: "sign"}`（零的符号为 0）
- value = -0 → HTTP 400（"-0" 字符串不匹配 `^-?\d+$` 中要求的非空数字部分）
- value = 9007199254740993（超 Number.MAX_SAFE_INTEGER+1）→ HTTP 400 `{error: "<非空字符串>"}`（上界 9007199254740991 即 Number.MAX_SAFE_INTEGER）

## 范围限定

**在范围内**：
- `playground/server.js` 新增 GET /sign 路由
- `playground/tests/server.test.js` 新增 describe('GET /sign') 测试块

**不在范围内**：
- 其他端点改动
- Brain API 路由
- dashboard
- 任何 /sign 以外的功能

## 假设

- [ASSUMPTION: playground 测试框架为 vitest，新增 describe 块沿用现有风格]
- [ASSUMPTION: 本端点仅接受单参 value，不接受多余 query 参数]
- [ASSUMPTION: value 合法范围与 /increment /decrement 相同：`^-?\d+$` 且 |Number(value)| ≤ 9007199254740991]

## 预期受影响文件

- `playground/server.js`：新增 GET /sign 路由（第 13 个端点）
- `playground/tests/server.test.js`：新增 describe('GET /sign') 测试块

## NFR 约束

- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无
- 版本要求: 无
- 可观测: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

（本 line 暂无历史 invariant）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史——参考 /negate PR #4228 行为需回归验证）

## E2E 验收

> 最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=playground，bash 脚本）。

```bash
# 占位：proposer 将按 target_environment=playground 填入真实脚本
# 期望验收点（自然语言）：
# 1. 启动 playground（playground/server.js，PLAYGROUND_PORT=3001）
# 2. GET /sign?value=5 → HTTP 200 + {result: 1, operation: "sign"}
# 3. GET /sign?value=-3 → HTTP 200 + {result: -1, operation: "sign"}
# 4. GET /sign?value=0 → HTTP 200 + {result: 0, operation: "sign"}
# 5. GET /sign?value=9007199254740991 → HTTP 200 + {result: 1, operation: "sign"}
# 6. GET /sign?value=9007199254740992 → HTTP 400
# 7. GET /sign（缺 value）→ HTTP 400
# 8. GET /sign?value=3.14 → HTTP 400
# 9. GET /sign?value=abc → HTTP 400
# 10. 停止 playground
```

## journey_type: autonomous
## journey_type_reason: playground 端点是自主验证训练沙箱，无需浏览器渲染
## target_environment: playground
## target_environment_reason: vitest 单元测试 + bash 集成测试，playground 端口
## journey_id: （前台手跑，无 journey_id）
## step_id: （PrepPRD 未提供）
