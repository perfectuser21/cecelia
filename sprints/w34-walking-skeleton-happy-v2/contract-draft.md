# Sprint Contract Draft (Round 1)

**Sprint**: W34 Walking Skeleton P1 happy path 验
**Initiative**: harness pipeline 在 happy path + uncapped fix loop 下走完整链 task=completed
**Journey type**: autonomous（playground 子项目；无 UI / 无 brain tick / 无远端 agent 协议）

---

## Golden Path

[客户端发 GET /uppercase?text=<ASCII 字母串>]
  → [playground server 校验 query 数量/名严格为 text，strict-schema `^[A-Za-z]+$` 校验输入，调 `text.toUpperCase()` 算术]
  → [HTTP 200，body 顶层 keys 字面集合 = `["operation", "result"]`，`result === text.toUpperCase()` 且 `operation === "uppercase"`]
  ↳ 非法输入分支：[strict 不过 / 缺 text / 错 query 名 / 多 query 名]
    → [HTTP 400，body 顶层 keys 字面集合 = `["error"]`，`error` 是非空 string，body 不含 `result` 也不含 `operation`]
  ↳ 已有 8 路由（/health /sum /multiply /divide /power /modulo /factorial /increment）回归路径不破坏

---

### Step 1: 客户端发 `GET /uppercase?text=hello`（happy 全小写）

**可观测行为**: HTTP 200；JSON body 严格 `{"result":"HELLO","operation":"uppercase"}`；顶层 keys 字面集合 = `["operation","result"]`；`operation` 是字面字符串 `"uppercase"`（不许变体 `upper` / `uppercased` / `transformed` 等）

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3101 node server.js &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3101/uppercase?text=hello")
echo "$RESP" | jq -e '.result == "HELLO"' \
  && echo "$RESP" | jq -e '.operation == "uppercase"' \
  && echo "$RESP" | jq -e '.result | type == "string"' \
  && echo "$RESP" | jq -e '(keys | sort) == ["operation","result"]'
RC=$?

kill $SPID 2>/dev/null
[ $RC -eq 0 ]
```

**硬阈值**: 4 条 jq -e 全过 + curl 返 200（-f 强制）

---

### Step 2: 客户端发 `GET /uppercase?text=Z`（单字符 happy 大写）+ `text=a`（单字符 happy 小写）+ `text=AbCdEf`（混合大小写 happy）+ `text=HELLO`（已大写幂等 happy）

**可观测行为**: 全部 200；`result` 分别 = `"Z"` / `"A"` / `"ABCDEF"` / `"HELLO"`；`operation === "uppercase"`；顶层 keys = `["operation","result"]`

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 node server.js &
SPID=$!
sleep 2

PASS=1
for pair in "Z:Z" "a:A" "AbCdEf:ABCDEF" "HELLO:HELLO"; do
  INPUT="${pair%%:*}"
  EXPECTED="${pair##*:}"
  RESP=$(curl -fs "http://localhost:3102/uppercase?text=${INPUT}")
  echo "$RESP" | jq -e ".result == \"${EXPECTED}\"" > /dev/null || PASS=0
  echo "$RESP" | jq -e '.operation == "uppercase"' > /dev/null || PASS=0
  echo "$RESP" | jq -e '(keys | sort) == ["operation","result"]' > /dev/null || PASS=0
done

kill $SPID 2>/dev/null
[ $PASS -eq 1 ]
```

**硬阈值**: 4 个输入 × 3 条断言 = 12 条全过

---

### Step 3: strict-schema 非法输入 → 400 + 错误体严 schema

**可观测行为**: 输入含数字/空格/标点/下划线/短横线/Unicode 字母/CJK/空串 → HTTP 400；body 顶层 keys 字面集合 = `["error"]`；`error` 是非空 string；body 不含 `result` 也不含 `operation`

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 node server.js &
SPID=$!
sleep 2

PASS=1
# 用 URL-encode 表达非法字符；含空串 (text=) + 含数字 + 含空格 + 含短横线 + 含下划线 + 含标点 + Unicode 字母 + CJK
BAD_INPUTS=("" "hello123" "hello%20world" "hello-world" "hello_world" "hello%21" "caf%C3%A9" "%E4%B8%AD%E6%96%87" "123")
for INPUT in "${BAD_INPUTS[@]}"; do
  CODE=$(curl -s -o /tmp/w34_step3_body -w "%{http_code}" "http://localhost:3103/uppercase?text=${INPUT}")
  [ "$CODE" = "400" ] || { echo "FAIL input=${INPUT} code=${CODE}"; PASS=0; continue; }
  jq -e '.error | type == "string" and length > 0' < /tmp/w34_step3_body > /dev/null || { echo "FAIL error not non-empty string for input=${INPUT}"; PASS=0; }
  jq -e '(keys | sort) == ["error"]' < /tmp/w34_step3_body > /dev/null || { echo "FAIL error body has extra keys for input=${INPUT}"; PASS=0; }
  jq -e 'has("result") | not' < /tmp/w34_step3_body > /dev/null || { echo "FAIL error body has result for input=${INPUT}"; PASS=0; }
  jq -e 'has("operation") | not' < /tmp/w34_step3_body > /dev/null || { echo "FAIL error body has operation for input=${INPUT}"; PASS=0; }
done

kill $SPID 2>/dev/null
[ $PASS -eq 1 ]
```

**硬阈值**: 9 个非法输入 × 4 条断言（status=400 + error 非空 + keys=[error] + 无 result/operation）全过

---

### Step 4: 缺参 / 错 query 名 / 多 query 名 → 400

**可观测行为**: 无 query / `?value=hello` / `?input=hello` / `?text=hello&text=world` → HTTP 400；body 顶层 keys = `["error"]`；body 不含 `result` 也不含 `operation`

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 node server.js &
SPID=$!
sleep 2

PASS=1
# 缺参 / 错 query 名 / 多 text query
URLS=("http://localhost:3104/uppercase" "http://localhost:3104/uppercase?value=hello" "http://localhost:3104/uppercase?input=hello" "http://localhost:3104/uppercase?text=hello&text=world")
for URL in "${URLS[@]}"; do
  CODE=$(curl -s -o /tmp/w34_step4_body -w "%{http_code}" "${URL}")
  [ "$CODE" = "400" ] || { echo "FAIL ${URL} code=${CODE}"; PASS=0; continue; }
  jq -e '.error | type == "string" and length > 0' < /tmp/w34_step4_body > /dev/null || PASS=0
  jq -e 'has("result") | not' < /tmp/w34_step4_body > /dev/null || PASS=0
  jq -e 'has("operation") | not' < /tmp/w34_step4_body > /dev/null || PASS=0
done

kill $SPID 2>/dev/null
[ $PASS -eq 1 ]
```

**硬阈值**: 4 个错误 URL × 4 条断言全过

---

### Step 5: 禁用响应字段名反向不存在

**可观测行为**: happy 响应不含任何禁用字段名（语义同义如 `uppercased` `upper` `transformed` `mapped`，泛 generic 如 `value` `input` `data` `payload`，跨 endpoint 复用如 `sum` `product` `quotient` `power` `remainder` `factorial` `negation`）

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3105 node server.js &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3105/uppercase?text=hello")
PASS=1
for BAD in uppercased upper upper_text upper_case to_upper toUpperCase upper_text transformed transformed_text mapped output value input text data payload response answer out meta original sum product quotient power remainder factorial negation message msg reason detail details description info code uppercaseResult; do
  if echo "$RESP" | jq -e "has(\"${BAD}\")" > /dev/null 2>&1; then
    echo "FAIL: 禁用字段 ${BAD} 出现在响应"
    PASS=0
  fi
done

kill $SPID 2>/dev/null
[ $PASS -eq 1 ]
```

**硬阈值**: 31 个禁用字段名全反向不存在

---

### Step 6: 已有 8 路由（/health /sum /multiply /divide /power /modulo /factorial /increment）回归不破坏

**可观测行为**: 已有路由 happy 用例仍然 200 + 正确响应；vitest 全套 (`npm run test --prefix playground`) 全绿

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3106 node server.js &
SPID=$!
sleep 2

PASS=1
# /health
curl -fs "http://localhost:3106/health" | jq -e '.ok == true' > /dev/null || PASS=0
# /sum
curl -fs "http://localhost:3106/sum?a=2&b=3" | jq -e '.sum == 5' > /dev/null || PASS=0
# /multiply
curl -fs "http://localhost:3106/multiply?a=7&b=5" | jq -e '.product == 35' > /dev/null || PASS=0
# /divide
curl -fs "http://localhost:3106/divide?a=10&b=2" | jq -e '.quotient == 5' > /dev/null || PASS=0
# /power
curl -fs "http://localhost:3106/power?a=2&b=10" > /tmp/w34_pow.json || PASS=0
[ -s /tmp/w34_pow.json ] || PASS=0
# /modulo
curl -fs "http://localhost:3106/modulo?a=10&b=3" > /tmp/w34_mod.json || PASS=0
[ -s /tmp/w34_mod.json ] || PASS=0
# /factorial
curl -fs "http://localhost:3106/factorial?n=5" | jq -e '.factorial == 120' > /dev/null || PASS=0
# /increment
curl -fs "http://localhost:3106/increment?value=10" | jq -e '.result == 11 and .operation == "increment"' > /dev/null || PASS=0

kill $SPID 2>/dev/null

# vitest 全套
cd .. && npm --prefix playground test 2>&1 | tee /tmp/w34_step6_vitest.log
grep -E "Test Files.*passed|✓" /tmp/w34_step6_vitest.log > /dev/null || PASS=0
! grep -E "failed|FAIL" /tmp/w34_step6_vitest.log > /dev/null || PASS=0

[ $PASS -eq 1 ]
```

**硬阈值**: 8 路由 happy 全过 + vitest 全套绿

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
set -e

# ── 准备 ──────────────────────────────────────────
cd "$(git rev-parse --show-toplevel)"
[ -d playground/node_modules ] || npm --prefix playground install --silent

# ── Stage A: vitest 全套（含 /uppercase 新 describe + 8 路由回归）──
echo "▶ Stage A: vitest 全套"
npm --prefix playground test 2>&1 | tee /tmp/w34_e2e_vitest.log
grep -E "Test Files.*passed" /tmp/w34_e2e_vitest.log > /dev/null || { echo "FAIL vitest"; exit 1; }
! grep -E "Test Files.*failed|Tests.*failed" /tmp/w34_e2e_vitest.log > /dev/null || { echo "FAIL vitest 含失败"; exit 1; }

# ── Stage B: 起 server，跑 6 步真 HTTP oracle ───────
echo "▶ Stage B: 真起 server 跑 HTTP oracle"
cd playground && PLAYGROUND_PORT=3200 node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null || true" EXIT
sleep 2

# B1. happy 全小写
RESP=$(curl -fs "http://localhost:3200/uppercase?text=hello")
echo "$RESP" | jq -e '.result == "HELLO"' || { echo "FAIL B1 result"; exit 1; }
echo "$RESP" | jq -e '.operation == "uppercase"' || { echo "FAIL B1 operation"; exit 1; }
echo "$RESP" | jq -e '(keys | sort) == ["operation","result"]' || { echo "FAIL B1 keys"; exit 1; }

# B2. happy 多形态
for pair in "Z:Z" "a:A" "AbCdEf:ABCDEF" "HELLO:HELLO"; do
  IN="${pair%%:*}"; EX="${pair##*:}"
  R=$(curl -fs "http://localhost:3200/uppercase?text=${IN}")
  echo "$R" | jq -e ".result == \"${EX}\" and .operation == \"uppercase\"" || { echo "FAIL B2 ${IN}"; exit 1; }
  echo "$R" | jq -e '(keys | sort) == ["operation","result"]' || { echo "FAIL B2 keys ${IN}"; exit 1; }
done

# B3. strict 拒（9 类非法）
for IN in "" "hello123" "hello%20world" "hello-world" "hello_world" "hello%21" "caf%C3%A9" "%E4%B8%AD%E6%96%87" "123"; do
  CODE=$(curl -s -o /tmp/w34_eb -w "%{http_code}" "http://localhost:3200/uppercase?text=${IN}")
  [ "$CODE" = "400" ] || { echo "FAIL B3 input=${IN} got=${CODE}"; exit 1; }
  jq -e '.error | type == "string" and length > 0' < /tmp/w34_eb || { echo "FAIL B3 error string for ${IN}"; exit 1; }
  jq -e '(keys | sort) == ["error"]' < /tmp/w34_eb || { echo "FAIL B3 err keys ${IN}"; exit 1; }
  jq -e 'has("result") | not' < /tmp/w34_eb || { echo "FAIL B3 has result ${IN}"; exit 1; }
  jq -e 'has("operation") | not' < /tmp/w34_eb || { echo "FAIL B3 has operation ${IN}"; exit 1; }
done

# B4. 缺参 / 错 query / 多 text
for URL in "http://localhost:3200/uppercase" "http://localhost:3200/uppercase?value=hello" "http://localhost:3200/uppercase?input=hello" "http://localhost:3200/uppercase?text=hello&text=world"; do
  CODE=$(curl -s -o /tmp/w34_eb -w "%{http_code}" "${URL}")
  [ "$CODE" = "400" ] || { echo "FAIL B4 ${URL} got=${CODE}"; exit 1; }
  jq -e '(keys | sort) == ["error"]' < /tmp/w34_eb || { echo "FAIL B4 err keys ${URL}"; exit 1; }
  jq -e 'has("result") | not' < /tmp/w34_eb || { echo "FAIL B4 has result ${URL}"; exit 1; }
  jq -e 'has("operation") | not' < /tmp/w34_eb || { echo "FAIL B4 has operation ${URL}"; exit 1; }
done

# B5. 禁用字段反向不存在
HAPPY=$(curl -fs "http://localhost:3200/uppercase?text=hello")
for BAD in uppercased upper upper_text upper_case to_upper toUpperCase transformed transformed_text mapped output value input text data payload response answer out meta original sum product quotient power remainder factorial negation message msg reason detail details description info code; do
  ! echo "$HAPPY" | jq -e "has(\"${BAD}\")" || { echo "FAIL B5 禁用字段 ${BAD}"; exit 1; }
done

# B6. 8 路由回归
curl -fs "http://localhost:3200/health" | jq -e '.ok == true' || { echo "FAIL B6 /health"; exit 1; }
curl -fs "http://localhost:3200/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL B6 /sum"; exit 1; }
curl -fs "http://localhost:3200/multiply?a=7&b=5" | jq -e '.product == 35' || { echo "FAIL B6 /multiply"; exit 1; }
curl -fs "http://localhost:3200/divide?a=10&b=2" | jq -e '.quotient == 5' || { echo "FAIL B6 /divide"; exit 1; }
curl -fs "http://localhost:3200/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL B6 /factorial"; exit 1; }
curl -fs "http://localhost:3200/increment?value=10" | jq -e '.result == 11 and .operation == "increment"' || { echo "FAIL B6 /increment"; exit 1; }

# ── Stage C: README 含 /uppercase 段
grep -q "/uppercase" playground/README.md || { echo "FAIL README 无 /uppercase"; exit 1; }

echo "✅ W34 Golden Path E2E 全过"
```

**通过标准**: 脚本 exit 0；vitest 全套绿；6 步 HTTP oracle 全通；README 含 `/uppercase` 段

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /uppercase 路由 + 单测 describe 块 + README 段

**范围**: 在 `playground/server.js` 加 `GET /uppercase`（query 名严格 text，strict-schema `^[A-Za-z]+$`，`text.toUpperCase()` 算术，返回 `{result, operation: "uppercase"}`）+ 在 `playground/tests/server.test.js` 加 `describe('GET /uppercase', ...)` 块 + 在 `playground/README.md` 端点列表加 `/uppercase` 段。零依赖，不动既有八条路由。
**大小**: S（< 100 行：server ≈ 12 行、单测 ≈ 60–80 行、README ≈ 10 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/uppercase.test.ts`（vitest red 证据；evaluator 不依赖此文件，依赖 contract-dod-ws1.md 的 manual:bash 命令）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/uppercase.test.ts` | happy 5 形态 / strict 拒 9 形态 / 缺参 / 错 query / 多 query / schema 完整性 / 禁用字段反向 / 8 路由回归 | 当前 `playground/server.js` 无 `/uppercase` 路由 → Express 默认 404，所有 happy/400 期望失败；至少 20+ 条 vitest test 红 |
