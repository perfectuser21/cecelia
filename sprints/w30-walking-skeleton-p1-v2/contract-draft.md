# Sprint Contract Draft (Round 2)

Sprint: W30 Walking Skeleton P1 终验 round 2 — playground 加 GET /decrement endpoint
Initiative: a69c58e4-6942-40bf-9a8e-370b936294e9
journey_type: autonomous

**Round 2 修订要点**（对应 Reviewer round 1 反馈 internal_consistency=6）:
- 新增 `## Stable IDs` 段，把禁用字段名清单单源化到 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh`
- Step 8 / Step 9 / E2E 脚本 / contract-dod-ws1.md BEHAVIOR-11 / BEHAVIOR-12 一律改成 `source ... && ${BANNED_RESPONSE_KEYS[@]}` / `${BANNED_ERROR_KEYS[@]}` 引用
- 不再有任一处直接粘贴 34 字段名列表（粘贴一处 = SSOT drift 风险）
- Round 1 漏的两个 PRD 字段名（`response`、`out`）按 SSOT 字面补齐到 34（PRD L104）

---

## Stable IDs（SSOT — 禁用字段名单源）

**唯一文本源**: `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh`

该文件定义两个 bash 数组：

| 数组名 | 长度 | 用途 | PRD 来源 |
|---|---|---|---|
| `BANNED_RESPONSE_KEYS` | 34 | 成功响应 body 顶层不许出现的字段名（PR-G 死规则继承） | sprint-prd.md L103-L105（15+10+9 字面照搬） |
| `BANNED_ERROR_KEYS` | 10 | 错误响应 body 顶层不许出现的字段名 | sprint-prd.md L104 错误响应禁用清单 |

**所有验证脚本必须**（不再粘贴 34/10 字段名清单 inline）:

```bash
source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh
# 然后用 "${BANNED_RESPONSE_KEYS[@]}" 或 "${BANNED_ERROR_KEYS[@]}" 引用
```

**SSOT 维护规则**:
- 修改禁用清单 → 只改 `banned-keys.sh` 一处文本源
- 改完一处即"全验证脚本同步生效"（不需要再搜索 4 处 inline 粘贴并改 4 次）
- 任一处 inline 粘贴字段名清单 → 视为 SSOT drift 违约，reviewer 直接 REVISION

---

## Golden Path

[HTTP 客户端发 `GET /decrement?value=<整数字符串>` 到 playground] → [server 做 query 唯一性 + strict-schema `^-?\d+$` + `|Number(value)| ≤ 9007199254740990` 校验] → [显式拒一切不通过 → 400 `{error:"..."}`；通过则计算 `Number(value)-1`] → [200 `{result:<Number(value)-1>, operation:"decrement"}`，顶层 keys 字面集合 == `["operation","result"]`，不含 `${BANNED_RESPONSE_KEYS[@]}` 任一]

---

### Step 1: 入口 — happy `GET /decrement?value=5` 返 200 + strict-schema response

**可观测行为**: 客户端用合法整数串调用，server 200，返回严 schema response（字面字段名 `result` + `operation`，operation 字面值 `"decrement"`，顶层 keys 恰好两个）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3201/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation | type == "string"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: `result === 4`（独立复算 `5 - 1`）；`operation === "decrement"`（字面字符串严格相等，禁 contains / startsWith）；顶层 keys 字面集合 == `["operation","result"]`（按字母序，集合相等，不允许多余字段）。

---

### Step 2: off-by-one 零边界 — `value=0 → result=-1`、`value=1 → result=0`

**可观测行为**: 减 1 算术在零附近不偏移；`0` 减 1 是 `-1`，`1` 减 1 是 `0`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3202/decrement?value=0" | jq -e '.result == -1 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3202/decrement?value=1" | jq -e '.result == 0 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3202/decrement?value=-1" | jq -e '.result == -2 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 三条 jq -e 全过；`value=0 → result=-1`、`value=1 → result=0`、`value=-1 → result=-2`，**字面值复算严格相等**。

---

### Step 3: 精度上下界 happy — `value=±9007199254740990` 返精确整数

**可观测行为**: 在 `|value| ≤ 9007199254740990` 范围内，`Number(value)-1` 精确无浮点损失；精度下界 `value=-9007199254740990 → result=-9007199254740991`（恰 === `Number.MIN_SAFE_INTEGER`）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3203/decrement?value=9007199254740990" | jq -e '.result == 9007199254740989 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3203/decrement?value=-9007199254740990" | jq -e '.result == -9007199254740991 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 两条 jq -e 全过；精度下界 `result === -9007199254740991`（=== `Number.MIN_SAFE_INTEGER`）。

---

### Step 4: 精度上下界拒 — `|value| > 9007199254740990` 返 400

**可观测行为**: 上界 +1（`9007199254740991`）与下界 -1（`-9007199254740991`）都必须 HTTP 400 + `{error:"..."}`，body 不含 `result` 也不含 `operation`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=9007199254740991")
[ "$CODE" = "400" ] || { echo "上界 +1 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=-9007199254740991")
[ "$CODE" = "400" ] || { echo "下界 -1 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=99999999999999999999")
[ "$CODE" = "400" ] || { echo "远超上界应 400 实际 $CODE"; kill $SPID; exit 1; }
ERR=$(curl -s "localhost:3204/decrement?value=9007199254740991")
echo "$ERR" | jq -e 'has("result") | not' || { kill $SPID; exit 1; }
echo "$ERR" | jq -e 'has("operation") | not' || { kill $SPID; exit 1; }
echo "$ERR" | jq -e '.error | type == "string" and length > 0' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 三条上下界拒全 400；错误 body 不含 `result` 也不含 `operation`；`error` 是非空字符串。

---

### Step 5: strict-schema 拒 — 一切不匹配 `^-?\d+$` 的输入返 400

**可观测行为**: 小数 / 前导 + / 双重负号 / 尾部负号 / 科学计数法 / 十六进制 / 千分位 / 空格 / 空串 / 字母串 / Infinity / NaN / 仅负号 全拒。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!
sleep 2
for INPUT in "1.5" "1.0" "%2B5" "--5" "5-" "1e2" "0xff" "1%2C000" "1%20000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3205/decrement?value=${INPUT}")
  [ "$CODE" = "400" ] || { echo "value=${INPUT} 应 400 实际 ${CODE}"; kill $SPID; exit 1; }
done
kill $SPID
```

**硬阈值**: 14 条非法输入全返 400（`%2B`=`+`，`%2C`=`,`，`%20`=空格，URL 编码以正确传输）。

---

### Step 6: 错 query 名 / 缺 query / 多余 query 返 400（query 唯一性约束）

**可观测行为**: 唯一允许的 query key 是 `value`；缺 / 错名（`n` / `a` / `x`）/ 多余 key 一律 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement")
[ "$CODE" = "400" ] || { echo "缺 query 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?n=5")
[ "$CODE" = "400" ] || { echo "错 query 名 n 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?a=5")
[ "$CODE" = "400" ] || { echo "错 query 名 a 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?value=5&extra=1")
[ "$CODE" = "400" ] || { echo "多余 query 应 400 实际 $CODE"; kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 4 条 query 唯一性违约全返 400。

---

### Step 7: 前导 0 happy `value=01 → result=0`（禁 generator 错用八进制解析）

**可观测行为**: strict-schema `^-?\d+$` 允许前导 0；`Number("01") === 1`（十进制，非八进制）；故 `result === 0`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3207/decrement?value=01" | jq -e '.result == 0 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3207/decrement?value=-01" | jq -e '.result == -2 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: `value=01 → result=0`、`value=-01 → result=-2`（**禁 generator 错用 `parseInt(value, 8)` 八进制；`Number()` 自动十进制归一化**）。

---

### Step 8: 禁用字段名反向 — response 严禁出现 `${BANNED_RESPONSE_KEYS[@]}` 任一（SSOT 引用，不 inline 粘贴）

**可观测行为**: PR-G 死规则继承——response 顶层不能含任一禁用字段名。禁用清单 SSOT 单源在 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh::BANNED_RESPONSE_KEYS`（34 个；逐项字面照搬 PRD L103-L105）。

**验证命令**（脚本 source SSOT，不再 inline 粘贴 34 字段名）:
```bash
# 注意：source 必须在 `&` 之前用 `;` 隔离（不要用 `&&`），否则整个 `&&` 链会进入背景子 shell，
# source 不会作用到父 shell，BANNED_RESPONSE_KEYS 在父 shell 为空，for 循环零次迭代，假绿。
source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh
cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3208/decrement?value=5")
for BANNED in "${BANNED_RESPONSE_KEYS[@]}"; do
  echo "$RESP" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 禁用字段 ${BANNED} 出现在 /decrement 响应"; kill $SPID; exit 1; }
done
echo "✅ ${#BANNED_RESPONSE_KEYS[@]} 个禁用字段全部反向断言通过"
kill $SPID
```

**硬阈值**: SSOT 中 `${#BANNED_RESPONSE_KEYS[@]}` 个禁用字段名 `jq has() | not` 反向断言全过（当前 SSOT 长度 = 34，按 PRD L103-L105 字面对齐：15 首要 + 10 泛 generic + 9 endpoint 复用）。当 SSOT 文件长度变化时，本 Step 自动用新长度，不需要改本 Step 的脚本一字符。

---

### Step 9: error body schema 完整性 — 错误响应 keys 恰好 `["error"]`，不含 `${BANNED_ERROR_KEYS[@]}` 任一

**可观测行为**: 任一 400 错误响应顶层 keys 严格等于 `["error"]`；错误体不含 `${BANNED_ERROR_KEYS[@]}` 中任一字段（包括 `result`/`operation` 防混合污染，以及 `message`/`msg`/`reason`/`detail` 等替代字段名禁用）。

**验证命令**（脚本 source SSOT，不再 inline 粘贴 10 字段名）:
```bash
source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh
cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!
sleep 2
ERR=$(curl -s "localhost:3209/decrement?value=abc")
echo "$ERR" | jq -e 'keys | sort == ["error"]' || { kill $SPID; exit 1; }
echo "$ERR" | jq -e '.error | type == "string" and length > 0' || { kill $SPID; exit 1; }
for BANNED in "${BANNED_ERROR_KEYS[@]}"; do
  echo "$ERR" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 错误响应含禁用字段 ${BANNED}"; kill $SPID; exit 1; }
done
echo "✅ 错误体 keys=[error] + ${#BANNED_ERROR_KEYS[@]} 个错误响应禁用字段反向断言全过"
kill $SPID
```

**硬阈值**: 错误体顶层 keys 字面 `["error"]`，`error` 是非空字符串，不含 SSOT `${BANNED_ERROR_KEYS[@]}` 任一（当前长度 10）。

---

### Step 10: 已有 8 路由回归 happy（`/health` `/sum` `/multiply` `/divide` `/power` `/modulo` `/factorial` `/increment`）

**可观测行为**: 加 `/decrement` 不破坏已有 8 路由任一行为。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3210 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3210/health" | jq -e '.ok == true' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/multiply?a=7&b=5" | jq -e '.product == 35' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/divide?a=10&b=2" | jq -e '.quotient == 5' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/power?a=2&b=3" | jq -e '.power == 8' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/modulo?a=10&b=3" | jq -e '.remainder == 1' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 8 条已有路由 happy 全过；`/increment` 仍返 `{result, operation:"increment"}` 字段名不变。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本** (`scripts/golden-path-w30.sh`):

```bash
#!/bin/bash
set -e
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# 引用 SSOT 单源禁用清单 — 本 E2E 脚本不 inline 粘贴 34/10 字段名
source "$ROOT/sprints/w30-walking-skeleton-p1-v2/banned-keys.sh"

cd "$ROOT/playground"
PLAYGROUND_PORT=3299 node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

# 1. happy
RESP=$(curl -fs "localhost:3299/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' >/dev/null
echo "$RESP" | jq -e '.operation == "decrement"' >/dev/null
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' >/dev/null

# 2. off-by-one
curl -fs "localhost:3299/decrement?value=0" | jq -e '.result == -1' >/dev/null
curl -fs "localhost:3299/decrement?value=1" | jq -e '.result == 0' >/dev/null
curl -fs "localhost:3299/decrement?value=-1" | jq -e '.result == -2' >/dev/null

# 3. precision boundary happy
curl -fs "localhost:3299/decrement?value=9007199254740990" | jq -e '.result == 9007199254740989' >/dev/null
curl -fs "localhost:3299/decrement?value=-9007199254740990" | jq -e '.result == -9007199254740991' >/dev/null

# 4. precision boundary reject
for V in "9007199254740991" "-9007199254740991" "99999999999999999999"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3299/decrement?value=${V}")
  [ "$CODE" = "400" ] || { echo "FAIL: value=${V} 应 400 实际 ${CODE}"; exit 1; }
done

# 5. strict-schema rejects
for INPUT in "1.5" "1.0" "%2B5" "--5" "5-" "1e2" "0xff" "1%2C000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3299/decrement?value=${INPUT}")
  [ "$CODE" = "400" ] || { echo "FAIL: value=${INPUT} 应 400 实际 ${CODE}"; exit 1; }
done

# 6. query uniqueness
for Q in "" "?n=5" "?a=5" "?value=5&extra=1"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3299/decrement${Q}")
  [ "$CODE" = "400" ] || { echo "FAIL: /decrement${Q} 应 400 实际 ${CODE}"; exit 1; }
done

# 7. leading zero happy (not octal)
curl -fs "localhost:3299/decrement?value=01" | jq -e '.result == 0' >/dev/null
curl -fs "localhost:3299/decrement?value=-01" | jq -e '.result == -2' >/dev/null

# 8. banned response field names — 引用 SSOT BANNED_RESPONSE_KEYS（不 inline 粘贴）
RESP=$(curl -fs "localhost:3299/decrement?value=5")
for BANNED in "${BANNED_RESPONSE_KEYS[@]}"; do
  echo "$RESP" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 禁用字段 ${BANNED} 出现"; exit 1; }
done
echo "  → ${#BANNED_RESPONSE_KEYS[@]} 个 response 禁用字段反向断言全过"

# 9. error body purity — 引用 SSOT BANNED_ERROR_KEYS（不 inline 粘贴）
ERR=$(curl -s "localhost:3299/decrement?value=abc")
echo "$ERR" | jq -e 'keys | sort == ["error"]' >/dev/null
echo "$ERR" | jq -e '.error | type == "string" and length > 0' >/dev/null
for BANNED in "${BANNED_ERROR_KEYS[@]}"; do
  echo "$ERR" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 错误体含禁用字段 ${BANNED}"; exit 1; }
done
echo "  → ${#BANNED_ERROR_KEYS[@]} 个 error 禁用字段反向断言全过"

# 10. regression 8 routes
curl -fs "localhost:3299/health" | jq -e '.ok == true' >/dev/null
curl -fs "localhost:3299/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null
curl -fs "localhost:3299/multiply?a=7&b=5" | jq -e '.product == 35' >/dev/null
curl -fs "localhost:3299/divide?a=10&b=2" | jq -e '.quotient == 5' >/dev/null
curl -fs "localhost:3299/power?a=2&b=3" | jq -e '.power == 8' >/dev/null
curl -fs "localhost:3299/modulo?a=10&b=3" | jq -e '.remainder == 1' >/dev/null
curl -fs "localhost:3299/factorial?n=5" | jq -e '.factorial == 120' >/dev/null
curl -fs "localhost:3299/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' >/dev/null

echo "✅ W30 Golden Path 验证通过（10 段 + SSOT 引用零 inline 粘贴）"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /decrement 路由 + 单测 + README

**范围**: 仅动 `playground/server.js`（加 `/decrement` 路由，≈12-15 行）、`playground/tests/server.test.js`（加 `GET /decrement` describe 块，≈80-100 行单测）、`playground/README.md`（加 `/decrement` 段，6+ 示例）。**不动** brain / engine / dashboard / apps / packages 任何代码；**不动** `/health` `/sum` `/multiply` `/divide` `/power` `/modulo` `/factorial` `/increment` 八条已有路由一个字符；**不引入新依赖**（保持零依赖）。

**大小**: M（≈100-200 行新增）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/decrement.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w30-walking-skeleton-p1-v2/tests/ws1/decrement.test.js` | happy 减 1 / off-by-one 零边界 / 精度上下界 happy / 精度上下界拒 / strict 拒小数 / strict 拒前导 + / strict 拒科学计数法 / strict 拒十六进制 / strict 拒空串 / strict 拒字母 / strict 拒 Infinity / 错 query 名拒 / 缺 query 拒 / query 唯一性 / 前导 0 happy / schema 完整性 keys 集合 / operation 字面相等 / 禁用字段反向 / 错误体 keys=[error] / 错误体不含 result+operation / 8 路由回归 | 当前 server.js 无 `/decrement` 路由 → 所有 happy / strict 用例 404 → vitest FAIL |

---

## PR-G 死规则继承（v7.5 — Bug 8 修复）

本合同 **字面照搬** PRD `## Response Schema` 段（不许"语义化优化"）:

| 元素 | PRD 法定 | 合同字面 |
|---|---|---|
| query param 名 | `value` | `value` |
| 成功 response keys 集合 | `["operation","result"]` | `["operation","result"]` |
| `result` 字段类型 | `number` | `number` |
| `operation` 字段字面值 | `"decrement"` | `"decrement"` |
| 错误 response keys 集合 | `["error"]` | `["error"]` |
| 禁用响应字段名 | 见 PRD L103-L105（34 个；首要 15 + 泛 generic 10 + endpoint 复用 9）| 全部 SSOT 化到 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh::BANNED_RESPONSE_KEYS`，下游 4 处验证脚本一律 `source ... && ${BANNED_RESPONSE_KEYS[@]}` 引用 |

**自查通过证据**:
1. `bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh && echo "${#BANNED_RESPONSE_KEYS[@]}"'` 输出 `34`（与 PRD L103-L105 字面对齐）
2. `bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh && echo "${#BANNED_ERROR_KEYS[@]}"'` 输出 `10`
3. Contract response keys ⊆ PRD 允许列表（`result`, `operation`, `error`）；PRD 禁用清单字段名仅出现在 SSOT 文件与反向 `! has(...)` 断言里，**绝不在**正向 jq -e 命令出现
4. Contract / DoD 文件 grep 不到任一处 inline 粘贴的 34/10 字段名列表（粘贴 = SSOT 违约）

**SSOT 单源化的好处**:
- 修改禁用清单 → 改一处（`banned-keys.sh`）即可，无需搜索 4 处 inline 粘贴并改 4 次
- 内部一致性 100%：4 处验证脚本永远引用同一份字段名集合
- 漏字段（如 round 1 漏 `response`、`out` 共 2 个）问题在 SSOT 层一改全到位
