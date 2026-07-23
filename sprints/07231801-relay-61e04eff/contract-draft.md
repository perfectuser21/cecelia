# Sprint Contract Draft — Playground GET /square 路由

> **PR-G 验收承诺**：本合同字段名严格字面照搬 PRD `## 功能规范` 段：
> - response success keys = `result` + `operation`（字面，**禁用变体 `sq`/`squared`/`pow2`/`power`/`value`/`input`/`output`/`data` 等**）
> - operation 字面值 = `"square"`（**禁用变体 `sq`/`squared`/`pow2`/`power`/`sqr` 等**）
> - query param 字面名 = `value`（禁用别名 `n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`）
> - response error key = `error`（禁用 `message`/`msg`/`reason`/`detail`）
> - schema 完整性：成功响应 keys 字面集合 = `["operation","result"]`，错误响应 keys 字面集合 = `["error"]`
>
> Proposer 自查 checklist（v7.5 死规则）：
> 1. PRD success keys = {`result`,`operation`} ✓ contract jq -e 用 `keys | sort == ["operation","result"]` ✓
> 2. PRD operation 字面 = `"square"` ✓ contract jq -e 写 `.operation == "square"` ✓
> 3. PRD 精度上界 = `|value| > 94906265` → 400 ✓ contract 写 value=94906265 → 200，value=94906266 → 400 ✓
> 4. PRD strict-schema = `^-?\d+$` ✓ contract 写小数/科学计数/前导+/缺参均 → 400 ✓

---

## Golden Path

```
[HTTP 客户端发 GET /square?value=<十进制整数字符串，含可选前导负号>]
  → [playground server 收到请求，对 value 做 strict-schema ^-?\d+$ 校验]
  → [strict-schema 通过后判定 Math.abs(Number(value)) > 94906265，超界则返 400]
  → [合法则计算 result = Number(value) * Number(value)]
  → [返回 HTTP 200 {result: <N²>, operation: "square"}，顶层 keys 字面 = ["operation","result"]]
```

---

## E2E 验收

target_environment: server_local（playground Node.js 服务，端口 PLAYGROUND_PORT=3001）

```bash
#!/bin/bash
set -e

# 启动 playground（如果未运行）
cd /workspace
PLAYGROUND_PORT=3001 node playground/server.js > /tmp/square-e2e.log 2>&1 &
SPID=$!
sleep 1

fail() { kill $SPID 2>/dev/null; echo "FAIL: $1"; exit 1; }

# ── 成功场景 ──────────────────────────────────────────────
# 1. value=5 → result=25
RESP=$(curl -fs 'http://127.0.0.1:3001/square?value=5')
echo "$RESP" | jq -e '.result == 25' > /dev/null || fail "result != 25 for value=5"
echo "$RESP" | jq -e '.operation == "square"' > /dev/null || fail "operation != \"square\""
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' > /dev/null || fail "keys 不严格"
echo "OK: value=5 → 25"

# 2. value=-3 → result=9
RESP=$(curl -fs 'http://127.0.0.1:3001/square?value=-3')
echo "$RESP" | jq -e '.result == 9' > /dev/null || fail "result != 9 for value=-3"
echo "OK: value=-3 → 9"

# 3. value=0 → result=0
RESP=$(curl -fs 'http://127.0.0.1:3001/square?value=0')
echo "$RESP" | jq -e '.result == 0' > /dev/null || fail "result != 0 for value=0"
echo "OK: value=0 → 0"

# 4. 精度上界 value=94906265 → 200
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=94906265')
[ "$CODE" = "200" ] || fail "value=94906265 应返 200，实际 $CODE"
echo "OK: value=94906265 → 200"

# 5. 精度越界 value=94906266 → 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=94906266')
[ "$CODE" = "400" ] || fail "value=94906266 应返 400，实际 $CODE"
echo "OK: value=94906266 → 400"

# ── 拒绝场景 ──────────────────────────────────────────────
# 6. 小数拒绝
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=1.5')
[ "$CODE" = "400" ] || fail "value=1.5 应返 400，实际 $CODE"
echo "OK: value=1.5 → 400"

# 7. 科学计数法拒绝
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=1e2')
[ "$CODE" = "400" ] || fail "value=1e2 应返 400，实际 $CODE"
echo "OK: value=1e2 → 400"

# 8. 前导 + 拒绝
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=%2B5')
[ "$CODE" = "400" ] || fail "value=+5 应返 400，实际 $CODE"
echo "OK: value=+5 → 400"

# 9. 缺参拒绝
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square')
[ "$CODE" = "400" ] || fail "缺 value 应返 400，实际 $CODE"
echo "OK: 缺参 → 400"

# 10. 别名拒绝（n、x 不识别）
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?n=5')
[ "$CODE" = "400" ] || fail "n=5 应返 400，实际 $CODE"
echo "OK: n=5（别名）→ 400"

# ── 回归检查 ──────────────────────────────────────────────
# 11. /health 不受影响
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/health')
[ "$CODE" = "200" ] || fail "/health 回归失败，实际 $CODE"
echo "OK: /health 回归通过"

# 12. /sum 不受影响
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/sum?a=1&b=2')
[ "$CODE" = "200" ] || fail "/sum 回归失败，实际 $CODE"
echo "OK: /sum 回归通过"

# 13. /increment 不受影响
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/increment?value=1')
[ "$CODE" = "200" ] || fail "/increment 回归失败，实际 $CODE"
echo "OK: /increment 回归通过"

kill $SPID 2>/dev/null
echo ""
echo "E2E 全部通过"
```

---

## 接缝清单

| # | 接缝点 | 类型 | 真目标验证方式 |
|---|---|---|---|
| 1 | GET /square HTTP 响应 | 逻辑断言 | vitest + supertest 单测 |
| 2 | strict-schema 正则 `^-?\d+$` | 逻辑断言 | vitest — 多种非法输入测试 |
| 3 | 精度上界 94906265/94906266 边界 | 逻辑断言 | vitest — 临界值测试 |
| 4 | 别名参数拒绝 | 逻辑断言 | vitest — n/x/a/b 等别名均 400 |
| 5 | 响应 schema 完整性 | 接缝断言 | vitest + jq 双重验证 |
| 6 | 现有路由回归保护 | 接缝断言 | vitest 回归 describe 块 |

---

## 未覆盖真实链路清单

N/A — playground 是纯内存计算路由，无 DB/外部 API/文件系统接缝；所有场景均可在 vitest+supertest 单元测试中完整覆盖，无需额外真实链路验证。

---

## Risks

| # | 风险 | 严重度 | Mitigation |
|---|---|---|---|
| 1 | 实现使用 `Number(value) ** 2` 而非 `Number(value) * Number(value)`，浮点精度不一致 | Low | BEHAVIOR-2 测试 value=94906265 的精确结果值 |
| 2 | Generator 用 `n`/`x` 作 query 参数名 | High | BEHAVIOR-6 明确测试别名均返 400 |
| 3 | operation 字段值写成 `"squared"` 或 `"sq"` | High | BEHAVIOR-3 字面量断言 `operation === "square"` |
| 4 | 错误响应含多余字段（如同时含 `error` + `message`） | Medium | BEHAVIOR-7 断言错误响应 keys 字面 = `["error"]` |
