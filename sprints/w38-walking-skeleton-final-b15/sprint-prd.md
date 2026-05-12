# Sprint PRD — playground 加 GET /abs（B15 verdict regex 修后 final happy 真验）

## OKR 对齐
- KR：W38 Walking Skeleton — B15（#2931）evaluator verdict regex → extractField 修后真验；final_evaluate PASS 即视作 B15 真生效

## 背景
B15 把 evaluator verdict 解析从 regex 改成 extractField，目的让 evaluator 的"VERDICT: PASS|FAIL"段被 brain 端稳健抽取。本 W38 走一条最薄路由实例（同 W37 /decrement 模板），E2E 跑完一遍 planner → proposer → generator → evaluator → final_evaluate；若 final verdict 能被正确读出且 PASS，即视作 B15 修复真生效。

## Golden Path
客户端 → `GET /abs?value=N` → playground strict-schema 整数 + 精度上下界校验 → 200 `{result: |N|, operation:"abs"}`；违规 → 400 `{error:"..."}`

具体：
1. 客户端发 `GET /abs?value=<整数字符串>`
2. 校验 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740990`
3. 返 200 + `{result: Math.abs(Number(value)), operation: "abs"}`
4. 任一违规 → 400 + `{error:"<非空字符串>"}`

## Response Schema

### Endpoint: GET /abs

**Query Parameters**：
- `value`（integer-as-string，必填）：匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740990`
- 禁用 query 名：`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`

**Success (HTTP 200)**：
```json
{"result": <number>, "operation": "abs"}
```
- 顶层 keys 完全等于 `["operation","result"]`
- `operation` 字面字符串 `"abs"`，禁用变体 `absolute`/`absoluteValue`/`abs_value`/`magnitude`/`modulus`/`positive`/`absval`/`abs_val`
- 禁用响应字段名：`absolute`/`absoluteValue`/`abs_value`/`magnitude`/`modulus`/`positive`/`absval`/`abs_val`/`decremented`/`incremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys 完全等于 `["error"]`；body 不含 `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail`

## 范围限定
**在范围内**：`playground/server.js` 加 `GET /abs` 路由；`playground/tests/server.test.js` 加 `describe('GET /abs')`；`playground/README.md` 加 `/abs` 段
**不在范围内**：不动其他路由 / 零依赖 / 不改 brain/engine/dashboard/apps

## 预期受影响文件
- `playground/server.js`
- `playground/tests/server.test.js`
- `playground/README.md`

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目，无 UI/brain/engine/远端 agent
