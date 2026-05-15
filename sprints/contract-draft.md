# Sprint Contract Draft (Round 1)

## Golden Path

[harness Phase C 读取 origin/main playground/] → [playground server.js 含 GET /echo 端点] → [启动服务] → [GET /echo?msg=hello → {msg:"hello"} 严 schema] → [空字符串边界通过] → [缺失 msg → 400] → [evaluator 输出 PASS]

---

### Step 1: origin/main playground/ 包含正确 GET /echo 实现（静态验证）

**可观测行为**: `playground/server.js` 含 `GET /echo` handler；handler 使用 `msg` 字段，不使用 `echo` 字段

**验证命令**:
```bash
# 验证 /echo 路由存在且返回 msg 字段
node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes(\"app.get('/echo'\")&&!c.includes('app.get(\"/echo\"'))process.exit(1);if(c.match(/\\/echo.*\\{\\s*echo:/))process.exit(1);console.log('OK')"
```

**硬阈值**: exit 0 + 输出 OK；源码含 `/echo` handler + 使用 `msg` 字段

---

### Step 2: 启动 playground 服务，GET /echo?msg=hello → {msg:"hello"} 字段值

**可观测行为**: 服务 HTTP 200 返回 `{"msg":"hello"}`，`.msg` 字段值等于 `"hello"`

**验证命令**:
```bash
lsof -ti:3099 | xargs kill -9 2>/dev/null || true
cd /workspace/playground && PLAYGROUND_PORT=3099 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3099/echo?msg=hello")
echo "$RESP" | jq -e '.msg == "hello"' || { echo "FAIL: .msg 值错误"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 2 验证通过"
```

**硬阈值**: HTTP 200，`jq -e '.msg == "hello"'` exit 0

---

### Step 3: response schema 完整性 — keys 完全等于 ["msg"]

**可观测行为**: `jq 'keys'` 输出精确等于 `["msg"]`，不允许多余字段

**验证命令**:
```bash
lsof -ti:3098 | xargs kill -9 2>/dev/null || true
cd /workspace/playground && PLAYGROUND_PORT=3098 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3098/echo?msg=hello")
echo "$RESP" | jq -e 'keys == ["msg"]' || { echo "FAIL: keys 不符"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 3 验证通过"
```

**硬阈值**: `keys == ["msg"]` 精确匹配

---

### Step 4: 禁用字段 echo 反向验证

**可观测行为**: response 中 `echo` 字段不存在（has("echo") 为 false）

**验证命令**:
```bash
lsof -ti:3097 | xargs kill -9 2>/dev/null || true
cd /workspace/playground && PLAYGROUND_PORT=3097 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3097/echo?msg=hello")
echo "$RESP" | jq -e 'has("echo") | not' || { echo "FAIL: 禁用字段 echo 漏网"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 4 验证通过"
```

**硬阈值**: `has("echo") | not` exit 0

---

### Step 5: 空字符串边界 — GET /echo?msg= → {msg:""}

**可观测行为**: `msg` 为空字符串时返回 `{"msg":""}` 而非 null 或 undefined

**验证命令**:
```bash
lsof -ti:3096 | xargs kill -9 2>/dev/null || true
cd /workspace/playground && PLAYGROUND_PORT=3096 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3096/echo?msg=")
echo "$RESP" | jq -e '.msg == ""' || { echo "FAIL: 空字符串边界失败"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 5 验证通过"
```

**硬阈值**: `{msg:""}` 精确返回

---

### Step 6: 缺失 msg 参数 → HTTP 400 + error 字段

**可观测行为**: `GET /echo`（无 query 参数）返回 HTTP 400 + `{"error": "..."}`

**验证命令**:
```bash
lsof -ti:3095 | xargs kill -9 2>/dev/null || true
cd /workspace/playground && PLAYGROUND_PORT=3095 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3095/echo")
[ "$CODE" = "400" ] || { echo "FAIL: 缺失 msg 未返 400，实际=$CODE"; kill $SPID; exit 1; }
RESP=$(curl -s "localhost:3095/echo")
echo "$RESP" | jq -e '.error | type == "string"' || { echo "FAIL: error 字段非 string"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 6 验证通过"
```

**硬阈值**: HTTP 400，`error` 字段类型为 string

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 清理可能残留的端口
lsof -ti:3099 | xargs kill -9 2>/dev/null || true

# Step 1: 静态验证 origin/main playground/server.js 含 /echo + msg 字段
grep -c "app.get.*echo" /workspace/playground/server.js || { echo "FAIL: /echo 路由不存在"; exit 1; }
grep "{ msg:" /workspace/playground/server.js || { echo "FAIL: server.js 不含 msg 字段"; exit 1; }

# 启动服务
cd /workspace/playground
PLAYGROUND_PORT=3099 node server.js & SPID=$!
sleep 2

# Step 2: .msg 字段值
RESP=$(curl -fs "localhost:3099/echo?msg=hello")
echo "$RESP" | jq -e '.msg == "hello"' || { echo "FAIL: .msg 值错误"; kill $SPID; exit 1; }

# Step 3: keys 完整性
echo "$RESP" | jq -e 'keys == ["msg"]' || { echo "FAIL: keys 不符"; kill $SPID; exit 1; }

# Step 4: 禁用字段 echo 反向
echo "$RESP" | jq -e 'has("echo") | not' || { echo "FAIL: 禁用字段 echo 漏网"; kill $SPID; exit 1; }

# Step 5: 空字符串边界
RESP2=$(curl -fs "localhost:3099/echo?msg=")
echo "$RESP2" | jq -e '.msg == ""' || { echo "FAIL: 空字符串边界失败"; kill $SPID; exit 1; }

# Step 6: error path
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3099/echo")
[ "$CODE" = "400" ] || { echo "FAIL: 缺失 msg 未返 400，实际=$CODE"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Golden Path 全部验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: 修复 playground/tests/echo.test.js 验证正确 schema

**范围**: `playground/tests/echo.test.js` — 将测试期望从 `{echo:"hello"}` 改为 `{msg:"hello"}`；移除 `msg` 出禁用 key 列表；keys assertion 改为 `["msg"]`
**大小**: S（< 50 行改动，1 文件）
**依赖**: 无

**Evaluator 路径**: `contract-dod-ws1.md` 内嵌 [BEHAVIOR] manual:bash 命令（evaluator 直接执行）
**TDD 参考测试（非 evaluator 路径）**: `sprints/tests/ws1/phase-c-verify.test.js`（当前 3 Red）

---

## Workstream 切分硬规则自查

- 净增 < 200 行（仅改 playground/tests/echo.test.js ~40 行）→ `workstream_count=1` ✓
- 文件数 ≤ 3（1 文件）✓

---

## Test Contract

| Workstream | DoD 文件 / Evaluator 路径 | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `contract-dod-ws1.md` [BEHAVIOR]×5（manual:bash 内嵌命令） | msg 字段值、keys 完整性、echo 禁用反向、空字符串、400 error path | `sprints/tests/ws1/phase-c-verify.test.js` 3 failures（文件含 `{echo:` 期望） |

> **注**：`sprints/tests/ws1/phase-c-verify.test.js` 是 generator TDD red-green 参考测试（当前 3 Red），**不是** evaluator 执行路径。Evaluator 只执行 `contract-dod-ws1.md` 中各 [BEHAVIOR] 条目的 `Test: manual:bash` 命令。
