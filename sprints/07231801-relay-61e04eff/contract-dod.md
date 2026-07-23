# Contract DoD — Playground GET /square 路由

> sprint: 07231801-relay-61e04eff
> task_id: 61e04eff-1fcd-4da8-b1c1-161f81026a76
> journey: api_only / server_local

---

## BEHAVIOR 条目

[BEHAVIOR-1] 基础成功场景 — 正整数平方
- 触发：GET /square?value=5
- 期望：HTTP 200，body `{result: 25, operation: "square"}`
- 断言：`res.status === 200 && res.body.result === 25 && res.body.operation === "square"`
- 测试：tests/server.test.contracts.js describe "GET /square 基础成功场景"

[BEHAVIOR-2] 精度上界边界 — value=94906265 → 200（最大合法值）
- 触发：GET /square?value=94906265
- 期望：HTTP 200，result = 9007199254740225（= 94906265²）
- 断言：`res.status === 200 && typeof res.body.result === 'number'`
- 测试：tests/server.test.contracts.js describe "GET /square 精度上界"

[BEHAVIOR-3] 精度上界边界 — value=94906266 → 400（超过精度上界）
- 触发：GET /square?value=94906266
- 期望：HTTP 400，body `{error: <非空字符串>}`
- 断言：`res.status === 400 && typeof res.body.error === 'string' && res.body.error.length > 0`
- 测试：tests/server.test.contracts.js describe "GET /square 精度上界"

[BEHAVIOR-4] strict-schema 拒绝 — 小数/科学计数法/前导+
- 触发：GET /square?value=1.5 | value=1e2 | value=+5
- 期望：HTTP 400 for all
- 断言：`res.status === 400`
- 测试：tests/server.test.contracts.js describe "GET /square strict-schema 拒绝"

[BEHAVIOR-5] 缺参拒绝 — 无 value 参数
- 触发：GET /square（无 query 参数）
- 期望：HTTP 400，body `{error: <非空字符串>}`
- 断言：`res.status === 400 && typeof res.body.error === 'string'`
- 测试：tests/server.test.contracts.js describe "GET /square strict-schema 拒绝"

[BEHAVIOR-6] 别名参数拒绝 — query 名锁死为 value
- 触发：GET /square?n=5 | ?x=5 | ?a=5 | ?b=5
- 期望：HTTP 400（识别为缺参）
- 断言：`res.status === 400`
- 测试：tests/server.test.contracts.js describe "GET /square query 名锁死"

[BEHAVIOR-7] 响应 schema 严格 — 成功响应只含 result + operation
- 触发：GET /square?value=5
- 期望：body keys 字面集合 === `["operation","result"]`（不多不少）
- 断言：`Object.keys(res.body).sort() deep equals ["operation","result"]`
- 测试：tests/server.test.contracts.js describe "GET /square 响应 schema 严格"

[BEHAVIOR-8] 响应 schema 严格 — 错误响应只含 error
- 触发：GET /square?value=1.5
- 期望：body keys 字面集合 === `["error"]`（禁止 message/msg/reason/detail）
- 断言：`Object.keys(res.body).sort() deep equals ["error"]`
- 测试：tests/server.test.contracts.js describe "GET /square 响应 schema 严格"

[BEHAVIOR-9] 负数场景 — value=-3 → result=9
- 触发：GET /square?value=-3
- 期望：HTTP 200，`{result: 9, operation: "square"}`
- 断言：`res.status === 200 && res.body.result === 9`
- 测试：tests/server.test.contracts.js describe "GET /square 基础成功场景"

[BEHAVIOR-10] 零值场景 — value=0 → result=0
- 触发：GET /square?value=0
- 期望：HTTP 200，`{result: 0, operation: "square"}`
- 断言：`res.status === 200 && res.body.result === 0`
- 测试：tests/server.test.contracts.js describe "GET /square 基础成功场景"

---

## ARTIFACT 条目

[ARTIFACT-1] 源码检查 — playground/server.js 含 /square 路由
- 验证：`grep -E "app\.(get|use)\(['\"]/?square" playground/server.js`
- 期望：输出非空，表明路由已注册

[ARTIFACT-2] 源码检查 — strict-schema 正则存在
- 验证：`grep -E "\^\-\?\\\\d\+\\\$|strict|schema" playground/server.js`
- 期望：文件内存在 strict-schema 相关正则或注释

[ARTIFACT-3] 源码检查 — 精度上界常量 94906265 存在
- 验证：`grep "94906265" playground/server.js`
- 期望：输出非空，表明边界值已明确写入代码

[ARTIFACT-4] 测试文件存在
- 验证：`ls sprints/07231801-relay-61e04eff/tests/server.test.contracts.js`
- 期望：文件存在

---

## manual:bash 可执行验收命令

```bash
#!/bin/bash
# 手动验收脚本 — GET /square 路由
set -e

cd /workspace

echo "=== Step 1: 源码检查 ==="
grep -E "app\.(get|use)\(['\"]/?square" playground/server.js && echo "OK: /square 路由已注册" || { echo "FAIL: 未找到 /square 路由"; exit 1; }
grep "94906265" playground/server.js && echo "OK: 精度上界常量存在" || { echo "FAIL: 精度上界常量未找到"; exit 1; }

echo ""
echo "=== Step 2: vitest 合同测试 ==="
npx vitest run sprints/07231801-relay-61e04eff/tests/server.test.contracts.js --reporter=verbose

echo ""
echo "=== Step 3: E2E curl 验证 ==="
PLAYGROUND_PORT=3001 node playground/server.js > /tmp/square-manual.log 2>&1 &
SPID=$!
sleep 1

fail() { kill $SPID 2>/dev/null; echo "FAIL: $1"; exit 1; }

# 核心成功场景
RESP=$(curl -fs 'http://127.0.0.1:3001/square?value=5')
echo "$RESP" | jq -e '.result == 25 and .operation == "square"' > /dev/null || fail "value=5 基础场景"
RESP=$(curl -fs 'http://127.0.0.1:3001/square?value=-3')
echo "$RESP" | jq -e '.result == 9' > /dev/null || fail "value=-3 负数场景"
RESP=$(curl -fs 'http://127.0.0.1:3001/square?value=0')
echo "$RESP" | jq -e '.result == 0' > /dev/null || fail "value=0 零值场景"

# 精度边界
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=94906265')
[ "$CODE" = "200" ] || fail "精度上界 94906265 应 200，实际 $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square?value=94906266')
[ "$CODE" = "400" ] || fail "精度越界 94906266 应 400，实际 $CODE"

# 拒绝场景
for v in '1.5' '1e2' '%2B5' ''; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001/square?value=$v")
  [ "$CODE" = "400" ] || fail "value=$v 应 400，实际 $CODE"
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/square')
[ "$CODE" = "400" ] || fail "缺参应 400，实际 $CODE"

# 别名拒绝
for alias in n x a b; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001/square?${alias}=5")
  [ "$CODE" = "400" ] || fail "别名 ${alias}=5 应 400，实际 $CODE"
done

kill $SPID 2>/dev/null
echo ""
echo "=== 所有验收条件通过 ==="
```

---

## 验收条件覆盖矩阵

| PRD 验收条件 | BEHAVIOR | 测试覆盖 |
|---|---|---|
| value=5 → {result:25, operation:"square"} | BEHAVIOR-1 | server.test.contracts.js:基础成功场景 |
| value=-3 → {result:9} | BEHAVIOR-9 | server.test.contracts.js:基础成功场景 |
| value=0 → {result:0} | BEHAVIOR-10 | server.test.contracts.js:基础成功场景 |
| 非整数 → 400 | BEHAVIOR-4 | server.test.contracts.js:strict-schema |
| 缺参 → 400 | BEHAVIOR-5 | server.test.contracts.js:strict-schema |
| 越界 → 400 | BEHAVIOR-3 | server.test.contracts.js:精度上界 |
| 94906265 → 200 | BEHAVIOR-2 | server.test.contracts.js:精度上界 |
| query 名锁死 value | BEHAVIOR-6 | server.test.contracts.js:query 名锁死 |
| 成功响应 keys = [operation,result] | BEHAVIOR-7 | server.test.contracts.js:响应 schema |
| 错误响应 keys = [error] | BEHAVIOR-8 | server.test.contracts.js:响应 schema |
| I1: 现有路由不受影响 | 回归测试 | server.test.contracts.js:回归 |
