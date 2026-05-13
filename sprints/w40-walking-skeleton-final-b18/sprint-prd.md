# Sprint PRD — playground 加 GET /negate（B18 self-verify + container retry + uncap 后 final happy 真验）

## OKR 对齐
- KR：W40 Walking Skeleton — B18（#2935）generator self-verify + container retry + uncap 真验；final_evaluate PASS 即视作 B18 真生效

## 背景
B18 3 fix：(1) generator commit 前 self-verify（红线：测试无对应实现立即失败）；(2) container 启动失败按指数退避重试 N 次；(3) 解除单 ws 净增行数 hard cap（改为合同 SLO 软约束）。本 PRD 是 B18 之后第一个 final happy thin slice，验"generator 不再漂移 + 容器不再首发 503 + 合同实现不再被人为截断"三件事同时成立。

## Golden Path
客户端 → `GET /negate?value=N` → playground strict-schema 整数 + 精度上下界校验 → 200 `{result:-N, operation:"negate"}`；违规 → 400 `{error:"..."}`

具体：
1. 客户端发 `GET /negate?value=<整数字符串>`
2. 校验 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740990`
3. 返 200 + `{result: -Number(value), operation: "negate"}`（注意：`-0` 必须规范化为 `0`）
4. 任一违规 → 400 + `{error:"<非空字符串>"}`

## Response Schema

### Endpoint: GET /negate

**Query Parameters**：
- `value`（integer-as-string，必填）：匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740990`
- 禁用 query 名：`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`/`neg`/`target`

**Success (HTTP 200)**：
```json
{"result": <number>, "operation": "negate"}
```
- 顶层 keys 完全等于 `["operation","result"]`
- `operation` 字面字符串 `"negate"`，禁用变体 `negation`/`neg`/`negative`/`opposite`/`invert`/`flip`/`minus`/`unary_minus`
- `result` 为 `-Number(value)`；当 `value === "0"` 或 `value === "-0"` 时 `result` 必须是 `0`（不能是 `-0`，禁止 `Object.is(result, -0) === true`）
- 禁用响应字段名：`negation`/`neg`/`negative`/`opposite`/`invert`/`inverted`/`minus`/`flipped`/`incremented`/`decremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys 完全等于 `["error"]`；body 不含 `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail`

## 边界情况
- `value=0` → 200 `{result:0, operation:"negate"}`，且 `Object.is(result, -0)` 为 `false`
- `value=-0` → 200 `{result:0, operation:"negate"}`（同上规范化）
- `value=9007199254740990` → 200 `{result:-9007199254740990}`
- `value=-9007199254740990` → 200 `{result:9007199254740990}`
- `value=9007199254740991` → 400（超上界）
- `value` 缺失 / 多余 query / 小数 / 科学计数法 / 前导 `+` / 十六进制 / 千分位 / 空串 / `Infinity` / `NaN` → 400

## 范围限定
**在范围内**：`playground/server.js` 加 `GET /negate` 路由；`playground/tests/server.test.js` 加 `describe('GET /negate')`；`playground/README.md` 加 `/negate` 段
**不在范围内**：不动其他路由 / 零依赖 / 不改 brain/engine/dashboard/apps；不改 `package.json`

## 假设
- [ASSUMPTION: playground 仍跑在 PORT=3000，与 W37 一致]
- [ASSUMPTION: B18 self-verify 钩子已能识别 `playground/tests/server.test.js` 中 `describe('GET /negate')` 与 `app.get('/negate', ...)` 的对应]

## 预期受影响文件
- `playground/server.js`
- `playground/tests/server.test.js`
- `playground/README.md`

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目，无 UI/brain/engine/远端 agent
