# Sprint Contract Draft (Round 1) — playground GET /decrement

## Golden Path

[客户端 HTTP GET] → [playground/server.js 路由 `/decrement`] → [strict-schema 整数正则 `^-?\d+$` + 上下界 |value| ≤ 9007199254740990 校验] → [200 `{result:N-1, operation:"decrement"}` 严 schema 输出 / 400 `{error:"<非空 string>"}` 严错误体]

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

### Step 2: strict-schema 整数 + 精度上下界校验

**可观测行为**: 仅当 `value` 匹配 `^-?\d+$` 且 `|Number(value)| ≤ 9007199254740990` 时通过；任何越界、小数、空白、空串、缺参、错 query 名、前导 `+`、`Infinity`、`NaN`、十六进制、千分位等非法输入一律 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 node server.js & SPID=$!
sleep 2
# 越上界
C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?value=9007199254740991")
# 越下界
C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?value=-9007199254740991")
# 小数
C3=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?value=1.5")
# 错 query 名（PRD 禁用列表里的 n）
C4=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement?n=5")
# 缺参
C5=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3102/decrement")
kill $SPID 2>/dev/null
[ "$C1" = "400" ] && [ "$C2" = "400" ] && [ "$C3" = "400" ] && [ "$C4" = "400" ] && [ "$C5" = "400" ] \
  || { echo "FAIL: 校验未拒非法输入 C1=$C1 C2=$C2 C3=$C3 C4=$C4 C5=$C5"; exit 1; }
echo "✅ Step 2：strict-schema + 上下界校验"
```

**硬阈值**: 5 类非法输入全部 400；合法输入（如 `value=5`）必须 200

---

### Step 3: 200 返 `{result:N-1, operation:"decrement"}` 严 schema

**可观测行为**: 顶层 keys **严格等于** `["operation","result"]`；`operation` 字面值 `"decrement"`；`result` 必须是数字且等于 `Number(value)-1`；body 不含任一禁用字段名。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3103/decrement?value=5")
# 1) result 字段值
echo "$RESP" | jq -e '.result == 4' >/dev/null \
  || { echo "FAIL: result 非 4，实际 $RESP"; kill $SPID; exit 1; }
# 2) operation 字段字面字符串
echo "$RESP" | jq -e '.operation == "decrement"' >/dev/null \
  || { echo "FAIL: operation 非字面 \"decrement\"，实际 $RESP"; kill $SPID; exit 1; }
# 3) schema 完整性 keys
echo "$RESP" | jq -e 'keys == ["operation","result"]' >/dev/null \
  || { echo "FAIL: keys 非 [operation,result]，实际 $(echo "$RESP" | jq -c 'keys')"; kill $SPID; exit 1; }
# 4) 禁用字段反向（抽 4 个高风险）
echo "$RESP" | jq -e 'has("decremented")|not' >/dev/null \
  || { echo "FAIL: 禁用 decremented 出现"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("prev")|not' >/dev/null \
  || { echo "FAIL: 禁用 prev 出现"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("value")|not' >/dev/null \
  || { echo "FAIL: 禁用 value 出现"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("minus_one")|not' >/dev/null \
  || { echo "FAIL: 禁用 minus_one 出现"; kill $SPID; exit 1; }
kill $SPID 2>/dev/null
echo "✅ Step 3：success schema 严格"
```

**硬阈值**: 4 项 jq -e 全过；任一不达即 FAIL

---

### Step 4: 400 返 `{error:"<非空 string>"}` 严错误体

**可观测行为**: 错误响应顶层 keys **严格等于** `["error"]`；`error` 是非空字符串；body **不含** `result` 也不含 `operation`；禁用替代名 `message`/`msg`/`reason`/`detail` 反向不存在。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 node server.js & SPID=$!
sleep 2
RESP=$(curl -s "localhost:3104/decrement?value=foo")
# 1) error 是非空 string
echo "$RESP" | jq -e '.error | type == "string" and length > 0' >/dev/null \
  || { echo "FAIL: error 非非空 string，实际 $RESP"; kill $SPID; exit 1; }
# 2) keys 严格等于 [error]
echo "$RESP" | jq -e 'keys == ["error"]' >/dev/null \
  || { echo "FAIL: 错误体 keys 非 [error]，实际 $(echo "$RESP" | jq -c 'keys')"; kill $SPID; exit 1; }
# 3) body 不含 result
echo "$RESP" | jq -e 'has("result")|not' >/dev/null \
  || { echo "FAIL: 错误体含 result"; kill $SPID; exit 1; }
# 4) 禁用错误同义名
echo "$RESP" | jq -e 'has("message")|not and has("msg")|not and has("reason")|not and has("detail")|not' >/dev/null \
  || { echo "FAIL: 错误体含禁用替代名"; kill $SPID; exit 1; }
kill $SPID 2>/dev/null
echo "✅ Step 4：error schema 严格"
```

**硬阈值**: 4 项 jq -e 全过

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

# 1) Happy: value=5 → 200 + {result:4, operation:"decrement"} 严 schema
RESP=$(curl -fs "$BASE/decrement?value=5")
echo "$RESP" | jq -e '.result == 4 and .operation == "decrement" and (keys == ["operation","result"])' >/dev/null \
  || { echo "FAIL: happy schema 不达"; exit 1; }

# 2) Boundary happy: 精度上界
RESP=$(curl -fs "$BASE/decrement?value=9007199254740990")
echo "$RESP" | jq -e '.result == 9007199254740989 and .operation == "decrement"' >/dev/null \
  || { echo "FAIL: 上界 happy 不达"; exit 1; }

# 3) Boundary happy: 精度下界
RESP=$(curl -fs "$BASE/decrement?value=-9007199254740990")
echo "$RESP" | jq -e '.result == -9007199254740991 and .operation == "decrement"' >/dev/null \
  || { echo "FAIL: 下界 happy 不达"; exit 1; }

# 4) Boundary reject: 越上界
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?value=9007199254740991")" = "400" ] \
  || { echo "FAIL: 越上界未拒"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?value=-9007199254740991")" = "400" ] \
  || { echo "FAIL: 越下界未拒"; exit 1; }

# 5) Strict schema reject: 小数 / 前导 + / 空 / 错 query 名
for case in "value=1.5" "value=+5" "value=" "value=abc" "value=1e2" "n=5"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement?$case")
  [ "$CODE" = "400" ] || { echo "FAIL: $case 应 400 实 $CODE"; exit 1; }
done

# 6) 缺参也 400
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decrement")" = "400" ] \
  || { echo "FAIL: 缺参未拒"; exit 1; }

# 7) Error body 严 schema
RESP=$(curl -s "$BASE/decrement?value=foo")
echo "$RESP" | jq -e 'keys == ["error"] and (.error | type == "string" and length > 0)' >/dev/null \
  || { echo "FAIL: 错误体 schema 不达"; exit 1; }

# 8) 禁用字段反向（success 端）
RESP=$(curl -fs "$BASE/decrement?value=5")
for forbidden in decremented prev predecessor minus_one sub_one incremented sum product quotient power remainder factorial negation value input output data payload answer meta; do
  echo "$RESP" | jq -e "has(\"$forbidden\")|not" >/dev/null \
    || { echo "FAIL: 禁用字段 $forbidden 出现在 success body"; exit 1; }
done

# 9) 8 路由回归 happy
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")" = "200" ] || { echo "FAIL: /health 回归"; exit 1; }
curl -fs "$BASE/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null || { echo "FAIL: /sum 回归"; exit 1; }
curl -fs "$BASE/multiply?a=7&b=5" | jq -e '.product == 35' >/dev/null || { echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "$BASE/divide?a=10&b=2" | jq -e '.quotient == 5' >/dev/null || { echo "FAIL: /divide 回归"; exit 1; }
curl -fs "$BASE/power?a=2&b=10" | jq -e '.power == 1024' >/dev/null || { echo "FAIL: /power 回归"; exit 1; }
curl -fs "$BASE/modulo?a=10&b=3" | jq -e '.remainder == 1' >/dev/null || { echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "$BASE/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' >/dev/null || { echo "FAIL: /increment 回归"; exit 1; }
curl -fs "$BASE/factorial?n=5" | jq -e '.factorial == 120' >/dev/null || { echo "FAIL: /factorial 回归"; exit 1; }

echo "✅ Golden Path 验收通过 — /decrement 上线且 8 路由回归全绿"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 `GET /decrement` 路由 + 测试 describe 块 + README 段

**范围**:
- `playground/server.js` 新增 `app.get('/decrement', ...)` 路由：query 名 `value`、strict-schema 整数 `^-?\d+$`、上下界 `|Number(value)| ≤ 9007199254740990`、返回 `{result: Number(value)-1, operation: "decrement"}`、错误体 `{error: "<非空 string>"}`、严 schema 完整性（顶层 keys 仅 `operation`/`result` 或仅 `error`）
- `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块：happy（0/1/-1/上界/下界）、上下界拒、strict 拒（小数/前导+/科学计数法/十六进制/空串/缺参/错 query 名 n=5）、schema 完整性 oracle、禁用字段反向、错误体 keys=[error] 断言
- `playground/README.md` 端点列表加 `/decrement` 段（≥ 4 个示例）
- 7 路由（/health /sum /multiply /divide /power /modulo /increment /factorial）回归 happy 1 条/路由

**大小**: S (<100 行净增 / ≤ 3 文件)

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/decrement.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/decrement.test.js` | success schema 严字面 / keys 完整性 / 禁用字段反向 / error path 严 schema / 上下界 / strict 拒 | 当前 `/decrement` 未实现 → supertest 拿到 404 → 全部 assertion FAIL |
