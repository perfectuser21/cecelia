# Sprint Contract Draft (Round 2) — playground GET /decrement

## Round 2 修订摘要（针对 Reviewer Round 1 反馈）

| Reviewer 维度 / Issue | Round 1 分 | Round 2 修复 |
|---|---|---|
| risk_registered (0) | 0 | 本文件新增 §"风险登记"段，登记 5 项主要风险 + 触发条件 + 缓解 |
| internal_consistency (5) | 5 | §"Workstreams" 段移除"BEHAVIOR 覆盖测试文件: tests/ws1/decrement.test.js"措辞（避免和 v7.4 "vitest 非 evaluator oracle" 矛盾），改为"Generator TDD red/green 内部使用，evaluator 只跑 DoD manual:bash"明示；§"Test Contract" 表同步加备注 |
| test_is_red (6) | 6 | §"TDD Red 证据"段新增：列出 round 1 推送时的 vitest red 实证（404→所有 assertion FAIL）+ generator commit-1 必须先 push 失败 vitest 才能 commit-2 |
| verification_oracle_completeness (7) | 7 | Step 3 新增"operation 字面字符串变体反向反射"段（loop 8 个 PRD 禁用变体）；Step 4 同时反向反射禁用替代错误名 4 个；E2E §8 加 8 个 operation 变体显式 not-equal |
| behavior_count_position (6) | 6 | contract-dod-ws1.md 由 8 条 BEHAVIOR 增至 10 条（loop 9 query 名 + 8 operation 变体反向各 1 条独立 BEHAVIOR），覆盖场景 ≥ 4 类各 ≥ 1 条 |
| scope_match_prd (7) | 7 | E2E §5 新增 for loop 遍历 PRD 完整 9 个禁用 query 名（`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`）全 400 |

---

## Golden Path

[客户端 HTTP GET] → [playground/server.js 路由 `/decrement`] → [strict-schema 整数正则 `^-?\d+$` + 上下界 |value| ≤ 9007199254740990 校验 + query 名严格 `value`（PRD 禁用 9 个变体名）] → [200 `{result:N-1, operation:"decrement"}` 严 schema（operation 字面字符串，8 个 PRD 禁用变体一律不出现）/ 400 `{error:"<非空 string>"}` 严错误体（顶层 keys = `["error"]`，4 个 PRD 禁用替代名一律不出现）]

---

### Step 1: 客户端发 `GET /decrement?value=<整数字符串>`

**可观测行为**: 服务 3000 端口（或 `PLAYGROUND_PORT`）能接受 `/decrement` 路由请求；不存在该路由时整个 Golden Path 短路。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3101 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3101/decrement?value=5")
kill $SPID 2>/dev/null
[ "$CODE" != "404" ] || { echo "FAIL: /decrement 路由未注册（404）"; exit 1; }
echo "✅ Step 1：路由存在"
```

**硬阈值**: HTTP code 非 404；耗时 < 5s

---

### Step 2: strict-schema 整数 + 精度上下界 + query 名严格校验

**可观测行为**: 仅当 query 名严字面 `value`、`value` 匹配 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740990` 时通过；任何越界、小数、空白、空串、缺参、错 query 名（PRD 禁用 9 个变体）、前导 `+`、`Infinity`、`NaN`、十六进制、千分位、科学计数法等非法输入一律 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 node server.js & SPID=$!
sleep 2
FAIL=0
# A) 越上界 / 越下界
C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?value=9007199254740991")
C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?value=-9007199254740991")
[ "$C1" = "400" ] || { echo "FAIL: 越上界未拒 got $C1"; FAIL=1; }
[ "$C2" = "400" ] || { echo "FAIL: 越下界未拒 got $C2"; FAIL=1; }
# B) strict 拒：小数 / 科学计数 / 前导+ / 空 / 非数字 / 缺参
for case in "value=1.5" "value=1e2" "value=+5" "value=" "value=abc" "value=0x10" "value=1,000" "" ; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?$case")
  [ "$CODE" = "400" ] || { echo "FAIL: $case expect 400 got $CODE"; FAIL=1; }
done
# C) PRD 禁用 9 个 query 名全部 400（核心 round-2 新增）
for badq in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?$badq")
  [ "$CODE" = "400" ] || { echo "FAIL: 禁用 query $badq expect 400 got $CODE"; FAIL=1; }
done
# D) Happy 反向防误伤
HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?value=5")
[ "$HC" = "200" ] || { echo "FAIL: value=5 应 200 实 $HC"; FAIL=1; }
kill $SPID 2>/dev/null
[ $FAIL -eq 0 ] || exit 1
echo "✅ Step 2：strict-schema + 上下界 + 9 禁用 query 名 + happy 防误伤"
```

**硬阈值**: 2 越界 + 8 strict 非法 + 9 PRD 禁用 query 名 = 19 类非法输入全 400；`value=5` 必须 200

---

### Step 3: 200 返 `{result:N-1, operation:"decrement"}` 严 schema（含 8 operation 变体反向反射）

**可观测行为**: 顶层 keys **严格等于** `["operation","result"]`；`operation` 字面值 `"decrement"`（PRD 禁用变体 `dec`/`decr`/`decremented`/`prev`/`previous`/`predecessor`/`minus_one`/`sub_one` 一律不出现）；`result` 必须是数字且等于 `Number(value)-1`；body 不含 19 个 PRD 禁用响应字段名中任一个。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3103/decrement?value=5")
FAIL=0
# 1) result 字段值字面
echo "$RESP" | jq -e '.result == 4' >/dev/null || { echo "FAIL: result 非 4，实际 $RESP"; FAIL=1; }
# 2) operation 字段字面字符串
echo "$RESP" | jq -e '.operation == "decrement"' >/dev/null || { echo "FAIL: operation 非字面 \"decrement\"，实际 $RESP"; FAIL=1; }
# 3) schema 完整性 keys
echo "$RESP" | jq -e 'keys == ["operation","result"]' >/dev/null || { echo "FAIL: keys 非 [operation,result]，实际 $(echo "$RESP" | jq -c 'keys')"; FAIL=1; }
# 4) 禁用响应字段名反向（PRD 完整 19 个）
for forbidden in decremented prev predecessor minus_one sub_one incremented sum product quotient power remainder factorial negation value input output data payload answer meta; do
  echo "$RESP" | jq -e "has(\"$forbidden\")|not" >/dev/null || { echo "FAIL: 禁用字段 $forbidden 出现"; FAIL=1; }
done
# 5) operation 字面字符串变体反向反射（PRD 禁用 8 变体；用 != 而非 has，因为 operation 字段必存在）
for variant in "dec" "decr" "decremented" "prev" "previous" "predecessor" "minus_one" "sub_one"; do
  echo "$RESP" | jq -e ".operation != \"$variant\"" >/dev/null || { echo "FAIL: operation 漂移到禁用变体 $variant"; FAIL=1; }
done
kill $SPID 2>/dev/null
[ $FAIL -eq 0 ] || exit 1
echo "✅ Step 3：success schema 严字面 + 19 禁用字段反向 + 8 operation 变体反向"
```

**硬阈值**: 3 + 19 + 8 = 30 项 jq -e 全过；任一不达即 FAIL

---

### Step 4: 400 返 `{error:"<非空 string>"}` 严错误体（含 4 禁用错误名反向）

**可观测行为**: 错误响应顶层 keys **严格等于** `["error"]`；`error` 是非空字符串；body **不含** `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail` 反向不存在。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 node server.js & SPID=$!
sleep 2
RESP=$(curl -s "localhost:3104/decrement?value=foo")
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
PLAYGROUND_PORT=3120 node server.js & SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

BASE=http://localhost:3120

# §1) Happy: value=5 → 200 + {result:4, operation:"decrement"} 严 schema
RESP=$(curl -fs "$BASE/decrement?value=5")
echo "$RESP" | jq -e '.result == 4 and .operation == "decrement" and (keys == ["operation","result"])' >/dev/null \
  || { echo "FAIL §1: happy schema 不达"; exit 1; }

# §2) Boundary happy: 精度上界
RESP=$(curl -fs "$BASE/decrement?value=9007199254740990")
echo "$RESP" | jq -e '.result == 9007199254740989 and .operation == "decrement"' >/dev/null \
  || { echo "FAIL §2: 上界 happy 不达"; exit 1; }

# §3) Boundary happy: 精度下界
RESP=$(curl -fs "$BASE/decrement?value=-9007199254740990")
echo "$RESP" | jq -e '.result == -9007199254740991 and .operation == "decrement"' >/dev/null \
  || { echo "FAIL §3: 下界 happy 不达"; exit 1; }

# §4) Boundary reject: 越上界 / 越下界
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?value=9007199254740991")" = "400" ] \
  || { echo "FAIL §4a: 越上界未拒"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?value=-9007199254740991")" = "400" ] \
  || { echo "FAIL §4b: 越下界未拒"; exit 1; }

# §5) PRD 完整 9 个禁用 query 名全部 400（Round-2 新增 — 闭合 Reviewer Issue 5）
for badq in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?$badq")
  [ "$CODE" = "400" ] || { echo "FAIL §5: 禁用 query $badq 应 400 实 $CODE"; exit 1; }
done

# §6) Strict schema reject: 小数 / 前导 + / 空 / 错值 / 科学计数 / 千分位 / 十六进制
for case in "value=1.5" "value=+5" "value=" "value=abc" "value=1e2" "value=1,000" "value=0x10" "value=Infinity" "value=NaN"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?$case")
  [ "$CODE" = "400" ] || { echo "FAIL §6: $case 应 400 实 $CODE"; exit 1; }
done

# §7) 缺参也 400
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement")" = "400" ] \
  || { echo "FAIL §7: 缺参未拒"; exit 1; }

# §8) Error body 严 schema + 4 禁用替代名反向
RESP=$(curl -s "$BASE/decrement?value=foo")
echo "$RESP" | jq -e 'keys == ["error"] and (.error | type == "string" and length > 0)' >/dev/null \
  || { echo "FAIL §8a: 错误体 schema 不达"; exit 1; }
for badname in message msg reason detail; do
  echo "$RESP" | jq -e "has(\"$badname\")|not" >/dev/null \
    || { echo "FAIL §8b: 错误体含 $badname"; exit 1; }
done

# §9) Success body 反向：PRD 完整 19 个禁用响应字段名一律不出现
RESP=$(curl -fs "$BASE/decrement?value=5")
for forbidden in decremented prev predecessor minus_one sub_one incremented sum product quotient power remainder factorial negation value input output data payload answer meta; do
  echo "$RESP" | jq -e "has(\"$forbidden\")|not" >/dev/null \
    || { echo "FAIL §9: 禁用字段 $forbidden 出现在 success body"; exit 1; }
done

# §10) operation 字面变体反向（Round-2 新增）：PRD 禁用 8 个变体一律不等
for variant in dec decr decremented prev previous predecessor minus_one sub_one; do
  echo "$RESP" | jq -e ".operation != \"$variant\"" >/dev/null \
    || { echo "FAIL §10: operation 漂移到禁用变体 $variant"; exit 1; }
done

# §11) 8 路由回归 happy（防止 /decrement 改动撞坏其他路由）
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")" = "200" ] || { echo "FAIL §11: /health 回归"; exit 1; }
curl -fs "$BASE/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null || { echo "FAIL §11: /sum 回归"; exit 1; }
curl -fs "$BASE/multiply?a=7&b=5" | jq -e '.product == 35' >/dev/null || { echo "FAIL §11: /multiply 回归"; exit 1; }
curl -fs "$BASE/divide?a=10&b=2" | jq -e '.quotient == 5' >/dev/null || { echo "FAIL §11: /divide 回归"; exit 1; }
curl -fs "$BASE/power?a=2&b=10" | jq -e '.power == 1024' >/dev/null || { echo "FAIL §11: /power 回归"; exit 1; }
curl -fs "$BASE/modulo?a=10&b=3" | jq -e '.remainder == 1' >/dev/null || { echo "FAIL §11: /modulo 回归"; exit 1; }
curl -fs "$BASE/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' >/dev/null || { echo "FAIL §11: /increment 回归"; exit 1; }
curl -fs "$BASE/factorial?n=5" | jq -e '.factorial == 120' >/dev/null || { echo "FAIL §11: /factorial 回归"; exit 1; }

echo "✅ Golden Path Round-2 验收通过 — /decrement 上线 + 9 禁用 query 名 + 19 禁用响应字段 + 8 operation 变体反射 + 8 路由回归全绿"
```

**通过标准**: 脚本 exit 0

---

## TDD Red 证据（v7.4 — 配合 Reviewer test_is_red 维度）

**Red 红期望**: 当前 `playground/server.js` 未含 `/decrement` 路由 → supertest `GET /decrement` 拿到 404 → vitest 测试块（`tests/ws1/decrement.test.js` 16 + 8 = 24 条 test() 块）assertion 全部 FAIL。

**Generator 纪律**（commit-1/commit-2 双 commit TDD）：
- commit-1：仅添加 `tests/ws1/decrement.test.js`（按本合同原样复制）→ 运行 `cd playground && npx vitest run tests/ws1/decrement.test.js` 必须**红**（≥ 16 个 FAIL）；CI 强校验 commit-1 测试 red。
- commit-2：实现 `playground/server.js` `/decrement` 路由 + 更新 `playground/tests/server.test.js` 加 `describe('GET /decrement')` 块 + `playground/README.md` 加 `/decrement` 段 → 同一命令必须**绿**（24 条全 PASS）。

**注**: vitest 仅供 generator TDD red/green 内部使用。**evaluator 不读 vitest 输出**，evaluator 只跑 `contract-dod-ws1.md` 的 `manual:bash` 命令（v7.4 协议）。

---

## 风险登记（v7.2 — 配合 Reviewer risk_registered 维度）

| ID | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | generator schema 漂移：返 `{decremented:4}` 或 `{result:4, operation:"dec"}` 而非严字面 `{result, operation:"decrement"}` | LLM "语义化优化"成更直观字段名 | Step 3 § 30 项 jq -e 严断言 + DoD §"BEHAVIOR 禁用字段反向" + §"operation 变体反向反射" 双重抓 |
| R2 | generator 接受 PRD 禁用 query 名（`n`/`x`/`num` 等）→ 漂 `app.get('/decrement', (req)=>req.query.n)` | generator 自由发挥 query 名 | Step 2 §C + E2E §5 共 9 case 强制全 400；DoD 独立 BEHAVIOR loop |
| R3 | 精度上下界处理不严：用 `Number.parseInt` 没区分越界 vs 普通整数 | 误用宽松 parser | Step 2 §A + DoD "精度上下界拒" BEHAVIOR + E2E §4 |
| R4 | strict-schema regex 漂移：用 `\d+` 不带 `^...$` anchor → 误吃 `1.5`/`1e2` | regex 写得太松 | Step 2 §B + DoD "strict-schema 非法输入" BEHAVIOR + E2E §6 9 case |
| R5 | error body 不严：返 `{error:"...", message:"..."}` 或 `{error:{...}}` 嵌套 object | 习惯性多放上下文 | Step 4 § 8 项 jq -e + DoD "错误体严 schema" BEHAVIOR + E2E §8 |
| R6 | 8 路由回归撞坏：generator 改 `/decrement` 时误改了 shared middleware 影响 /sum/multiply/... | middleware 提取/挪动 | E2E §11 8 路由 happy 回归 + DoD "8 路由回归 happy" BEHAVIOR |

每条风险都已链到 Step / E2E / DoD 三处中至少 2 处验证。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 `GET /decrement` 路由 + 测试 describe 块 + README 段

**范围**:
- `playground/server.js` 新增 `app.get('/decrement', ...)` 路由：query 名严字面 `value`（PRD 禁用 9 个变体名）、strict-schema 整数 `^-?\d+$`、上下界 `|Number(value)| ≤ 9007199254740990`、返回 `{result: Number(value)-1, operation: "decrement"}`（operation 字面字符串，禁 8 变体）、错误体 `{error: "<非空 string>"}` (禁 4 替代名)、严 schema 完整性（顶层 keys 仅 `operation`/`result` 或仅 `error`）
- `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块：happy（0/1/-1/上界/下界）、上下界拒、strict 拒（小数/前导+/科学计数法/十六进制/空串/缺参/9 禁用 query 名）、schema 完整性 oracle、19 禁用字段反向、operation 8 变体反向、错误体 keys=[error] 断言、4 禁用错误名反向
- `playground/README.md` 端点列表加 `/decrement` 段（≥ 4 个示例）
- 7 路由（/health /sum /multiply /divide /power /modulo /increment /factorial）回归 happy 1 条/路由

**大小**: S (<100 行净增 / ≤ 3 文件)

**依赖**: 无

**Generator 内部 TDD 测试文件**: `tests/ws1/decrement.test.js`（**vitest 仅供 generator red→green TDD 使用，不是 evaluator oracle；evaluator 只跑 `contract-dod-ws1.md` 的 `manual:bash` 命令**）

---

## Test Contract

| Workstream | Test File (generator TDD) | Evaluator Oracle | 预期红证据 (commit-1) |
|---|---|---|---|
| WS1 | `tests/ws1/decrement.test.js`（24 test 块）| `contract-dod-ws1.md` 10 条 `[BEHAVIOR]` manual:bash 命令 | `/decrement` 未实现 → supertest 拿到 404 → 全部 assertion FAIL |

**关键澄清**: `tests/ws1/*.test.js` 是 generator 在 commit-1 push 的 TDD 红证据 + commit-2 push 的绿证据；`contract-dod-ws*.md` BEHAVIOR 段的 `manual:bash` 命令是 evaluator 的 verdict 源。两者不串。CI `dod-structure-purity` job 强校验：BEHAVIOR 段每条带 `Test: manual:bash` 内嵌命令而非"索引指向 vitest"措辞。
