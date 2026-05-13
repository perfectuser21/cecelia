# Sprint Contract Draft (Round 1) — playground GET /negate

## Golden Path

[客户端 HTTP GET] → [playground/server.js 路由 `/negate`] → [strict-schema 整数正则 `^-?\d+$` + 精度上下界 `|value| ≤ 9007199254740991` + query 名严字面 `value`（PRD 禁用 9 个变体）] → [200 `{result:-N, operation:"negate"}` 严 schema（顶层 keys = `["operation","result"]`，operation 字面 `"negate"`，9 operation 变体一律不出现，21 禁用响应字段名反向不存在）/ 400 `{error:"<非空 string>"}` 严错误体（顶层 keys = `["error"]`，4 禁用替代名一律不出现）]

---

### Step 1: 客户端发 `GET /negate?value=<整数字符串>`

**可观测行为**: 服务 3000 端口（或 `PLAYGROUND_PORT`）能接受 `/negate` 路由请求；不存在该路由时整个 Golden Path 短路。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3301 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3301/negate?value=5")
kill $SPID 2>/dev/null
[ "$CODE" != "404" ] || { echo "FAIL: /negate 路由未注册（404）"; exit 1; }
echo "✅ Step 1：路由存在"
```

**硬阈值**: HTTP code 非 404；耗时 < 5s

---

### Step 2: strict-schema 整数 + 精度上下界 + query 名严格校验

**可观测行为**: 仅当 query 名严字面 `value`、`value` 匹配 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740991` 时通过；任何越界、小数、空白、空串、缺参、错 query 名（PRD 禁用 9 个变体）、前导 `+`、`Infinity`、`NaN`、十六进制、千分位、科学计数法等非法输入一律 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3302 node server.js & SPID=$!
sleep 2
FAIL=0
# A) 越上界 / 越下界（边界是 MAX_SAFE_INTEGER = 9007199254740991；超过即 400）
C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3302/negate?value=9007199254740992")
C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3302/negate?value=-9007199254740992")
[ "$C1" = "400" ] || { echo "FAIL: 越上界未拒 got $C1"; FAIL=1; }
[ "$C2" = "400" ] || { echo "FAIL: 越下界未拒 got $C2"; FAIL=1; }
# B) strict 拒：小数 / 科学计数 / 前导+ / 空 / 非数字 / 十六进制 / 千分位 / Infinity / NaN
for case in "value=1.5" "value=1e2" "value=+5" "value=" "value=abc" "value=0x10" "value=1,000" "value=Infinity" "value=NaN" ""; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3302/negate?$case")
  [ "$CODE" = "400" ] || { echo "FAIL: $case expect 400 got $CODE"; FAIL=1; }
done
# C) PRD 禁用 9 个 query 名全部 400
for badq in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3302/negate?$badq")
  [ "$CODE" = "400" ] || { echo "FAIL: 禁用 query $badq expect 400 got $CODE"; FAIL=1; }
done
# D) Happy 反向防误伤
HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3302/negate?value=5")
[ "$HC" = "200" ] || { echo "FAIL: value=5 应 200 实 $HC"; FAIL=1; }
kill $SPID 2>/dev/null
[ $FAIL -eq 0 ] || exit 1
echo "✅ Step 2：strict-schema + 上下界 + 9 禁用 query 名 + happy 防误伤"
```

**硬阈值**: 2 越界 + 9 strict 非法 + 1 缺参 + 9 PRD 禁用 query 名 = 21 类非法输入全 400；`value=5` 必须 200

---

### Step 3: 200 返 `{result:-N, operation:"negate"}` 严 schema（含 9 operation 变体反向反射）

**可观测行为**: 顶层 keys **严格等于** `["operation","result"]`；`operation` 字面值 `"negate"`（PRD 禁用变体 `neg`/`negation`/`negated`/`minus`/`opposite`/`flip`/`invert`/`inverse`/`unary_minus` 一律不出现）；`result` 必须是数字且等于 `-Number(value)`；body 不含 21 个 PRD 禁用响应字段名中任一个。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3303 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3303/negate?value=5")
FAIL=0
# 1) result 字段值字面（value=5 → result=-5）
echo "$RESP" | jq -e '.result == -5' >/dev/null || { echo "FAIL: result 非 -5，实际 $RESP"; FAIL=1; }
# 2) operation 字段字面字符串
echo "$RESP" | jq -e '.operation == "negate"' >/dev/null || { echo "FAIL: operation 非字面 \"negate\"，实际 $RESP"; FAIL=1; }
# 3) schema 完整性 keys
echo "$RESP" | jq -e 'keys == ["operation","result"]' >/dev/null || { echo "FAIL: keys 非 [operation,result]，实际 $(echo "$RESP" | jq -c 'keys')"; FAIL=1; }
# 4) 禁用响应字段名反向（PRD 完整 21 个）
for forbidden in negation negated minus opposite flip invert inverse incremented decremented prev predecessor sum product quotient power remainder factorial value input output data payload answer meta; do
  echo "$RESP" | jq -e "has(\"$forbidden\")|not" >/dev/null || { echo "FAIL: 禁用字段 $forbidden 出现"; FAIL=1; }
done
# 5) operation 字面字符串变体反向反射（PRD 禁用 9 变体；用 != 而非 has，因为 operation 字段必存在）
for variant in "neg" "negation" "negated" "minus" "opposite" "flip" "invert" "inverse" "unary_minus"; do
  echo "$RESP" | jq -e ".operation != \"$variant\"" >/dev/null || { echo "FAIL: operation 漂移到禁用变体 $variant"; FAIL=1; }
done
# 6) value=0 happy（边界：result 必须是 0 而不是 -0 或 0.0；JSON 序列化必须出 "0"）
RESP0=$(curl -fs "localhost:3303/negate?value=0")
echo "$RESP0" | jq -e '.result == 0 and .operation == "negate" and (keys == ["operation","result"])' >/dev/null \
  || { echo "FAIL: value=0 严 schema 不达，实际 $RESP0"; FAIL=1; }
echo "$RESP0" | grep -E '"result":\s*-?0\.0' >/dev/null && { echo "FAIL: value=0 result 漂成 -0/0.0：$RESP0"; FAIL=1; }
echo "$RESP0" | grep -E '"result":\s*-0\b' >/dev/null && { echo "FAIL: value=0 result 漂成 -0：$RESP0"; FAIL=1; }
kill $SPID 2>/dev/null
[ $FAIL -eq 0 ] || exit 1
echo "✅ Step 3：success schema 严字面 + 21 禁用字段反向 + 9 operation 变体反向 + value=0 不漂 -0/0.0"
```

**硬阈值**: 3 + 24 + 9 + 3 = 39 项 jq -e/grep 全过；任一不达即 FAIL

---

### Step 4: 400 返 `{error:"<非空 string>"}` 严错误体（含 4 禁用错误名反向）

**可观测行为**: 错误响应顶层 keys **严格等于** `["error"]`；`error` 是非空字符串；body **不含** `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail` 反向不存在。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3304 node server.js & SPID=$!
sleep 2
RESP=$(curl -s "localhost:3304/negate?value=foo")
FAIL=0
# 1) error 是非空 string
echo "$RESP" | jq -e '.error | type == "string" and length > 0' >/dev/null \
  || { echo "FAIL: error 非非空 string，实际 $RESP"; FAIL=1; }
# 2) keys 严格等于 [error]
echo "$RESP" | jq -e 'keys == ["error"]' >/dev/null \
  || { echo "FAIL: 错误体 keys 非 [error]，实际 $(echo "$RESP" | jq -c 'keys')"; FAIL=1; }
# 3) body 不含 result 也不含 operation
echo "$RESP" | jq -e 'has("result")|not' >/dev/null || { echo "FAIL: 错误体含 result"; FAIL=1; }
echo "$RESP" | jq -e 'has("operation")|not' >/dev/null || { echo "FAIL: 错误体含 operation"; FAIL=1; }
# 4) 禁用错误同义名（PRD 4 个）反向（独立 has 调用，jq 优先级安全）
for badname in "message" "msg" "reason" "detail"; do
  echo "$RESP" | jq -e "has(\"$badname\")|not" >/dev/null \
    || { echo "FAIL: 错误体含禁用替代名 $badname"; FAIL=1; }
done
kill $SPID 2>/dev/null
[ $FAIL -eq 0 ] || exit 1
echo "✅ Step 4：error schema 严格 + 4 禁用替代名反向"
```

**硬阈值**: 2 + 2 + 4 = 8 项 jq -e 全过

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd playground
PLAYGROUND_PORT=3320 node server.js & SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

BASE=http://localhost:3320

# §1) Happy: value=5 → 200 + {result:-5, operation:"negate"} 严 schema
RESP=$(curl -fs "$BASE/negate?value=5")
echo "$RESP" | jq -e '.result == -5 and .operation == "negate" and (keys == ["operation","result"])' >/dev/null \
  || { echo "FAIL §1: happy schema 不达"; exit 1; }

# §2) Boundary happy: 精度上界 MAX_SAFE_INTEGER
RESP=$(curl -fs "$BASE/negate?value=9007199254740991")
echo "$RESP" | jq -e '.result == -9007199254740991 and .operation == "negate"' >/dev/null \
  || { echo "FAIL §2: 上界 happy 不达"; exit 1; }

# §3) Boundary happy: 精度下界 -MAX_SAFE_INTEGER
RESP=$(curl -fs "$BASE/negate?value=-9007199254740991")
echo "$RESP" | jq -e '.result == 9007199254740991 and .operation == "negate"' >/dev/null \
  || { echo "FAIL §3: 下界 happy 不达"; exit 1; }

# §4) Boundary happy: value=0 → result:0（不是 -0 不是 0.0）
RESP=$(curl -fs "$BASE/negate?value=0")
echo "$RESP" | jq -e '.result == 0 and .operation == "negate"' >/dev/null \
  || { echo "FAIL §4a: value=0 happy 不达"; exit 1; }
echo "$RESP" | grep -E '"result":\s*-0\b' >/dev/null && { echo "FAIL §4b: value=0 result 漂成 -0：$RESP"; exit 1; }
echo "$RESP" | grep -E '"result":\s*-?0\.0' >/dev/null && { echo "FAIL §4c: value=0 result 漂成 -0.0/0.0：$RESP"; exit 1; }

# §5) Boundary happy: value=-1 → result:1（反向 happy 路径）
RESP=$(curl -fs "$BASE/negate?value=-1")
echo "$RESP" | jq -e '.result == 1 and .operation == "negate"' >/dev/null \
  || { echo "FAIL §5: value=-1 happy 不达"; exit 1; }

# §6) Boundary reject: 越上界 / 越下界（MAX_SAFE + 1）
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/negate?value=9007199254740992")" = "400" ] \
  || { echo "FAIL §6a: 越上界未拒"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/negate?value=-9007199254740992")" = "400" ] \
  || { echo "FAIL §6b: 越下界未拒"; exit 1; }

# §7) PRD 完整 9 个禁用 query 名全部 400
for badq in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/negate?$badq")
  [ "$CODE" = "400" ] || { echo "FAIL §7: 禁用 query $badq 应 400 实 $CODE"; exit 1; }
done

# §8) Strict schema reject: 小数 / 前导 + / 空 / 错值 / 科学计数 / 千分位 / 十六进制 / Infinity / NaN
for case in "value=1.5" "value=+5" "value=" "value=abc" "value=1e2" "value=1,000" "value=0x10" "value=Infinity" "value=NaN"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/negate?$case")
  [ "$CODE" = "400" ] || { echo "FAIL §8: $case 应 400 实 $CODE"; exit 1; }
done

# §9) 缺参也 400
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/negate")" = "400" ] \
  || { echo "FAIL §9: 缺参未拒"; exit 1; }

# §10) Error body 严 schema + 4 禁用替代名反向
RESP=$(curl -s "$BASE/negate?value=foo")
echo "$RESP" | jq -e 'keys == ["error"] and (.error | type == "string" and length > 0)' >/dev/null \
  || { echo "FAIL §10a: 错误体 schema 不达"; exit 1; }
for badname in message msg reason detail; do
  echo "$RESP" | jq -e "has(\"$badname\")|not" >/dev/null \
    || { echo "FAIL §10b: 错误体含 $badname"; exit 1; }
done

# §11) Success body 反向：PRD 完整 21 个禁用响应字段名一律不出现
RESP=$(curl -fs "$BASE/negate?value=5")
for forbidden in negation negated minus opposite flip invert inverse incremented decremented prev predecessor sum product quotient power remainder factorial value input output data payload answer meta; do
  echo "$RESP" | jq -e "has(\"$forbidden\")|not" >/dev/null \
    || { echo "FAIL §11: 禁用字段 $forbidden 出现在 success body"; exit 1; }
done

# §12) operation 字面变体反向：PRD 禁用 9 个变体一律不等
for variant in neg negation negated minus opposite flip invert inverse unary_minus; do
  echo "$RESP" | jq -e ".operation != \"$variant\"" >/dev/null \
    || { echo "FAIL §12: operation 漂移到禁用变体 $variant"; exit 1; }
done

# §13) 8 路由回归 happy（防止 /negate 改动撞坏 /sum /multiply /divide /power /modulo /increment /decrement /factorial）
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")" = "200" ] || { echo "FAIL §13: /health 回归"; exit 1; }
curl -fs "$BASE/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null || { echo "FAIL §13: /sum 回归"; exit 1; }
curl -fs "$BASE/multiply?a=7&b=5" | jq -e '.product == 35' >/dev/null || { echo "FAIL §13: /multiply 回归"; exit 1; }
curl -fs "$BASE/divide?a=10&b=2" | jq -e '.quotient == 5' >/dev/null || { echo "FAIL §13: /divide 回归"; exit 1; }
curl -fs "$BASE/power?a=2&b=10" | jq -e '.power == 1024' >/dev/null || { echo "FAIL §13: /power 回归"; exit 1; }
curl -fs "$BASE/modulo?a=10&b=3" | jq -e '.remainder == 1' >/dev/null || { echo "FAIL §13: /modulo 回归"; exit 1; }
curl -fs "$BASE/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' >/dev/null || { echo "FAIL §13: /increment 回归"; exit 1; }
curl -fs "$BASE/decrement?value=5" | jq -e '.result == 4 and .operation == "decrement"' >/dev/null || { echo "FAIL §13: /decrement 回归"; exit 1; }
curl -fs "$BASE/factorial?n=5" | jq -e '.factorial == 120' >/dev/null || { echo "FAIL §13: /factorial 回归"; exit 1; }

echo "✅ Golden Path 验收通过 — /negate 上线 + 9 禁用 query 名 + 21 禁用响应字段 + 9 operation 变体反射 + value=0 不漂 -0 + 8 路由回归全绿"
```

**通过标准**: 脚本 exit 0

---

## TDD Red 证据（v7.4 — 配合 Reviewer test_is_red 维度）

**Red 红期望**: 当前 `playground/server.js` 未含 `/negate` 路由 → supertest `GET /negate` 拿到 404 → vitest 测试块（`tests/ws1/negate.test.js`）assertion 全部 FAIL。

**Generator 纪律**（commit-1/commit-2 双 commit TDD）：
- commit-1：仅添加 `tests/ws1/negate.test.js`（按本合同原样复制）→ 运行 `cd playground && npx vitest run ../sprints/w39-walking-skeleton-final-b17/tests/ws1/negate.test.js` 必须**红**（≥ 16 个 FAIL）；CI 强校验 commit-1 测试 red。
- commit-2：实现 `playground/server.js` `/negate` 路由 + 更新 `playground/tests/server.test.js` 加 `describe('GET /negate')` 块 + `playground/README.md` 加 `/negate` 段 → 同一命令必须**绿**（全 PASS）。

**注**: vitest 仅供 generator 内部 red/green TDD 使用。**evaluator 不读 vitest 输出**，evaluator 只跑 `contract-dod-ws1.md` 的 `manual:bash` 命令（v7.4 协议）。

---

## 风险登记（v7.2 — 配合 Reviewer risk_registered 维度）

| ID | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | generator schema 漂移：返 `{negation:-5}` 或 `{result:-5, operation:"neg"}` 而非严字面 `{result, operation:"negate"}` | LLM "语义化优化"成更直观字段名（PRD 死规则反例就是这种） | Step 3 § 39 项 jq -e/grep 严断言 + DoD §"BEHAVIOR 禁用字段反向" + §"operation 变体反向反射" 双重抓 |
| R2 | generator 接受 PRD 禁用 query 名（`n`/`x`/`num` 等）→ 漂 `app.get('/negate', (req)=>req.query.n)` | generator 自由发挥 query 名 | Step 2 §C + E2E §7 共 9 case 强制全 400；DoD 独立 BEHAVIOR loop |
| R3 | 精度上下界处理不严：用 `Number.parseInt` 没区分 MAX_SAFE+1 vs 普通整数；或边界取 `> 9007199254740990` 漏 MAX_SAFE 本身 happy 路径 | 误用宽松 parser 或边界 off-by-one | Step 2 §A + DoD "精度上下界拒/happy" BEHAVIOR + E2E §2/§3/§6 |
| R4 | strict-schema regex 漂移：用 `\d+` 不带 `^...$` anchor → 误吃 `1.5`/`1e2`/`+5` | regex 写得太松 | Step 2 §B + DoD "strict-schema 非法输入" BEHAVIOR + E2E §8 9 case |
| R5 | error body 不严：返 `{error:"...", message:"..."}` 或 `{error:{...}}` 嵌套 object | 习惯性多放上下文 | Step 4 § 8 项 jq -e + DoD "错误体严 schema" BEHAVIOR + E2E §10 |
| R6 | value=0 边界漂：返 `{result:-0}` 或 `{result:0.0}`（JS `Number(-1) * -1 === 0` 但 `-(0)` 是 -0；JSON 序列化 -0 是 "0" 但有些 stringify 路径漂） | `result: -Number(value)` 写法对 value=0 给 -0；某些 toString 路径漂 0.0 | Step 3 §6 grep `-0`/`0.0` 反向 + E2E §4 |
| R7 | 8 路由回归撞坏：generator 改 `/negate` 时误改了 shared middleware 影响 /sum/multiply/... | middleware 提取/挪动 | E2E §13 8 路由 happy 回归 + DoD "8 路由回归 happy" BEHAVIOR |

每条风险都已链到 Step / E2E / DoD 三处中至少 2 处验证。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 `GET /negate` 路由 + 测试 describe 块 + README 段

**范围**:
- `playground/server.js` 新增 `app.get('/negate', ...)` 路由：query 名严字面 `value`（PRD 禁用 9 个变体名）、strict-schema 整数 `^-?\d+$`、上下界 `|Number(value)| ≤ 9007199254740991`（即 MAX_SAFE_INTEGER）、返回 `{result: -Number(value), operation: "negate"}`（operation 字面字符串，禁 9 变体；value=0 必须出 `result:0` 不出 `-0`/`0.0`）、错误体 `{error: "<非空 string>"}`（禁 4 替代名）、严 schema 完整性（顶层 keys 仅 `operation`/`result` 或仅 `error`）
- `playground/tests/server.test.js` 新增 `describe('GET /negate', ...)` 块：happy（0/5/-1/上界 MAX_SAFE/下界 -MAX_SAFE）、上下界拒（MAX_SAFE+1/-(MAX_SAFE+1)）、strict 拒（小数/前导+/科学计数法/十六进制/空串/缺参/9 禁用 query 名）、schema 完整性 oracle、21 禁用字段反向、operation 9 变体反向、错误体 keys=[error] 断言、4 禁用错误名反向
- `playground/README.md` 端点列表加 `/negate` 段（≥ 4 个示例：happy 5/0/-1/上界）
- 8 路由（/health /sum /multiply /divide /power /modulo /increment /decrement /factorial）回归 happy 1 条/路由

**大小**: S (<100 行净增 / ≤ 3 文件)

**依赖**: 无

**Generator 内部 TDD 测试文件**: `tests/ws1/negate.test.js`（**vitest 仅供 generator red→green TDD 使用，不是 evaluator oracle；evaluator 只跑 `contract-dod-ws1.md` 的 `manual:bash` 命令**）

---

## Test Contract

| Workstream | Test File (generator TDD) | Evaluator Oracle | 预期红证据 (commit-1) |
|---|---|---|---|
| WS1 | `tests/ws1/negate.test.js` | value=5→200/-5、schema 完整性、21 禁用字段名、operation 字面 negate、9 operation 变体、错误体 keys、4 禁用错误名、精度上界 happy、精度下界 happy、精度越界拒、9 禁用 query 名、value=0 不漂 -0 | `/negate` 未实现 → supertest 拿到 404 → 全部 assertion FAIL |

**关键澄清**: `tests/ws1/*.test.js` 是 generator 在 commit-1 push 的 TDD 红证据 + commit-2 push 的绿证据；`contract-dod-ws*.md` BEHAVIOR 段的 `manual:bash` 命令是 evaluator 的 verdict 源。两者不串。CI `check-dod-purity.cjs` 强校验：BEHAVIOR 段每条带 `Test: manual:bash` 内嵌命令而非"索引指向 vitest"措辞，且 BEHAVIOR 条目不带 `- [ ]`/`- [x]` 前缀（Rule 1）。
