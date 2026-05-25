# Sprint PRD — playground 加 GET /subtract endpoint（B1）

## OKR 对齐

- **对应 KR**：Cecelia harness pipeline 端到端验证（接续 W26 /increment）
- **本次推进预期**：Bug 10（proposer 假绿）+ Bug 11（reviewer 结果文件）修复后管道验证

## 背景

B1 是 Bug 10 (#3110) + Bug 11 (#3111) 修复后第一个验证 sprint，用最简双参减法端点跑通完整管道，确认两个 bug 均真生效。

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /subtract?a=10&b=3`] → 经过 [playground server strict-schema 校验 + 计算] → 到达 [200 响应 `{"result":7,"operation":"subtract"}`]

具体：
1. 发送 `GET /subtract?a=10&b=3`
2. server 校验 a、b 存在且匹配 `^-?\d+(\.\d+)?$`
3. 返回 HTTP 200：`{"result":7,"operation":"subtract"}`

## Response Schema

### Endpoint: GET /subtract

**Query Parameters**: `a`（被减数，必填）、`b`（减数，必填），匹配 `^-?\d+(\.\d+)?$`；禁用 `x/y/p/q/n/m/v1/v2`

**Success (HTTP 200)**:
```json
{"result": 7, "operation": "subtract"}
```
- `result` (number): `Number(a) - Number(b)`
- `operation` (string): 字面量 `subtract`；禁用 `difference`/`diff`/`sub`/`minus`
- **禁用响应字段**: `difference`/`diff`/`value`/`answer`/`data`
- **Schema 完整性**: 顶层 keys 完全等于 `["operation","result"]`

**Error (HTTP 400)**: `{"error":"<string>"}` — 缺参或非法格式

## 边界情况

- 缺参 → 400；非法格式（`1e5`/`Inf`/`+1`/`0xFF`）→ 400；结果负数（a=3,b=10 → -7）正常返回

## 范围限定

**在范围内**：`playground/server.js` 新增 GET /subtract（strict-schema 双参减法）
**不在范围内**：其他端点修改、overflow/浮点精度

## 假设

- [ASSUMPTION: playground/server.js 已有 `STRICT_NUMBER` regex 可复用]

## 预期受影响文件

- `playground/server.js`: 新增 GET /subtract 路由

## journey_type: autonomous
## journey_type_reason: 仅涉及 playground/server.js，无 UI / 无外部 agent 协议
## target_environment: playground
## target_environment_reason: evaluator 在本地 localhost:3000（或 $PLAYGROUND_PORT）验证
