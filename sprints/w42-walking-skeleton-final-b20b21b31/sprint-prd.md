# Sprint PRD — playground 加 GET /negate（B20+B21+B31 真验）

## OKR 对齐

- **对应 KR**：Walking Skeleton — Cecelia Autonomous Journey 端到端全自动跑通
- **当前进度**：B19/B20/B21/B31 已合并；本轮为三修复后首次 P1 全程验证
- **本次推进预期**：验证 autonomous journey thin_prd → merge → completed 完整闭环

## 背景

B20（planner 不偏题）、B21（auto-merge）、B31（cookie/session 隔离）三个修复已于 #2940/#2941/#2942 合并。本 sprint 以 playground 新增 `GET /negate` 端点为载体，驱动一次完整 autonomous journey，验证三修复在集成环境下协同生效。

PRD 本身即 B20 实证：全文 ≤ 50 行正文，DoD ≤ 8 条，无实现细节。

## Golden Path（核心场景）

系统从 [Brain 接收 thin_prd] → 经过 [harness 流水线：生成 → CI → 评估 → 合并] → 到达 [task.status=completed + PR merged to main]

具体：
1. Brain 收到本 PRD，调度一次 `harness_initiative` 任务
2. Generator 在 `playground/server.js` 新增 `GET /negate` 路由，`playground/tests/server.test.js` 新增对应测试
3. CI 运行通过（npm test）
4. Evaluator 用独立 cookie/session（B31）真 curl 验证 endpoint schema 合规
5. Evaluator 返回 PASS，Brain 触发 `gh pr merge --auto`（B21）
6. PR 合并 main，Brain 回写 task.status=completed

## Response Schema

### Endpoint: GET /negate

**Query Parameters**（v8.2 强约束）：
- `value`（integer-as-string，必填）：匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740990`
- **禁用 query 名**：`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`/`p`/`q`

**Success (HTTP 200)**：
```json
{"result": <number>, "operation": "negate"}
```
- 顶层 keys 完全等于 `["operation", "result"]`，不允许多余字段
- `result` (number, 必填)：等于 `Number(value)` 的算术取反；`value=0` 时 `result=0`（不得返回 `-0`）
- `operation` (string, 必填)：字面量 `"negate"`，禁用变体 `neg`/`negation`/`negative`/`opposite`/`invert`/`flip`/`minus`

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys 完全等于 `["error"]`
- 禁用替代名 `message`/`msg`/`reason`/`detail`/`description`

**禁用响应字段名**：`negated`/`negative`/`value`/`answer`/`data`/`payload`/`output`/`result_value`/`sum`/`product`

## 边界情况

- `value` 缺失或为空字符串 → 400
- `value` 含小数点（`1.5`）或非数字字符 → 400
- `|Number(value)| > 9007199254740990` → 400
- `value=0` → `result=0`（正零，非 `-0`）
- 其余路径（非 GET /negate）不受影响

## 范围限定

**在范围内**：
- `playground/server.js`：新增 `GET /negate` 路由
- `playground/tests/server.test.js`：新增 `describe('GET /negate')` 测试块
- `playground/README.md`：补充 `/negate` 端点说明

**不在范围内**：
- 不动其他路由（不改 /decrement /increment /power 等）
- 不动 brain/engine/dashboard/apps 任何代码
- 不引入新依赖包

## 假设

- [ASSUMPTION: playground 已有 server.js + tests/server.test.js，格式与 /decrement 端点一致]
- [ASSUMPTION: CI 使用 `npm test` 命令，已在 playground/ 配置]
- [ASSUMPTION: B21 auto-merge 需要 CI 绿才触发，不强制 squash]

## 预期受影响文件

- `playground/server.js`：新增 /negate 路由（≤ 15 行净增）
- `playground/tests/server.test.js`：新增 /negate 测试（≤ 20 行净增）
- `playground/README.md`：新增 /negate 说明段

## journey_type: autonomous
## journey_type_reason: playground 代码由 brain autonomous journey 全自动生成，无 UI/engine/远端 agent 参与
