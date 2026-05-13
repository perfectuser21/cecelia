# Sprint PRD — playground 加 GET /negate（B17 final_evaluate PR_BRANCH 修后 final happy 真验）

## OKR 对齐
- KR：W39 Walking Skeleton — B17（#2933）final_evaluate env 透传 PR_BRANCH 真验；final_evaluate 在 PR 分支跑通 = B17 真生效

## 背景
B17 fix：brain 阶段 D（`final_evaluate`）spawn evaluator skill 时未透传 `PR_BRANCH` env，导致 final_evaluate 在 base 分支 checkout 误判 PR 不存在或路径不通。#2933 已把 `PR_BRANCH` 加进 final_evaluate spawn env。本 PRD 走和 W37 同形 thin-slice，目标是让 final_evaluate 在 W39 PR 分支真起 server 真 curl 真 jq 校验，PASS 即视作 B17 真生效。

## Golden Path
客户端 → `GET /negate?value=N` → playground strict-schema 整数 + 精度上下界校验 → 200 `{result:-N, operation:"negate"}`；违规 → 400 `{error:"..."}`

具体：
1. 客户端发 `GET /negate?value=<整数字符串>`
2. 服务端校验 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740991`（即落在 `[-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER]`）
3. 返 200 + `{result: -Number(value), operation: "negate"}`
4. 任一违规（缺 value / 非整数 / 超界 / 禁用 query 名） → 400 + `{error:"<非空字符串>"}`

## Response Schema

### Endpoint: GET /negate

**Query Parameters**：
- `value`（integer-as-string，必填）：匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740991`
- **禁用 query 名**: `n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`（generator 必须**字面用** `value`；用任一禁用名访问 endpoint 应返 400）
- **强约束**: query 名漂移由 evaluator jq -e + curl 真验抓住

**Success (HTTP 200)**：
```json
{"result": <number>, "operation": "negate"}
```
- 顶层 keys **完全等于** `["operation","result"]`，不允许多余字段
- `result` (number, 必填): 即 `-Number(value)`（字段值字面，包括 `value=0` 返 `result:0`，`value=-5` 返 `result:5`）
- `operation` (string, 必填): 字面字符串 `"negate"`
- **禁用 operation 变体**: `neg`/`negation`/`negated`/`minus`/`opposite`/`flip`/`invert`/`inverse`/`unary_minus`（一律不等）
- **禁用响应字段名**: `negation`/`negated`/`minus`/`opposite`/`flip`/`invert`/`inverse`/`incremented`/`decremented`/`prev`/`predecessor`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`（反向不出现）

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys **完全等于** `["error"]`；body 不含 `result` 也不含 `operation`
- **禁用替代错误名**: `message`/`msg`/`reason`/`detail`（反向不出现）

## 边界情况
- `value=0` → 200 + `{result:0, operation:"negate"}`（不能漂成 `-0` 或 `0.0`；JS `-0 === 0` 但 JSON 序列化必须出 `0`）
- `value=9007199254740991`（MAX_SAFE_INTEGER）→ 200 + `{result:-9007199254740991}`
- `value=-9007199254740991`（-MAX_SAFE_INTEGER）→ 200 + `{result:9007199254740991}`
- `value=9007199254740992` / `value=-9007199254740992` → 400（超 MAX_SAFE_INTEGER）
- `value=1.5` / `value=1e2` / `value=+5` / `value=0x10` / `value=abc` / `value=` / 缺 `value` → 400
- 用禁用 query 名（如 `?n=5`）→ 400

## 范围限定
**在范围内**：`playground/server.js` 加 `GET /negate` 路由；`playground/tests/server.test.js` 加 `describe('GET /negate')` 独立块；`playground/README.md` 加 `/negate` 段
**不在范围内**：不动其他路由 / 零依赖 / 不改 brain/engine/dashboard/apps

## 假设
- [ASSUMPTION: B17 fix 已合并到 main（#2933），final_evaluate spawn 在 PR 分支跑 evaluator skill 时 `PR_BRANCH` env 已就位]
- [ASSUMPTION: W39 PR 合并到 main 后，brain 走 D 阶段 final_evaluate 触发 evaluator skill，evaluator skill Step 0a 走 git checkout `$PR_BRANCH` 并在 PR 分支跑 contract 验证命令]

## 预期受影响文件
- `playground/server.js`: 新增 `app.get('/negate', ...)` 路由
- `playground/tests/server.test.js`: 新增 `describe('GET /negate', ...)` 独立块
- `playground/README.md`: 端点列表加 `/negate` 段

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目；无 UI、无 brain tick、无 engine hook、无远端 agent
