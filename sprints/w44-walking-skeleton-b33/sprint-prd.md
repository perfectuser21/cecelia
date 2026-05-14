# Sprint PRD — playground 加 GET /negate（W44 B33 位置词死规则后真验）

## OKR 对齐

- **对应 KR**：Walking Skeleton P1 — B33（#2949）位置词死规则后端到端真验
- **本次推进预期**：final_evaluate PASS 即视作 B33 位置词死规则真生效

## 背景

B33 在 harness-planner SKILL.md v8.4.0 加入位置词死规则：thin_prd 含 "playground" → 实现必须在 `playground/server.js`，禁止漂移到 `packages/brain/src/`。本 PRD 即 B33 真验实证，thin_prd 含 "playground" 字面。

## Golden Path

客户端 → `GET /negate?value=N` → playground strict-schema 整数校验 → 200 `{result:-N, operation:"negate"}`；违规 → 400 `{error:"..."}`

具体：
1. 客户端发 `GET /negate?value=<整数字符串>`
2. 校验 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740990`
3. 返 200 + `{result: -Number(value), operation: "negate"}`
4. 任一违规 → 400 + `{error:"<非空字符串>"}`

## Response Schema

### Endpoint: GET /negate

**Query Parameters**：
- `value`（integer-as-string，必填）：匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740990`
- 禁用 query 名：`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`

**Success (HTTP 200)**：
```json
{"result": <number>, "operation": "negate"}
```
- 顶层 keys 完全等于 `["operation","result"]`
- `operation` 字面字符串 `"negate"`，禁用变体 `neg`/`negated`/`negative`/`invert`/`opposite`/`minus`
- 禁用响应字段名：`negated`/`negative`/`inverted`/`opposite`/`sum`/`product`/`value`/`input`/`output`/`data`/`payload`/`answer`

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys 完全等于 `["error"]`；body 不含 `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail`

## 范围限定

**在范围内**：`playground/server.js` 加 `GET /negate` 路由；`playground/tests/server.test.js` 加 `describe('GET /negate')`；`playground/README.md` 加 `/negate` 段
**不在范围内**：不动其他路由 / 零依赖 / 不改 brain/engine/dashboard/apps

## 假设

- [ASSUMPTION: Brain API 不可用，thin_prd 从任务模式推断为 "playground 加 GET /negate"]

## 预期受影响文件

- `playground/server.js`: 加 GET /negate 路由
- `playground/tests/server.test.js`: 加 /negate 测试描述块
- `playground/README.md`: 加 /negate 文档段

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目，无 UI/brain/engine/远端 agent
