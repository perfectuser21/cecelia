# Sprint PRD — playground 加 GET /decrement（B14 4 fix 后 final happy 真验）

## OKR 对齐
- KR：W37 Walking Skeleton — B14（#2929）4 fix 真验；final_evaluate PASS 即视作 B14 真生效

## 背景
B14 4 fix：(1) brain evaluator spawn 透传 PR_BRANCH env；(2) evaluator skill Step 0a git checkout PR 分支；(3) proposer 单 ws ≤ 200 行净增 + ≤ 3 文件；(4) planner thin slice PRD ≤ 50 行 + DoD ≤ 8 条。本 PRD 本身即 fix #4 实证。

## Golden Path
客户端 → `GET /decrement?value=N` → playground strict-schema 整数 + 精度上下界校验 → 200 `{result:N-1, operation:"decrement"}`；违规 → 400 `{error:"..."}`

具体：
1. 客户端发 `GET /decrement?value=<整数字符串>`
2. 校验 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740990`
3. 返 200 + `{result: Number(value)-1, operation: "decrement"}`
4. 任一违规 → 400 + `{error:"<非空字符串>"}`

## Response Schema

### Endpoint: GET /decrement

**Query Parameters**：
- `value`（integer-as-string，必填）：匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740990`
- 禁用 query 名：`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`

**Success (HTTP 200)**：
```json
{"result": <number>, "operation": "decrement"}
```
- 顶层 keys 完全等于 `["operation","result"]`
- `operation` 字面字符串 `"decrement"`，禁用变体 `dec`/`decr`/`decremented`/`prev`/`previous`/`predecessor`/`minus_one`/`sub_one`
- 禁用响应字段名：`decremented`/`prev`/`predecessor`/`minus_one`/`incremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys 完全等于 `["error"]`；body 不含 `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail`

## 范围限定
**在范围内**：`playground/server.js` 加 `GET /decrement` 路由；`playground/tests/server.test.js` 加 `describe('GET /decrement')`；`playground/README.md` 加 `/decrement` 段
**不在范围内**：不动其他路由 / 零依赖 / 不改 brain/engine/dashboard/apps

## 预期受影响文件
- `playground/server.js`
- `playground/tests/server.test.js`
- `playground/README.md`

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目，无 UI/brain/engine/远端 agent
