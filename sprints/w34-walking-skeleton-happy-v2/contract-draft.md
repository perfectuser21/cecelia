# Sprint Contract Draft (Round 2)

W34 — playground 加 `GET /subtract` endpoint。本合同是 P1 B11（#2924 `MAX_FIX_ROUNDS = 20`）uncapped fix 的端到端 happy path 验收载体。合同有意保持**极薄**——无输入规则级拒、无输出值级兜底、无递推不变量；oracle 仅两类：strict-schema 白名单 + 值复算严格相等 + schema 完整性 + 禁用字段反向。

字段命名按 PRD 死规则字面照搬：response 顶层 keys 严格为 `["operation","result"]`；`operation` 严格字面字符串 `"subtract"`；query param 严格 `a` 与 `b`。

---

## Golden Path

```
[HTTP 客户端发 GET /subtract?a=5&b=3]
    ↓
[server 校验 a/b 必填 → strict-schema ^-?\d+(\.\d+)?$ → 计算 Number(a)-Number(b)]
    ↓
[200 + {result: 2, operation: "subtract"}（顶层 keys 严格 ["operation","result"]）]
```

错误支路：

```
[GET /subtract?a=foo&b=3 或 缺参 或 错 query 名 ?x=5&y=3]
    ↓
[server 缺参 / strict-schema 拒]
    ↓
[400 + {error: "<非空 string>"}（顶层 keys 严格 ["error"]，不含 result/operation）]
```

---

### Step 1: happy path — `a=5,b=3 → 2`

**可观测行为**: `GET /subtract?a=5&b=3` 返 HTTP 200，body 顶层 keys 字面集合等于 `["operation","result"]`，`result === 2`（即 `Number("5") - Number("3")` 严相等），`operation === "subtract"`（字面字符串）。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3101 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "http://127.0.0.1:3101/subtract?a=5&b=3")
echo "$RESP" | jq -e '.result == 2' || { kill $SPID; echo "FAIL: result != 2"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; echo "FAIL: operation != \"subtract\""; exit 1; }
echo "$RESP" | jq -e '(keys | sort) == ["operation","result"]' || { kill $SPID; echo "FAIL: keys != [operation, result]"; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; echo "FAIL: result not number"; exit 1; }
kill $SPID
```

**硬阈值**: 全部 jq -e 通过，exit 0。

---

### Step 2: schema 完整性 — 禁用字段反向不存在

**可观测行为**: 成功响应 body 严禁出现 PRD 禁用清单中的同义字段名（`difference`/`diff`/`minus`/`subtraction`/`sub`/`subtracted`/`delta`/`gap`/`value`/`input`/`output`/`data`/`payload`/`response`/`answer`/`out`/`meta`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`incremented`/`next`/`successor`/`a`/`b`）。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3102 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "http://127.0.0.1:3102/subtract?a=7&b=4")
for KEY in difference diff minus subtraction sub subtracted delta gap value input output data payload response answer out meta sum product quotient power remainder factorial negation incremented next successor a b; do
  echo "$RESP" | jq -e --arg k "$KEY" 'has($k) | not' || { kill $SPID; echo "FAIL: 禁用字段 $KEY 漏网"; exit 1; }
done
kill $SPID
```

**硬阈值**: 全部禁用名 `has() | not` 通过，exit 0。

---

### Step 3: happy 边界 — `a===b → 0`，负数，浮点精度损失

**可观测行为**: `a=10,b=10` → `result === 0`；`a=-5,b=3` → `result === -8`；`a=5,b=-3` → `result === 8`；`a=-5,b=-3` → `result === -2`；`a=0.3,b=0.1` → `result === 0.19999999999999998`（IEEE 754 双精度，**严格不容差**，evaluator 用同表达式独立复算后 jq 严等比较）。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3103 node server.js & SPID=$!
sleep 2

# a===b → 0
curl -fs "http://127.0.0.1:3103/subtract?a=10&b=10" | jq -e '.result == 0 and .operation == "subtract"' || { kill $SPID; echo "FAIL: 10-10 != 0"; exit 1; }
# 负数
curl -fs "http://127.0.0.1:3103/subtract?a=-5&b=3" | jq -e '.result == -8' || { kill $SPID; echo "FAIL: -5-3 != -8"; exit 1; }
curl -fs "http://127.0.0.1:3103/subtract?a=5&b=-3" | jq -e '.result == 8' || { kill $SPID; echo "FAIL: 5-(-3) != 8"; exit 1; }
curl -fs "http://127.0.0.1:3103/subtract?a=-5&b=-3" | jq -e '.result == -2' || { kill $SPID; echo "FAIL: -5-(-3) != -2"; exit 1; }
# 浮点精度损失 — 严格不容差
RESP=$(curl -fs "http://127.0.0.1:3103/subtract?a=0.3&b=0.1")
EXPECTED=$(node -e 'console.log(Number("0.3") - Number("0.1"))')
echo "$RESP" | jq -e --argjson e "$EXPECTED" '.result == $e' || { kill $SPID; echo "FAIL: 0.3-0.1 浮点严等失败"; exit 1; }
kill $SPID
```

**硬阈值**: 全部独立复算 jq 严等通过，exit 0。

---

### Step 4: error path — 缺参返 400

**可观测行为**: `GET /subtract`（双参全缺）/ `GET /subtract?a=5`（缺 b）/ `GET /subtract?b=3`（缺 a）均返 HTTP 400，body 顶层 keys 严格 `["error"]`，`error` 为非空字符串，body **不含** `result` 也 **不含** `operation`。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3104 node server.js & SPID=$!
sleep 2

for QS in "" "a=5" "b=3"; do
  CODE=$(curl -s -o /tmp/sub-err.json -w "%{http_code}" "http://127.0.0.1:3104/subtract?$QS")
  [ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: ?$QS code=$CODE != 400"; exit 1; }
  jq -e '(keys | sort) == ["error"]' /tmp/sub-err.json || { kill $SPID; echo "FAIL: ?$QS error keys mismatch"; exit 1; }
  jq -e '.error | type == "string" and length > 0' /tmp/sub-err.json || { kill $SPID; echo "FAIL: ?$QS error 非非空 string"; exit 1; }
  jq -e 'has("result") | not' /tmp/sub-err.json || { kill $SPID; echo "FAIL: ?$QS 错误体含 result"; exit 1; }
  jq -e 'has("operation") | not' /tmp/sub-err.json || { kill $SPID; echo "FAIL: ?$QS 错误体含 operation"; exit 1; }
done
kill $SPID
```

**硬阈值**: 三个错误路径全部 400 + keys=["error"] + 无 result/operation，exit 0。

---

### Step 5: error path — strict-schema 拒非法输入

**可观测行为**: `a=1e3,b=2` / `a=Infinity,b=2` / `a=2,b=NaN` / `a=+5,b=3` / `a=.5,b=2` / `a=5.,b=3` / `a=0xff,b=2` / `a=1,000,b=2` / `a=abc,b=3` / `a=--5,b=3` 任一非法均返 HTTP 400，body 顶层 keys 严格 `["error"]`。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3105 node server.js & SPID=$!
sleep 2

# 用数组保留每个 case 的字面 query string（绕 shell 转义）
CASES=(
  "a=1e3&b=2"
  "a=Infinity&b=2"
  "a=2&b=NaN"
  "a=%2B5&b=3"       # +5 URL-encoded
  "a=.5&b=2"
  "a=5.&b=3"
  "a=0xff&b=2"
  "a=1%2C000&b=2"    # 1,000 URL-encoded
  "a=abc&b=3"
  "a=--5&b=3"
)
for QS in "${CASES[@]}"; do
  CODE=$(curl -s -o /tmp/sub-strict.json -w "%{http_code}" "http://127.0.0.1:3105/subtract?$QS")
  [ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: ?$QS 期望 400 实得 $CODE"; exit 1; }
  jq -e '(keys | sort) == ["error"]' /tmp/sub-strict.json || { kill $SPID; echo "FAIL: ?$QS keys mismatch"; exit 1; }
done
kill $SPID
```

**硬阈值**: 10 条非法输入全部 400 + keys=["error"]，exit 0。

---

### Step 6: query 名锁死 — 错 query 名 `?x=5&y=3` 也按缺 a/b 拒

**可观测行为**: `GET /subtract?x=5&y=3` 返 400（缺 a、b 分支），body 顶层 keys 严格 `["error"]`。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3106 node server.js & SPID=$!
sleep 2

CODE=$(curl -s -o /tmp/sub-q.json -w "%{http_code}" "http://127.0.0.1:3106/subtract?x=5&y=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: ?x=5&y=3 期望 400 实得 $CODE"; exit 1; }
jq -e '(keys | sort) == ["error"]' /tmp/sub-q.json || { kill $SPID; echo "FAIL: 错 query 名错误体 keys 异常"; exit 1; }
kill $SPID
```

**硬阈值**: 400 + keys=["error"]，exit 0。

---

### Step 7: 8 路由回归 — 不动既有 endpoint

**可观测行为**: `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 全部 happy 用例仍然通过，证明 W34 改动未碰既有路由。

**验证命令**:

```bash
cd playground && PLAYGROUND_PORT=3107 node server.js & SPID=$!
sleep 2

curl -fs "http://127.0.0.1:3107/health" | jq -e '.ok == true' || { kill $SPID; echo "FAIL: /health"; exit 1; }
curl -fs "http://127.0.0.1:3107/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; echo "FAIL: /sum"; exit 1; }
curl -fs "http://127.0.0.1:3107/multiply?a=2&b=3" | jq -e '.product == 6' || { kill $SPID; echo "FAIL: /multiply"; exit 1; }
curl -fs "http://127.0.0.1:3107/divide?a=6&b=2" | jq -e '.quotient == 3' || { kill $SPID; echo "FAIL: /divide"; exit 1; }
curl -fs "http://127.0.0.1:3107/power?a=2&b=3" | jq -e '.power == 8' || { kill $SPID; echo "FAIL: /power"; exit 1; }
curl -fs "http://127.0.0.1:3107/modulo?a=10&b=3" | jq -e '.remainder == 1' || { kill $SPID; echo "FAIL: /modulo"; exit 1; }
curl -fs "http://127.0.0.1:3107/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; echo "FAIL: /factorial"; exit 1; }
curl -fs "http://127.0.0.1:3107/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { kill $SPID; echo "FAIL: /increment"; exit 1; }
kill $SPID
```

**硬阈值**: 8 路由 happy 全过，exit 0。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `autonomous`

**完整验证脚本**:

```bash
#!/bin/bash
set -euo pipefail

# 0. 启 playground server（用一个固定端口跑完整流程）
cd playground
npm install --silent
PLAYGROUND_PORT=3299 node server.js > /tmp/sub-e2e.log 2>&1 &
SPID=$!
trap 'kill $SPID 2>/dev/null || true' EXIT
sleep 2

BASE="http://127.0.0.1:3299/subtract"

# 1. happy path — 严 schema + 值复算严等 + keys 完整性
RESP=$(curl -fs "$BASE?a=5&b=3")
echo "$RESP" | jq -e '.result == 2' >/dev/null
echo "$RESP" | jq -e '.operation == "subtract"' >/dev/null
echo "$RESP" | jq -e '(keys | sort) == ["operation","result"]' >/dev/null
echo "$RESP" | jq -e '.result | type == "number"' >/dev/null

# 2. happy 边界
curl -fs "$BASE?a=10&b=10" | jq -e '.result == 0 and .operation == "subtract"' >/dev/null
curl -fs "$BASE?a=-5&b=3"  | jq -e '.result == -8' >/dev/null
curl -fs "$BASE?a=5&b=-3"  | jq -e '.result == 8' >/dev/null
curl -fs "$BASE?a=-5&b=-3" | jq -e '.result == -2' >/dev/null
curl -fs "$BASE?a=0&b=0"   | jq -e '.result == 0' >/dev/null
curl -fs "$BASE?a=1.5&b=0.5" | jq -e '.result == 1' >/dev/null

# 3. 浮点精度损失 — 用 node 独立复算后严等比较，不允许容差
RESP=$(curl -fs "$BASE?a=0.3&b=0.1")
EXPECTED=$(node -e 'console.log(Number("0.3") - Number("0.1"))')
echo "$RESP" | jq -e --argjson e "$EXPECTED" '.result == $e' >/dev/null

# 4. 禁用字段反向 — generator 不许漂到 difference/diff/minus 等同义名
for KEY in difference diff minus subtraction sub subtracted delta gap value input output data payload response answer out meta sum product quotient power remainder factorial negation incremented next successor a b; do
  echo "$RESP" | jq -e --arg k "$KEY" 'has($k) | not' >/dev/null || { echo "FAIL: 禁用字段 $KEY 漏网"; exit 1; }
done

# 5. error path — 缺参 / strict 拒 / 错 query 名
for QS in "" "a=5" "b=3" "x=5&y=3" "a=1e3&b=2" "a=Infinity&b=2" "a=2&b=NaN" "a=%2B5&b=3" "a=.5&b=2" "a=5.&b=3" "a=0xff&b=2" "a=1%2C000&b=2" "a=abc&b=3" "a=--5&b=3"; do
  CODE=$(curl -s -o /tmp/e2e-err.json -w "%{http_code}" "$BASE?$QS")
  [ "$CODE" = "400" ] || { echo "FAIL: ?$QS code=$CODE != 400"; exit 1; }
  jq -e '(keys | sort) == ["error"]' /tmp/e2e-err.json >/dev/null
  jq -e '.error | type == "string" and length > 0' /tmp/e2e-err.json >/dev/null
  jq -e 'has("result") | not' /tmp/e2e-err.json >/dev/null
  jq -e 'has("operation") | not' /tmp/e2e-err.json >/dev/null
done

# 6. 8 路由回归
curl -fs "http://127.0.0.1:3299/health"           | jq -e '.ok == true' >/dev/null
curl -fs "http://127.0.0.1:3299/sum?a=2&b=3"      | jq -e '.sum == 5' >/dev/null
curl -fs "http://127.0.0.1:3299/multiply?a=2&b=3" | jq -e '.product == 6' >/dev/null
curl -fs "http://127.0.0.1:3299/divide?a=6&b=2"   | jq -e '.quotient == 3' >/dev/null
curl -fs "http://127.0.0.1:3299/power?a=2&b=3"    | jq -e '.power == 8' >/dev/null
curl -fs "http://127.0.0.1:3299/modulo?a=10&b=3"  | jq -e '.remainder == 1' >/dev/null
curl -fs "http://127.0.0.1:3299/factorial?n=5"    | jq -e '.factorial == 120' >/dev/null
curl -fs "http://127.0.0.1:3299/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' >/dev/null

echo "✅ W34 /subtract Golden Path E2E 全过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 `GET /subtract` 路由 + 单测 + README

**范围**:
- 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /subtract` 路由
- 必填校验 `req.query.a` 和 `req.query.b` 都存在 → 否则 400 + `{error: "<非空 string>"}`
- 复用既有 `STRICT_NUMBER = /^-?\d+(\.\d+)?$/` 常量做白名单校验 → 任一不匹配 400
- 计算 `Number(a) - Number(b)`，返回 `{result, operation: "subtract"}`（字面字段名）
- 在 `playground/tests/server.test.js` 新增 `describe('GET /subtract', ...)` 块覆盖 happy 9+ / 浮点精度 1+ / strict 拒 12+ / 缺参 3 / 错 query 名 2 / 值 oracle 3+ / schema 完整性 3+ / 错误体形状 2+ / 8 路由回归 1/路由
- 在 `playground/README.md` 端点列表加 `/subtract`，至少 5 个示例

**大小**: S（≈ 10-12 行 server.js + ≈ 30-40 个新 test + 1 行 README 端点条目）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/subtract.test.ts`（vitest，generator TDD red-green 用；不被 evaluator 当 verdict 来源）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/subtract.test.ts` | happy 严 schema + 值复算 / 算术边界（a===b、混合正负号、0-0） / keys 完整性 / 禁用字段反向 / error path 400 + keys=["error"] / 错误体不含 result/operation / 浮点精度严等 | server.js 未加 `/subtract` 时全部 it 块 expect fail（404 而非 200 / 400 而非期望 keys） |

---

## 已识别风险（Risks Registered）

W34 是 P1 B11 uncapped fix 端到端 happy path 验收载体，合同有意保持极薄。下列风险来自 PRD 显式背景 + W19~W26 实证经验，proposer 已在 contract-dod / contract-draft 验证命令里**主动设防**（每个风险都对应至少 1 条 manual:bash oracle 抓异常）。Reviewer 若发现某风险未设防可指名要求补加 BEHAVIOR：

| # | 风险描述 | 来源 | 设防机制（合同里的具体命令）|
|---|---|---|---|
| R1 | **字段名漂移**：generator 把 response 字段从 `{result, operation: "subtract"}` 优化成 `{difference}` / `{diff}` / `{result, operation: "sub"}` / `{minus}` 等同义形态 | W25 negate 实证 proposer 漂 `result→negation`；W26 increment 实证 proposer 漂 `result→incremented/next` | (1) Step 1 + Step 3 用 `jq -e '.result == X'` + `'.operation == "subtract"'` 字面相等；(2) Step 2 禁用字段反向断言 30+ 同义名 `has() | not`；(3) Step 1 + Step 3 keys 完整性 `keys|sort == ["operation","result"]` 不允许多余字段；(4) DoD ARTIFACT 段 grep 源码 `operation: 'subtract'` 字面 |
| R2 | **strict-schema 重新发明**：generator 不复用既有 `STRICT_NUMBER = /^-?\d+(\.\d+)?$/`，自己写变体 `^[+-]?\d+(\.\d+)?$` / `^-?\d*\.?\d+$` 假绿 | W20~W26 多次实证 generator 倾向"自己写一份"导致与其他 endpoint 不一致 | Step 5 strict-schema 拒 10 类非法输入（科学计数法 / Infinity / NaN / 前导 + / `.5` / `5.` / 0xff / 千分位 / 字母 / `--5`）全 400 + keys=["error"]；任一漏抓即 FAIL |
| R3 | **浮点精度容差陷阱**：generator 在结果上加 `parseFloat(result.toFixed(N))` / `Math.abs() < Number.EPSILON` 容差比较，把 `0.3-0.1` 误调成 `0.2` 假绿 | PRD 显式禁止容差比较 | Step 3 + DoD R4 BEHAVIOR `a=0.3&b=0.1` 用 `node -e 'console.log(Number("0.3")-Number("0.1"))'` 独立复算 + `jq -e --argjson e ".result == $e"` 严等；任何截断 / 容差立 FAIL |
| R4 | **错误体字段污染**：generator 在 400 错误响应里加 `message` / `msg` / `reason` / `code` / `detail` 等替代字段，或既报错又给 `result: null` | W26 实证 generator 偶发混合污染 | Step 4 + DoD BEHAVIOR `jq -e '(keys | sort) == ["error"]'` + `has("result") | not` + `has("operation") | not` 三重防御 |
| R5 | **既有 8 路由回归破坏**：generator 修改 `/subtract` 时误改共享的 `STRICT_NUMBER` 常量或共享错误响应辅助函数，连带破坏 `/sum` ~ `/increment` | 共享常量 + 共享 helper 改动易连坐 | Step 7 + DoD 第 8 条 BEHAVIOR 跑 8 路由 happy 用例，任一 FAIL 即整体 FAIL |
| R6 | **P1 B11 uncapped fix 失效 / 假绿**：harness pipeline 在 P1 B1~B11 修复栈下未真跑出 task=completed（某 P1 B* 修复回归 / GAN 收敛震荡 / reaper 误杀 / dispatcher HOL / final_evaluate 假绿）| #2924 改 `MAX_FIX_ROUNDS 3→20` 后首次端到端验收 | 合同**故意保持极薄**（核心 oracle 仅 2 类）排除"任务本身复杂"干扰因素；E2E 验收脚本 set -euo pipefail 任何 jq -e/curl -f 失败立 exit 1；evaluator 跑 DoD 9 条 BEHAVIOR 任一 FAIL 整体 FAIL，杜绝"部分 case 通过被判 PASS"假绿 |
| R7 | **query 名锁死失效**：generator 容忍 `?x=5&y=3` / `?minuend=5&subtrahend=3` 等错 query 名（按 a=undefined 转 NaN 后假绿）| W26 implementation drift 实证 | Step 6 + DoD `[BEHAVIOR] ?x=5&y=3 → 400`；Step 5 strict 拒 `?a=abc&b=3` 之类字面非法 query 双重防御 |
| R8 | **零依赖原则破坏**：generator 引 zod / joi / ajv / decimal.js / bignumber.js | playground 零依赖原则 | DoD ARTIFACT 第 5 条 `jq dependencies | keys` 严格等于 `["express"]` |

**风险总结**：R1 / R3 是 W34 最大风险（W25/W26 实证过的同款漂移路径）；R6 是 W34 元目标本身的风险（不在 generator 控制范围内，靠合同结构本身保护）。其余 R2/R4/R5/R7/R8 是常规防御。所有风险都有合同内 oracle 覆盖，Reviewer 可按表格逐项验证。
