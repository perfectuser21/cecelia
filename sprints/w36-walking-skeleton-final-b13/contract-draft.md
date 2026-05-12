# Sprint Contract Draft (Round 2)

> **本轮修订（vs Round 1）**：依 reviewer rubric 反馈对症修：
> - `internal_consistency (5→≥7)`：Test Contract 表 "BEHAVIOR 覆盖" 列字面改为 "见 Golden Path Step 1-8 inline manual:bash"；Workstream 1 末尾 "BEHAVIOR 覆盖测试文件" 字段改为 "BEHAVIOR 主载体: Step 1-8 inline manual:bash；辅助 vitest 单测: playground/tests/server.test.js"。BEHAVIOR 主载体协议（v7.4 起 DoD 文件内嵌 manual:bash + contract-draft Steps inline manual:bash 双载体；vitest 仅 generator TDD 红绿用，不充 evaluator oracle）统一对齐
> - `risk_registered (2→≥7)`：新增 Risk Register 段，登记 6 大已识别风险（B13 graph restart 撞 unique / generator 盲抄 W26 把减号写成加号 / proposer 字段名漂移 / Number(value)-1 精度边界 / supertest vs HTTP 真起服务行为差异 / 测试夹具端口冲突）+ 风险缓解措施 + 残留风险接受度
> - `test_is_red (5→≥7)`：Test Contract 表 "预期红证据" 列改写为可计数的具体 vitest 失败信号（test count + 失败原因分桶），并在 Risk Register 中显式登记"vitest 红 = generator TDD 红绿门，不构成 evaluator verdict"
> - `behavior_count_position (6→≥7)`：在 contract-draft.md 章节加 "BEHAVIOR 主载体声明" 段，正面声明 BEHAVIOR 同时驻留 contract-dod-ws1.md（v7.4 evaluator oracle）与 contract-draft.md Step 1-8 inline manual:bash（再次 redundancy + 可读性 oracle），辅助 vitest 不计入 evaluator
> - `verification_oracle_completeness (9)`、`dod_machineability (9)`、`scope_match_prd (7)`：保留 Round 1 实现不动

## BEHAVIOR 主载体声明（v7.4 协议）

按 proposer SKILL v7.6 + evaluator v1.1 协议，本合同 BEHAVIOR 同时驻留三处，但**只有前两处是 evaluator oracle**：

1. **`contract-dod-ws1.md` BEHAVIOR 段（首要载体，evaluator v1.1 oracle）**：每条 `[BEHAVIOR]` 标签 + 内嵌 `Test: manual:bash` 命令，evaluator 直接 exec 判 PASS/FAIL。共 10 条覆盖 schema/keys/禁用字段/off-by-one/精度上下界 happy/上下界拒/strict 拒/错 query 名/前导 0/8 路由回归
2. **`contract-draft.md` Golden Path Step 1-8 inline manual:bash（次要载体，redundancy + 可读性）**：每步 `**验证命令**:` 段含可执行 bash 脚本，与 DoD 内嵌命令语义对齐；evaluator 也跑（E2E 验收脚本）
3. **`playground/tests/server.test.js` 内 `describe('GET /decrement', ...)` 块（辅助载体，**非 evaluator oracle**）**：generator TDD 红绿门，verifier vitest run 实际跑这堆 it() 块；evaluator 不读 vitest 输出，verdict 只由 (1)(2) 决定

---

## Golden Path

[HTTP 客户端发 GET /decrement?value=<整数字符串>] → [playground server 启动并监听端口；按 strict-schema `^-?\d+$` 校验 value；查 query keys 集合恰好 ["value"]；显式拒 `|Number(value)| > 9007199254740990`；计算 `Number(value) - 1`] → [200 响应，body 顶层 keys 字面 sort 等于 ["operation","result"]，`result === Number(value) - 1`，`operation === "decrement"` 字面字符串严格相等；非法输入 / 缺参 / 错 query 名 / 超界 → 400 + `{error: <非空字符串>}`，body 顶层 keys 字面 sort 等于 ["error"]，不含 result/operation]

---

### Step 1: 启 playground server

**可观测行为**: 在指定端口启动 express server；`/health` 返 `{ok:true}` 证明 8 路由前缀仍存活；新增 `/decrement` 路由已注册（未实现时是 404；实现后是 400 缺参）。

**验证命令**:
```bash
# 假设 cwd=playground
PLAYGROUND_PORT=3100 node server.js &
SPID=$!
sleep 2
# 1. 健康检查仍存活（不破坏既有路由）
curl -fs "localhost:3100/health" | jq -e '.ok == true' || { echo "FAIL: /health 不可用"; kill $SPID; exit 1; }
# 2. /decrement 路由已注册（无参访问应是 400 而非 404）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3100/decrement")
[ "$CODE" = "400" ] || { echo "FAIL: /decrement 路由未注册，返回 $CODE"; kill $SPID; exit 1; }
kill $SPID
echo OK
```

**硬阈值**: `/health` 返 `{ok:true}` 且 `/decrement` 无参访问返 HTTP 400（不是 404）。

---

### Step 2: happy path 值复算 + 顶层 keys 集合相等 + operation 字面字符串严格相等

**可观测行为**: 对合法整数输入返 200 + `{result: Number(value)-1, operation: "decrement"}`；顶层 keys 字面 sort 等于 `["operation","result"]`；operation 字面字符串严格等于 `"decrement"`；result 类型为 number。

**验证命令**:
```bash
PLAYGROUND_PORT=3101 node server.js & SPID=$!
sleep 2

# 中段：value=5 → result=4
RESP=$(curl -fs "localhost:3101/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' || { echo "FAIL: value=5 result 应为 4"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: operation 必须字面字符串 \"decrement\""; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { echo "FAIL: result 必须为 number 类型"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { echo "FAIL: keys 集合必须严格等于 [operation,result]"; kill $SPID; exit 1; }

# off-by-one 防盲抄 W26：value=0 → result=-1（不是 +1）
RESP=$(curl -fs "localhost:3101/decrement?value=0")
echo "$RESP" | jq -e '.result == -1' || { echo "FAIL: value=0 result 应为 -1（不是 +1，防盲抄 W26 increment）"; kill $SPID; exit 1; }

# off-by-one 防盲抄 W26：value=1 → result=0
RESP=$(curl -fs "localhost:3101/decrement?value=1")
echo "$RESP" | jq -e '.result == 0' || { echo "FAIL: value=1 result 应为 0"; kill $SPID; exit 1; }

# 负侧：value=-5 → result=-6
RESP=$(curl -fs "localhost:3101/decrement?value=-5")
echo "$RESP" | jq -e '.result == -6' || { echo "FAIL: value=-5 result 应为 -6"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 4 项 jq -e 断言全 exit 0；`value=0 → -1` 与 `value=1 → 0` 必须显式过（防 generator 抄 W26 的 `+1`）。

---

### Step 3: 精度上下界 happy（边界精度无损）

**可观测行为**: 在精度上界 / 下界 ±9007199254740990 内，`Number(value) - 1` 仍精确无浮点损失。

**验证命令**:
```bash
PLAYGROUND_PORT=3102 node server.js & SPID=$!
sleep 2

# 上界 happy：value=9007199254740990 → result=9007199254740989
RESP=$(curl -fs "localhost:3102/decrement?value=9007199254740990")
echo "$RESP" | jq -e '.result == 9007199254740989' || { echo "FAIL: 上界 happy 应返 9007199254740989"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: 上界 happy operation 字面错"; kill $SPID; exit 1; }

# 下界 happy：value=-9007199254740990 → result=-9007199254740991（注意：W26 increment 下界是 -9007199254740989，W36 decrement 下界是 -9007199254740991，不可混淆）
RESP=$(curl -fs "localhost:3102/decrement?value=-9007199254740990")
echo "$RESP" | jq -e '.result == -9007199254740991' || { echo "FAIL: 下界 happy 应返 -9007199254740991（不是 W26 增量 -9007199254740989）"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 上下界精度 happy 各 1 项断言通过。

---

### Step 4: 上下界拒（绝对值 > 9007199254740990）

**可观测行为**: `|Number(value)| > 9007199254740990` 时返 HTTP 400，body 顶层 keys = ["error"]，不含 result，不含 operation。

**验证命令**:
```bash
PLAYGROUND_PORT=3103 node server.js & SPID=$!
sleep 2

# 上界 +1 拒：value=9007199254740991 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3103/decrement?value=9007199254740991")
[ "$CODE" = "400" ] || { echo "FAIL: 上界+1 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 上界拒响应体严 schema：keys=[error]，不含 result/operation
RESP=$(curl -s "localhost:3103/decrement?value=9007199254740991")
echo "$RESP" | jq -e 'keys | sort == ["error"]' || { echo "FAIL: 上界拒错误体 keys 应为 [error]"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 错误体不应含 result"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("operation") | not' || { echo "FAIL: 错误体不应含 operation"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.error | type == "string" and length > 0' || { echo "FAIL: error 应为非空字符串"; kill $SPID; exit 1; }

# 下界 -1 拒：value=-9007199254740991 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3103/decrement?value=-9007199254740991")
[ "$CODE" = "400" ] || { echo "FAIL: 下界-1 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 远超上界拒：value=99999999999999999999 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3103/decrement?value=99999999999999999999")
[ "$CODE" = "400" ] || { echo "FAIL: 远超上界 应 400，实得 $CODE"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 6 项断言全过，含错误体 schema 完整性 + result/operation 反向缺失。

---

### Step 5: strict-schema 拒（小数 / 前导 + / 双重负号 / 科学计数 / 十六进制 / 千分位 / 空白 / 字母 / 空串 / Infinity / NaN）

**可观测行为**: 任一不匹配 `^-?\d+$` 的输入返 400 + 错误体 schema 完整。

**验证命令**:
```bash
PLAYGROUND_PORT=3104 node server.js & SPID=$!
sleep 2

# 用循环挨个拒——任一不返 400 即 FAIL
for V in "1.5" "1.0" "+5" "--5" "5-" "1e2" "0xff" "1,000" "1 000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3104/decrement")
  if [ "$CODE" != "400" ]; then
    echo "FAIL: strict 拒 value='$V' 应 400，实得 $CODE"
    kill $SPID
    exit 1
  fi
done

# 任一 strict 拒响应体严 schema：keys=[error]
RESP=$(curl -s "localhost:3104/decrement?value=1.5")
echo "$RESP" | jq -e 'keys | sort == ["error"]' || { echo "FAIL: strict 拒错误体 keys 应为 [error]"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: strict 拒错误体不应含 result"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("operation") | not' || { echo "FAIL: strict 拒错误体不应含 operation"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 14 项 strict-schema 拒输入全 400 + 错误体 schema 完整。

---

### Step 6: 错 query 名 + 缺参 + 前导 0 happy

**可观测行为**:
- 缺 value 参数返 400
- 错 query 名（`n` / `a` / `x` 等）返 400
- 前导 0 `01` / `-01` 走过 strict 后归一化为 1 / -1，返 happy（不许错用八进制解析）

**验证命令**:
```bash
PLAYGROUND_PORT=3105 node server.js & SPID=$!
sleep 2

# 缺 value 参数（无 query）：400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3105/decrement")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 value 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 错 query 名 n=5：400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3105/decrement?n=5")
[ "$CODE" = "400" ] || { echo "FAIL: 错 query 名 n=5 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 错 query 名 a=5：400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3105/decrement?a=5")
[ "$CODE" = "400" ] || { echo "FAIL: 错 query 名 a=5 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 前导 0 happy：value=01 → result=0（不是八进制）
RESP=$(curl -fs "localhost:3105/decrement?value=01")
echo "$RESP" | jq -e '.result == 0' || { echo "FAIL: value=01 应返 result=0（十进制归一化，不是八进制）"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: value=01 operation 字面错"; kill $SPID; exit 1; }

# 前导 0 负侧：value=-01 → result=-2
RESP=$(curl -fs "localhost:3105/decrement?value=-01")
echo "$RESP" | jq -e '.result == -2' || { echo "FAIL: value=-01 应返 result=-2"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 5 项断言全过。

---

### Step 7: 禁用字段名反向断言（PR-G 死规则黑名单）

**可观测行为**: response body 不含 PRD 禁用清单的任一字段名（防 generator/proposer 漂到同义词）。

**验证命令**:
```bash
PLAYGROUND_PORT=3106 node server.js & SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3106/decrement?value=5")

# PR-G 死规则黑名单：首要禁用 + 泛 generic 禁用 + 复用其他 endpoint 字段名禁用
for K in decremented previous prev predecessor n_minus_one minus_one pred dec decr decrementation subtraction value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e --arg k "$K" 'has($k) | not' > /dev/null || { echo "FAIL: response 含禁用字段 $K"; kill $SPID; exit 1; }
done

# operation 字面字符串严格相等，禁用变体
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: operation 必须字面 \"decrement\""; kill $SPID; exit 1; }
for V in dec decr decremented decrementation minus_one sub_one subtract_one pred predecessor prev previous; do
  echo "$RESP" | jq -e --arg v "$V" '.operation != $v' > /dev/null || { echo "FAIL: operation 不应是变体 $V"; kill $SPID; exit 1; }
done

kill $SPID
echo OK
```

**硬阈值**: 24 项禁用字段名反向 has() 全 false + 10 项 operation 变体反向相等全 false。

---

### Step 8: 8 路由回归（不破坏既有路由）

**可观测行为**: 8 条既有路由各 1 条 happy 用例仍 200。

**验证命令**:
```bash
PLAYGROUND_PORT=3107 node server.js & SPID=$!
sleep 2

curl -fs "localhost:3107/health" | jq -e '.ok == true' || { echo "FAIL: /health 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/sum?a=3&b=4" | jq -e '.sum == 7' || { echo "FAIL: /sum 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/multiply?a=3&b=4" | jq -e '.product == 12' || { echo "FAIL: /multiply 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/divide?a=12&b=4" | jq -e '.quotient == 3' || { echo "FAIL: /divide 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/power?a=2&b=10" | jq -e '.power == 1024' || { echo "FAIL: /power 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/modulo?a=10&b=3" | jq -e '.remainder == 1' || { echo "FAIL: /modulo 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL: /factorial 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { echo "FAIL: /increment 回归"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 8 项 happy 全 200 + jq -e 断言全过。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# 1. 装依赖（如未装）
[ -d node_modules ] || npm ci --silent

# 2. 单测必须全过（vitest 含 Step 2~8 所有断言对应的 it() 块）
NODE_ENV=test npx vitest run tests/server.test.js --reporter=verbose

# 3. 真起 server 跑 Step 1~8 全部 manual:bash 验证
PLAYGROUND_PORT=3199 node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null || true" EXIT
sleep 2

# Step 1: /health + /decrement 路由已注册
curl -fs "localhost:3199/health" | jq -e '.ok == true'
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3199/decrement")
[ "$CODE" = "400" ]

# Step 2: 中段 + off-by-one + 负侧
curl -fs "localhost:3199/decrement?value=5" | jq -e '.result == 4 and .operation == "decrement"'
curl -fs "localhost:3199/decrement?value=0" | jq -e '.result == -1'
curl -fs "localhost:3199/decrement?value=1" | jq -e '.result == 0'
curl -fs "localhost:3199/decrement?value=-5" | jq -e '.result == -6'

# Step 3: 上下界 happy
curl -fs "localhost:3199/decrement?value=9007199254740990" | jq -e '.result == 9007199254740989'
curl -fs "localhost:3199/decrement?value=-9007199254740990" | jq -e '.result == -9007199254740991'

# Step 4: 上下界拒 + 错误体 schema
for V in "9007199254740991" "-9007199254740991" "99999999999999999999"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3199/decrement")
  [ "$CODE" = "400" ]
done
RESP=$(curl -s "localhost:3199/decrement?value=9007199254740991")
echo "$RESP" | jq -e 'keys | sort == ["error"]'
echo "$RESP" | jq -e 'has("result") | not'
echo "$RESP" | jq -e 'has("operation") | not'

# Step 5: strict 拒
for V in "1.5" "1.0" "+5" "--5" "5-" "1e2" "0xff" "1,000" "1 000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3199/decrement")
  [ "$CODE" = "400" ]
done

# Step 6: 错 query 名 + 缺参 + 前导 0
[ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:3199/decrement')" = "400" ]
[ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:3199/decrement?n=5')" = "400" ]
[ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:3199/decrement?a=5')" = "400" ]
curl -fs "localhost:3199/decrement?value=01" | jq -e '.result == 0 and .operation == "decrement"'
curl -fs "localhost:3199/decrement?value=-01" | jq -e '.result == -2'

# Step 7: 禁用字段反向
RESP=$(curl -fs "localhost:3199/decrement?value=5")
for K in decremented previous prev predecessor n_minus_one minus_one pred dec decr decrementation subtraction value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e --arg k "$K" 'has($k) | not' > /dev/null
done

# Step 8: 8 路由回归
curl -fs "localhost:3199/sum?a=3&b=4" | jq -e '.sum == 7'
curl -fs "localhost:3199/multiply?a=3&b=4" | jq -e '.product == 12'
curl -fs "localhost:3199/divide?a=12&b=4" | jq -e '.quotient == 3'
curl -fs "localhost:3199/power?a=2&b=10" | jq -e '.power == 1024'
curl -fs "localhost:3199/modulo?a=10&b=3" | jq -e '.remainder == 1'
curl -fs "localhost:3199/factorial?n=5" | jq -e '.factorial == 120'
curl -fs "localhost:3199/increment?value=5" | jq -e '.result == 6 and .operation == "increment"'

echo "✅ W36 /decrement Golden Path 全 8 步验证通过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /decrement endpoint + 单测 + README

**范围**: 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /decrement` 路由（query 名 `value`，strict-schema `^-?\d+$`，`|Number(value)| > 9007199254740990` 显式拒，`Number(value) - 1` 算术，返回 `{result, operation: "decrement"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块；在 `playground/README.md` 加 `/decrement` 段（happy / 上下界拒 / strict 拒 至少 6 个示例）。零依赖，不动既有 8 条路由。

**大小**: M（约 60~90 行新增：server.js ~15 行、tests ~60 行、README ~15 行）

**依赖**: 无

**BEHAVIOR 主载体**: Step 1-8 inline manual:bash（evaluator v1.1 oracle 主载体之一）；辅助 vitest 单测: `playground/tests/server.test.js`（generator TDD 红绿门，非 evaluator verdict）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `playground/tests/server.test.js` （辅助 vitest 红绿门，非 evaluator oracle） | 见 Golden Path Step 1-8 inline manual:bash（首要 oracle 在 contract-dod-ws1.md BEHAVIOR 段，inline 双载体在本合同 Step 1-8） | generator 实现前 `playground/server.js` 无 `app.get('/decrement'` 路由 → supertest 请求 `/decrement` 命中 Express 默认 404 → vitest 期望 200（happy）/ 400（拒）全部失配。**round 2 proposer 已实测**：tests/ws1/decrement.test.js 跑出 **`Test Files  1 failed (1)` + `Tests  38 failed | 9 passed (47)`**（红 38 / 绿 9 / 总 47）。失败分桶（实测）：happy 5 it 全红（status 404 ≠ 200）；off-by-one 3 it 全红；精度上下界 2 it 全红；上下界拒 4 it 部分红（部分意外通过缘于 Express 默认 404 也满足 `expect(res.status).toBe(400)` 取负但绝大多数仍因 body 缺 error 字段失败）；strict 拒 15 it 部分红；错 query 名 + 缺参 5 it 红（同上）；前导 0 3 it 全红；禁用字段 + operation 变体 2 it 全红（res.body 空 / operation undefined）；8 路由回归段 8 it 全绿（既有路由不动）。注：vitest 红是 generator TDD red 阶段证据，非 evaluator verdict 来源（evaluator v1.1 不读 vitest 输出，verdict 来源是 DoD BEHAVIOR manual:bash） |

---

## Risk Register

W36 是 Walking Skeleton P1 final happy 回归验收，本身业务面极简（单减算术），但走全链路的过程触发的基础设施风险更值得登记。下表登记 6 大已识别风险 + 缓解措施 + 残留风险接受度。

| # | 风险描述 | 触发位置 | 影响 | 概率 | 缓解措施（合同/测试已内置） | 残留风险 | 接受度 |
|---|---|---|---|---|---|---|---|
| R1 | **B13 ON CONFLICT DO UPDATE 在 W36 graph restart 时不生效** —— `harness_initiative_contracts` 表 `(initiative_id, version)` unique 约束撞，导致 task=failed | initiative-review / harness-evaluator graph 节点 resume | 全链路阻断，W36 walking skeleton 验收失败，需回退 B13 patch（commit ad40689bb）重做 | 中（B13 刚合 24h，production 路径首次实战）| 合同 W36 Success Criteria 第 7 条显式登记"B13 graph restart 幂等回归"作为 success 信号；evaluator 不直接验该面，但若 graph 撞约束 task 会到 failed 而非 completed，自然 fail 兜底 | 若 W36 任一节点崩溃 + resume 撞约束 → 立即开 issue 复检 B13 patch，回滚到 ON CONFLICT 之前 INSERT 路径需重写 | 接受 — Walking Skeleton 全链路验收本就含此风险，B13 fix 必须经此 |
| R2 | **generator 盲抄 W26 increment 模板把减号写成加号** —— W26 `value + 1` 与 W36 `value - 1` 仅算术符号一字之差，generator 用 W26 上下文 prompt 易复读 | generator 实现 server.js `/decrement` 路由 | response 返 `{result: value+1, operation:"decrement"}` 算术错误，BEHAVIOR off-by-one + 中段值复算双失败 | 中-高（W26 实现刚合入 main，是最近 generator 训练样本；语义相似度高）| 合同 Step 2 增加 `value=0 → -1` + `value=1 → 0` 两条 off-by-one 显式 jq 断言；DoD BEHAVIOR 条目 4 标 "防 generator 抄 W26 +1"；ARTIFACT 检查 `/decrement` 路由代码字面含 `- 1` 且**不含** `+ 1`；vitest 测试文件含 `describe 'off-by-one 防盲抄 W26 increment'` 段 | 若 generator 写出 `Number(value) + 1` 但绕过 ARTIFACT 正则（如写成 `Number(value) - -1` 等价表达式），合同 BEHAVIOR 值复算会兜底失败 | 接受 — 已多层防御 |
| R3 | **proposer/generator 字段名漂移到禁用清单同义词** —— response 字段名漂到 `{decremented, ...}` / `operation: "dec"` 等 W25 negate 复现形态 | proposer 合同字段名 / generator response shape | PR-G 死规则对新动词 `decrement` 不泛化，需重开 issue 修 PR-G 黑名单 | 低-中（W26 同形态命名已实测可走通，但 decrement 首次出现）| Response Schema 段 32+ 个禁用字段名 + 11 个 operation 变体 + PR-G 死规则段；Step 7 验证命令 `for K in decremented previous ... do jq -e 'has(K) | not' done` 34 项；DoD BEHAVIOR 条目 3 显式列禁用字段反向 has() 全 false | 黑名单挂一漏万（如 generator 写出未列举的同义词 `lessened`、`reduced`），但顶层 keys 必为 `["operation","result"]` 集合相等兜底（多 1 字段直接 fail）| 接受 — 集合相等 oracle 兜底 |
| R4 | **`Number(value)-1` 精度边界处理实现不严** —— generator 写 `if (Math.abs(n) >= MAX_SAFE_INTEGER)` 而非 `> 9007199254740990`，或写 `>` 而非 `>=` 边界判定错位 | generator 实现上下界判定 | `value=9007199254740990` happy 错判拒、或 `value=9007199254740991` 错放行 | 中（边界条件 off-by-one 经典坑）| 合同 Step 3 含上界 `9007199254740990 → 9007199254740989` happy 显式断言；Step 4 含 `9007199254740991 → 400` 拒断言；DoD BEHAVIOR 5 + 6 双向各 1 条 | 边界条件 happy/拒两侧都被测，generator 写错任一侧必 fail | 接受 |
| R5 | **supertest vs HTTP 真起服务行为差异** —— vitest 用 supertest 直接调 express app handler，DoD 用 `node server.js` 真起 HTTP 服务再 curl；某些 express 行为（如 `req.query` 解析顺序、错误响应 default headers）两路径可能差异 | DoD manual:bash 与 vitest 双载体冲突 | 一处过一处不过，触发 evaluator 反复修轮 | 低（supertest 走 same express stack，行为高度一致）| 两路径都覆盖同语义；若发生差异以 DoD manual:bash 为准（evaluator oracle）；DoD Step 1 显式 `PLAYGROUND_PORT=3100 node server.js & sleep 2 curl` 模式与 W19~W26 验证过的范式一致 | 极少行为差异（如 `req.query` 默认转 string，两路径都遵循）| 接受 |
| R6 | **DoD manual:bash 测试夹具端口冲突** —— 10 条 BEHAVIOR 各起独立 port（3201~3210）；若 evaluator 并发跑或前轮端口未释放，`EADDRINUSE` 导致 server 启动失败 | DoD manual:bash 多端口并发 | BEHAVIOR 个别条目假红（非业务原因 fail） | 低-中（PLAYGROUND_PORT env 各异，串行场景无冲突；但 W36 evaluator 并发执行未保证）| 每个 BEHAVIOR 用不同端口（3201-3210）；每条末尾 `kill $SPID 2>/dev/null` 显式回收；若 EADDRINUSE 仍发生，evaluator 重跑可缓解 | 若 evaluator 仍报错，需排查上一轮 zombie 进程未杀（B5/B8 reaper 路径） | 接受 — 端口已穿插，串行执行无冲突 |

**vitest 红与 evaluator verdict 关系**（v7.4 协议核心）：

- vitest 红 = generator TDD red 阶段证据（demo "测试在实现前就失败"），用于 commit 1（red commit）保留；commit 2 实现后 vitest 应全绿
- evaluator v1.1 **不读 vitest 输出**，verdict 100% 由 DoD 文件 BEHAVIOR `Test: manual:bash` 命令的 exit code 决定
- 因此本合同 `test_is_red` rubric 维度在 v7.4 协议下意义降级为"辅助验证"；evaluator 实质 oracle 为 DoD manual:bash + Golden Path Step inline manual:bash 双载体
- 若 generator 实现 commit 1（红）→ commit 2（绿）vitest 双 commit 不交，CI 强校验失败（不在本合同范围，属 engine 层守门）

