# Sprint Contract Draft (Round 2)

## Round 2 修订摘要
- 上轮 Reviewer 反馈 `scope_match_prd` 维度 7/10：要求显式锁死"value 在场但带额外未知 query 名也必须 400"的边界（PRD `边界情况` 段已写"多余 query → 400"，r1 只覆盖"禁用名单内的 11 个名"，**未覆盖"已知 `value` + 任意未知 extra"组合**）。
- 本轮修订：(1) Step 1 验证命令新增 `value=5&extra=bar` 400 断言；(2) 合同新增 Step 1b "唯一 query 名 `value` — 任何额外 query 名（无论字面、不限于 11 禁用名单）一律 400"；(3) E2E 第 15 项新增"value=5&任意 extra → 400"；(4) contract-dod-ws1.md 新增 1 条 [BEHAVIOR]（共 11 条）；(5) vitest 新增对应 test 块；(6) task-plan dod 新增 1 条。
- 其他维度（dod_machineability 9 / test_is_red 9 / verification_oracle_completeness 9 / behavior_count_position 7）r1 已 ≥ 7，本轮保持不变。

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

### Step 1b: 唯一 query 名 `value` — value 在场 + 任意额外未知 query 名也必须 400（r2 新增）

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
kill $SPID
```

**硬阈值**: `result` 等于 `-Number(value)`；`value` 为 `0` 或 `-0` 时 JSON 字面输出 `"result":0`（不允许 `"result":-0`）。

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

# 11b. value 合法 + 额外 query 名（未知/已知/重复）一律 400（r2 新增 scope 锁死）
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

# 14. vitest 也要全绿（generator self-verify 红线）
npm test --silent 2>&1 | tail -20

echo "✅ Golden Path 15 项全过"
```

**通过标准**: 脚本 `exit 0` 且最后一行包含 `✅ Golden Path 15 项全过`。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /negate 路由 + 测试 + README

**范围**:
- `playground/server.js`：新增 `app.get('/negate', ...)`，复用 `/decrement` 的 strict-schema 模式（`^-?\d+$` + `|n| ≤ 9007199254740990` + 唯一 query 名 `value`）；`-0` 规范化为 `0`（用 `result = n === 0 ? 0 : -n`）。
- `playground/tests/server.test.js`：新增 `describe('GET /negate', ...)` 块，覆盖 happy / 精度上下界 / 禁用 query 名 / 禁用响应字段 / 禁用 operation 变体 / -0 规范化 / error keys 严等 / 反向 6 错误名。
- `playground/README.md`：补 `/negate` 段（描述、Query、Success/Error 例子）。

**大小**: S（预估 < 80 行净增，含 server 约 12 行 + 测试约 50 行 + README 约 15 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/negate.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w40-walking-skeleton-final-b18/tests/ws1/negate.test.ts` | 路由命中 / strict-schema / -0 规范化 / 严 schema 出口 / 22+8 禁用名 / error 严等 / 6 错误反向名 / **value+extra 400 (r2)** | `app.get('/negate')` 未实现 → 404/无 result → vitest 多项 `expect(...).toBe(...)` 失败 |
