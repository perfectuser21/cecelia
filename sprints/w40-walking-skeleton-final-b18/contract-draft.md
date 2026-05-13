# Sprint Contract Draft (Round 3)

## Round 3 修订摘要
- 上轮 Reviewer 反馈 `risk_registered` 维度 3/10（其他维度 8-9 已过线）：要求 3 条 risk 具名 + mitigation + cascade 失败路径，并要求实现显式：`const r = n === 0 ? 0 : -n;` + 对 `value === "-0"` 做 query 层短路（`if (value === "-0") n = 0`）。
- 本轮修订：
  1. 新增"风险登记 (Risk Registry)"段，登记 **R1 (-0 漂移)** / **R2 (端口 bind 冲突)** / **R3 (Node JSON.stringify(-0) 兼容性)** 3 条 risk，每条含 cause/mitigation/cascade。
  2. Step 2 新增"实现规范钉子"段，显式声明 generator 必须用 `const r = n === 0 ? 0 : -n` + query 层 `if (value === "-0") n = 0` 短路（不接受 `result = -n` 单写法，因为 `-Number("0")===-0`）。
  3. DoD WS1 [BEHAVIOR] 新增第 12 条：自动化抓取 `playground/server.js` `app.get('/negate'` 函数体内必须出现字面短路片段 `=== "-0"` 与三元 `=== 0 ? 0 : -`，对应 R1 mitigation 落地。
  4. 其他 Round 2 验证命令、Workstream、Test Contract 全部保留（高分维度不动）。

## Round 2 修订摘要（保留）
- scope 锁死"value 在场 + 任意 extra query 名也必须 400"。

---

# Sprint Contract Draft

## Golden Path

客户端 → `GET /negate?value=<整数字符串>` → playground strict-schema 整数 + 精度上下界校验 → 200 `{result:-N, operation:"negate"}`；任一违规 → 400 `{error:"..."}`

```
[客户端发请求] → [Step 1: 路由命中 + strict-schema 校验] → [Step 2: -N 计算与 -0 规范化] → [Step 3: 序列化严 schema 出口] → [出口: 200 / 400]
```

---

### Step 1: 客户端发 GET /negate?value=N，路由命中 + 唯一 query 名 `value` + strict-schema 整数

**可观测行为**: playground 在 PORT 3000 暴露 `/negate`，仅接受唯一 query 名 `value` 且 `^-?\d+$`；其他 query 名（`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`/`neg`/`target` 共 11 个）一律 400；非整数字面（小数 / 前导 `+` / 科学计数法 / 十六进制 / 千分位 / 空串 / `Infinity` / `NaN`）一律 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3101 node server.js & SPID=$!; sleep 2
# happy: value=5 → 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3101/negate?value=5")
[ "$CODE" = "200" ] || { kill $SPID; echo "FAIL step1 happy code=$CODE"; exit 1; }
# 禁用 query 名 neg
CODE_BAD=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3101/negate?neg=5")
[ "$CODE_BAD" = "400" ] || { kill $SPID; echo "FAIL step1 forbidden-query code=$CODE_BAD"; exit 1; }
kill $SPID
```

**硬阈值**: happy 200，11 个禁用 query 名一律 400，非 `^-?\d+$` 字面一律 400。

---

### Step 1b: 唯一 query 名 `value` — value 在场 + 任意额外未知 query 名也必须 400（r2 保留）

**可观测行为**: PRD `边界情况` 段明示"多余 query → 400"。本步骤显式锁死 scope：即便 `value=5` 字面合法，只要 query string 含**任何**第二个 key（无论 key 名是否在 11 禁用清单内、是否为字面随意字符串），服务端必须返 400 + error body。这把"扩展未来字段"漏洞堵死。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3111 node server.js & SPID=$!; sleep 2
# value 合法 + extra=bar（不在 11 禁用清单内的随意名）
CODE_X1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3111/negate?value=5&extra=bar")
[ "$CODE_X1" = "400" ] || { kill $SPID; echo "FAIL step1b extra=bar code=$CODE_X1"; exit 1; }
# value 合法 + foo=1（再换一个不在清单内的）
CODE_X2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3111/negate?value=5&foo=1")
[ "$CODE_X2" = "400" ] || { kill $SPID; echo "FAIL step1b foo=1 code=$CODE_X2"; exit 1; }
# value 合法 + 禁用名清单内 neg=9 同时出现（双重违规也必须 400）
CODE_X3=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3111/negate?value=5&neg=9")
[ "$CODE_X3" = "400" ] || { kill $SPID; echo "FAIL step1b value+neg code=$CODE_X3"; exit 1; }
# value 合法 + value=10 重复 key（也必须 400，唯一 query 名意味着不允许重复）
CODE_X4=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3111/negate?value=5&value=10")
[ "$CODE_X4" = "400" ] || { kill $SPID; echo "FAIL step1b dup-value code=$CODE_X4"; exit 1; }
# 错误 body 也走严 schema：keys 严等 [error]
BODY=$(curl -s "localhost:3111/negate?value=5&extra=bar")
echo "$BODY" | jq -e '(keys | sort) == ["error"]' || { kill $SPID; echo "FAIL step1b err-keys"; exit 1; }
kill $SPID
```

**硬阈值**: 4 种"value 合法 + extra 在场"组合（含未知名 `extra=bar` / `foo=1`、清单内名 `neg=9`、重复 `value=10`）全部 400；error body keys 严等 `["error"]`。

---

### Step 2: 服务端计算 `result = -Number(value)` 并规范化 `-0` 为 `0`

**可观测行为**: 对 `value=5` 返 `result:-5`；对 `value=-7` 返 `result:7`；对 `value=0` 与 `value=-0` 都返 `result:0`，且 JSON 序列化为字面字符 `0`（不能输出 `-0`，不能让 `Object.is(result,-0)===true`）。

#### ⚠️ 实现规范钉子（r3 新增 — 对应 R1 mitigation）

Generator 实现 `app.get('/negate', ...)` **必须**同时满足以下两条字面要求（不是建议，是合同硬约束，DoD WS1 [ARTIFACT-12] 用 grep 字面字符串验证）：

1. **query 层 `-0` 短路**：在 strict-schema 通过后、计算前，**字面**写入：
   ```js
   if (value === "-0") { /* 把负零字符串提前归零 */
     // 落地为 n = 0 或等价短路
   }
   ```
   合规字面片段：`=== "-0"`（grep 必须命中）。
2. **三元规范化**：`result` 不可直接写成 `-Number(value)` 或 `-n`，**必须**用三元规范化避开 `-0`：
   ```js
   const r = n === 0 ? 0 : -n;
   ```
   合规字面片段：`=== 0 ? 0 : -`（grep 必须命中）。

**为什么这样定**：JavaScript `-Number("0") === -0`、`-Number("-0") === 0`、`Object.is(-0, 0) === false`。直接 `-n` 在 `value="0"` 时返回 `-0`；虽然 `JSON.stringify(-0) === "0"` 在 V8 上可顺手规范化，但单测里 `Object.is(res.body.result, -0)` 会泄漏（supertest 把 JSON 解析回 `0`，但中间层若用 `res.send(JSON.stringify({result: -0}))` 与 `res.json({result: -0})` 行为差异、或 generator 后续接其他序列化器，仍可能漂）。强制三元 + query 层短路是双保险。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 node server.js & SPID=$!; sleep 2
# value=5 → result=-5
curl -fs "localhost:3102/negate?value=5" | jq -e '.result == -5' || { kill $SPID; echo "FAIL step2 pos"; exit 1; }
# value=-7 → result=7
curl -fs "localhost:3102/negate?value=-7" | jq -e '.result == 7' || { kill $SPID; echo "FAIL step2 neg"; exit 1; }
# value=0 → result=0 且 JSON 不输出 -0
BODY_ZERO=$(curl -fs "localhost:3102/negate?value=0")
echo "$BODY_ZERO" | jq -e '.result == 0' || { kill $SPID; echo "FAIL step2 zero-value"; exit 1; }
echo "$BODY_ZERO" | grep -q '"result":-0' && { kill $SPID; echo "FAIL step2 raw -0 leaked"; exit 1; }
# value=-0 → result=0 且 JSON 不输出 -0
BODY_NZ=$(curl -fs "localhost:3102/negate?value=-0")
echo "$BODY_NZ" | jq -e '.result == 0' || { kill $SPID; echo "FAIL step2 neg-zero-value"; exit 1; }
echo "$BODY_NZ" | grep -q '"result":-0' && { kill $SPID; echo "FAIL step2 raw -0 leaked from -0 input"; exit 1; }
# r3 新增：实现层字面短路与三元规范化（R1 落地）
grep -q '=== "-0"' server.js || { kill $SPID; echo "FAIL step2 missing -0 short-circuit"; exit 1; }
grep -q '=== 0 ? 0 : -' server.js || { kill $SPID; echo "FAIL step2 missing ternary normalization"; exit 1; }
kill $SPID
```

**硬阈值**: `result` 等于 `-Number(value)`；`value` 为 `0` 或 `-0` 时 JSON 字面输出 `"result":0`（不允许 `"result":-0`）；server.js 字面含 `=== "-0"` 与 `=== 0 ? 0 : -`。

---

### Step 3: 序列化严 schema 出口 — success 顶层 keys 完全等于 `["operation","result"]`，operation 字面 `"negate"`，禁用字段一律不存在

**可观测行为**: 200 响应 body 顶层 keys 集合恰好是 `["operation","result"]`（不多不少）；`operation` 字面字符串 `"negate"`；22 个禁用响应字段名（`negation`/`neg`/`negative`/`opposite`/`invert`/`inverted`/`minus`/`flipped`/`incremented`/`decremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`）一律 `has(...) == false`；8 个禁用 operation 变体（`negation`/`neg`/`negative`/`opposite`/`invert`/`flip`/`minus`/`unary_minus`）一律不等于 `.operation`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 node server.js & SPID=$!; sleep 2
RESP=$(curl -fs "localhost:3103/negate?value=5")
# keys 完整性
echo "$RESP" | jq -e '(keys | sort) == ["operation","result"]' || { kill $SPID; echo "FAIL step3 keys-shape"; exit 1; }
# operation 字面
echo "$RESP" | jq -e '.operation == "negate"' || { kill $SPID; echo "FAIL step3 op-literal"; exit 1; }
# 22 禁用响应字段反向（has 必须全部 false）
for FB in negation neg negative opposite invert inverted minus flipped incremented decremented sum product quotient power remainder factorial value input output data payload answer meta; do
  echo "$RESP" | jq -e --arg k "$FB" 'has($k) | not' > /dev/null || { kill $SPID; echo "FAIL step3 forbidden-field $FB leaked"; exit 1; }
done
# 8 禁用 operation 变体
for OV in negation neg negative opposite invert flip minus unary_minus; do
  echo "$RESP" | jq -e --arg v "$OV" '.operation != $v' > /dev/null || { kill $SPID; echo "FAIL step3 forbidden-op $OV"; exit 1; }
done
kill $SPID
```

**硬阈值**: `keys == ["operation","result"]` 严等；`operation == "negate"` 字面；22 + 8 个禁用名全部不漏。

---

### Step 4: error 路径 — 任一违规返 400 + body keys 完全等于 `["error"]` 且不含 result/operation/message/msg/reason/detail

**可观测行为**: 缺 query / 非法字面 / 超界 / 禁用 query 名 → 400；error body 顶层 keys 恰好 `["error"]`，`error` 是非空字符串；body 反向不含 `result`/`operation`/`message`/`msg`/`reason`/`detail`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 node server.js & SPID=$!; sleep 2
# 非法字面
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3104/negate?value=foo")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL step4 code=$CODE"; exit 1; }
BODY=$(curl -s "localhost:3104/negate?value=foo")
# keys 严等 [error]
echo "$BODY" | jq -e '(keys | sort) == ["error"]' || { kill $SPID; echo "FAIL step4 err-keys"; exit 1; }
# error 是非空 string
echo "$BODY" | jq -e '.error | type == "string" and length > 0' || { kill $SPID; echo "FAIL step4 err-type"; exit 1; }
# 反向不含 result/operation/message/msg/reason/detail
for FB in result operation message msg reason detail; do
  echo "$BODY" | jq -e --arg k "$FB" 'has($k) | not' > /dev/null || { kill $SPID; echo "FAIL step4 err-forbidden $FB"; exit 1; }
done
# 超上界
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3104/negate?value=9007199254740991")
[ "$CODE2" = "400" ] || { kill $SPID; echo "FAIL step4 upper-bound code=$CODE2"; exit 1; }
# 缺 query
CODE3=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3104/negate")
[ "$CODE3" = "400" ] || { kill $SPID; echo "FAIL step4 missing code=$CODE3"; exit 1; }
kill $SPID
```

**硬阈值**: 400 命中，error body 顶层 keys 严等 `["error"]`，反向 6 个禁用名不漏。

---

## 风险登记 Risk Registry（r3 新增 — 解决 risk_registered 维度 3→8+）

本段对 evaluator 不直接产生 oracle，但属于合同合规义务。Reviewer 第 5 维 `risk_registered` 按下表逐条核：每条 risk 必须包含 (a) cause 具体到 LLM 代码漂移点、(b) mitigation 落到合同 BEHAVIOR/ARTIFACT 验证命令、(c) cascade 失败路径具名到 generator/CI/runtime 行为。

### R1 — `-0` 漂移（IEEE 754 负零泄漏）

- **Cause**：JavaScript `-Number("0")` 返回 `-0`（不是 `0`），且 `Object.is(-0, 0) === false`。Generator 用直觉写法 `result = -Number(value)` 或 `result = -n`，对 `value="0"` 输入会让 `result` 成为 `-0`。supertest JSON.parse 把 `-0` 解回 `0`，使 vitest `expect(res.body.result).toBe(0)` 反而绿；但 `expect(Object.is(res.body.result, -0)).toBe(false)` 和 `res.text.includes('"result":-0')` 仍能抓住中间层泄漏。Node `JSON.stringify(-0) === "0"`（V8 实现细节），但若 generator 后接其他序列化器或手拼字符串就漂。
- **Mitigation**：
  - 合同 Step 2"实现规范钉子"段强制 `const r = n === 0 ? 0 : -n` + query 层 `if (value === "-0") n = 0` 短路，双保险。
  - DoD WS1 BEHAVIOR-5 + Step 2 验证命令同时跑 `jq -e '.result == 0'` + `grep -q '"result":-0'` 反向 + vitest `res.text.includes('"result":-0') === false`。
  - DoD WS1 ARTIFACT-12（r3 新增）grep `server.js` 字面 `=== "-0"` 与 `=== 0 ? 0 : -`，直接读源代码字面，绕过 runtime 假绿。
- **Cascade 失败路径**：
  - **Generator 停手报警**：commit 前 B18 self-verify 跑 `npm test`，vitest test#3 / test#4 红 → exit non-zero → harness generator 钩子识别红线 → 标 task=failed → 不让漂移代码合入 PR。
  - **Evaluator 防假绿**：即使 generator 跳过 self-verify，evaluator 跑 DoD WS1 manual:bash 第 5/12 条，server.js 缺字面片段直接 exit 1 → verdict FAIL。

### R2 — 多端口 bind 失败 / EADDRINUSE 假绿

- **Cause**：合同 Step 1-4 + DoD WS1 BEHAVIOR 12 条 manual:bash 各启不同端口（3101-3311 共 13 个），同一 CI runner 上若有遗留进程占住端口、或 `node server.js &` 后 `sleep 2` 不够 server bind 完毕、或 trap 没接住 `kill $SPID` → 后续 curl 命中"上一个测试残留的 server"或"未 bind 完成的 server"，造成假绿（前一个测试已是正确实现）或假红（curl 拿 connection refused）。
- **Mitigation**：
  - 每条 BEHAVIOR 用独立端口（3301-3311 单调递增），降低同测试内并发冲突概率。
  - 每条 BEHAVIOR 内强制 `kill $SPID 2>/dev/null` 收尾 + `sleep 2` 给 bind 留窗口。
  - vitest 测试用 `supertest(app)` in-process 调用（不真起 HTTP server），完全绕开端口冲突 → vitest 子集是"无端口"的可重入 oracle，对 evaluator 多 worker 并发也安全。
  - DoD WS1 ARTIFACT-4 强制 `npm test --silent` 全绿（B18 self-verify 红线），等价"in-process oracle 至少有一道安全网"。
- **Cascade 失败路径**：
  - **真 bind 失败 → 立即 exit non-zero**：`node server.js &` 若 EADDRINUSE，进程立即 exit；后续 curl 拿 `Connection refused`（exit 7 with `-f`），DoD manual:bash 拿 RC≠0 → evaluator 抓 FAIL（不会被解释成"看似 happy 实则没启动"）。
  - **CI 失败可观测**：harness evaluator step 输出 FAIL 行带 BEHAVIOR 编号 + 退出码，主理人 dashboard 可定位是 bind 问题（curl exit 7）还是 schema 问题（jq exit 1）。

### R3 — Node 版本 / JSON.stringify(-0) 兼容性

- **Cause**：ECMA-262 规定 `JSON.stringify(-0) === "0"`（spec），但部分老旧 runtime / polyfill / 自定义序列化器可能不规范化。playground 依赖 Node `>=20`（package.json engines 若未声明则隐含），若 CI 在 Node 18 或更老版本上跑，`JSON.stringify({result: -0}) === '{"result":0}'` 仍成立（V8 spec-compliant），但若 generator 跳过 `res.json()` 自己拼字符串 `'{"result":' + (-0) + '}'` → 拿 `"result":0`（number → string coercion 也 spec），但 generator 若用模板字符串 `` `"result":${-0}` `` → 拿 `"result":0`。看似都 OK，**但若 generator 决定输出 `JSON.stringify({result: -0, raw: -0})` 然后 typo / 错切片，或用第三方序列化器（如 `fast-json-stringify`）schema mismatch → 输出 `-0`**。
- **Mitigation**：
  - playground `package.json` 已锁 `"type":"module"` + 默认 Node ≥ 18（W37 起）；本合同范围内不改 package.json（PRD 范围外明示）。
  - Step 2 验证命令 `grep -q '"result":-0'` 直接抓原始 response text（不经过 JSON.parse），无论 runtime/序列化器如何 → 只要 wire 上漂出 `-0` 字面就 fail。
  - R1 的"实现层 grep `=== "-0"` 与三元"是 R3 的上游 mitigation：源码层就不让 `-0` 产生 → 序列化器层不可能漂。
- **Cascade 失败路径**：
  - **Node 版本不兼容**：若 CI 切到 Node 16，express 5.x 安装可能失败 → npm test 直接报错 → DoD ARTIFACT-4 红 → harness 标 task=failed，不影响主分支。
  - **第三方序列化器漂移**：本合同范围不引入新依赖（PRD 范围限定），若 generator 越界引入 `fast-json-stringify` 等 → DoD ARTIFACT 文件白名单 + npm install 后 `package-lock.json` 不该变 → arch-review 可抓。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e
cd playground
PLAYGROUND_PORT=3200 node server.js &
SPID=$!
trap 'kill $SPID 2>/dev/null || true' EXIT
sleep 2

# 1. happy 正数
curl -fs "localhost:3200/negate?value=5" | jq -e '.result == -5 and .operation == "negate"' >/dev/null

# 2. happy 负数
curl -fs "localhost:3200/negate?value=-7" | jq -e '.result == 7 and .operation == "negate"' >/dev/null

# 3. 0 规范化（不能输出 -0）
BODY=$(curl -fs "localhost:3200/negate?value=0")
echo "$BODY" | jq -e '.result == 0 and .operation == "negate"' >/dev/null
echo "$BODY" | grep -q '"result":-0' && { echo "FAIL: -0 leaked"; exit 1; }

# 4. -0 规范化
BODY2=$(curl -fs "localhost:3200/negate?value=-0")
echo "$BODY2" | jq -e '.result == 0' >/dev/null
echo "$BODY2" | grep -q '"result":-0' && { echo "FAIL: -0 leaked from -0 input"; exit 1; }

# 5. 精度上界 happy
curl -fs "localhost:3200/negate?value=9007199254740990" | jq -e '.result == -9007199254740990' >/dev/null
curl -fs "localhost:3200/negate?value=-9007199254740990" | jq -e '.result == 9007199254740990' >/dev/null

# 6. keys 完整性严等
curl -fs "localhost:3200/negate?value=5" | jq -e '(keys | sort) == ["operation","result"]' >/dev/null

# 7. 禁用 22 响应字段反向
RESP=$(curl -fs "localhost:3200/negate?value=5")
for FB in negation neg negative opposite invert inverted minus flipped incremented decremented sum product quotient power remainder factorial value input output data payload answer meta; do
  echo "$RESP" | jq -e --arg k "$FB" 'has($k) | not' >/dev/null
done

# 8. 禁用 8 operation 变体反向
for OV in negation neg negative opposite invert flip minus unary_minus; do
  echo "$RESP" | jq -e --arg v "$OV" '.operation != $v' >/dev/null
done

# 9. 精度上界拒
CODE_OB=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3200/negate?value=9007199254740991")
[ "$CODE_OB" = "400" ]
CODE_LB=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3200/negate?value=-9007199254740991")
[ "$CODE_LB" = "400" ]

# 10. 非法字面全 400
for BAD in "1.5" "1e2" "abc" "+5" "" "0x10" "Infinity" "NaN" "1,000" " 5" "5 "; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --data-urlencode "value=$BAD" -G "localhost:3200/negate")
  [ "$CODE" = "400" ] || { echo "FAIL bad=$BAD code=$CODE"; exit 1; }
done

# 11. 11 禁用 query 名全 400
for Q in n x a b num number input v val neg target; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3200/negate?$Q=5")
  [ "$CODE" = "400" ] || { echo "FAIL forbidden-query=$Q code=$CODE"; exit 1; }
done

# 11b. value 合法 + 额外 query 名（未知/已知/重复）一律 400（r2 scope 锁死）
for EXTRA in "extra=bar" "foo=1" "neg=9" "value=10"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3200/negate?value=5&$EXTRA")
  [ "$CODE" = "400" ] || { echo "FAIL value+extra=$EXTRA code=$CODE"; exit 1; }
done

# 12. error body keys 严等 [error]
ERR=$(curl -s "localhost:3200/negate?value=foo")
echo "$ERR" | jq -e '(keys | sort) == ["error"] and (.error | type == "string" and length > 0)' >/dev/null

# 13. error body 反向 6 个禁用名
for FB in result operation message msg reason detail; do
  echo "$ERR" | jq -e --arg k "$FB" 'has($k) | not' >/dev/null
done

# 14. r3 新增：源码层 grep 抓 -0 mitigation 落地（R1）
grep -q '=== "-0"' server.js
grep -q '=== 0 ? 0 : -' server.js

# 15. vitest 也要全绿（generator self-verify 红线）
npm test --silent 2>&1 | tail -20

echo "✅ Golden Path 15 项全过"
```

**通过标准**: 脚本 `exit 0` 且最后一行包含 `✅ Golden Path 15 项全过`。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /negate 路由 + 测试 + README

**范围**:
- `playground/server.js`：新增 `app.get('/negate', ...)`，复用 `/decrement` 的 strict-schema 模式（`^-?\d+$` + `|n| ≤ 9007199254740990` + 唯一 query 名 `value`）；`-0` 规范化为 `0`（**字面**用 `if (value === "-0") n = 0` + `const r = n === 0 ? 0 : -n`，r3 强约束）。
- `playground/tests/server.test.js`：新增 `describe('GET /negate', ...)` 块，覆盖 happy / 精度上下界 / 禁用 query 名 / 禁用响应字段 / 禁用 operation 变体 / -0 规范化 / error keys 严等 / 反向 6 错误名 / scope 锁死。
- `playground/README.md`：补 `/negate` 段（描述、Query、Success/Error 例子）。

**大小**: S（预估 < 80 行净增，含 server 约 14 行 + 测试约 50 行 + README 约 15 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/negate.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/negate.test.js` | GET /negate?value=5 / strict-schema 非法字面 / result === 0 且 raw text 不含 / success 响应顶层 keys 严等 / 22 个 PRD 禁用响应字段名 / error 路径 value=foo → 400 / error body 反向不含 PRD 禁用 4 错误替代名 / scope 锁死 / R1 mitigation (r3) | `app.get('/negate')` 未实现 → 404/无 result → vitest 多项 `expect(...).toBe(...)` 失败 |
