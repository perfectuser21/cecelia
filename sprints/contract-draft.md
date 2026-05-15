# Sprint Contract Draft (Round 2)

## Golden Path

[harness Phase A：Proposer GAN 产出合同，propose_branch 注入字面量值] → [Phase B：generator 在 playground/server.js 实现 GET /abs 端点] → [Phase C：evaluator 启动 playground，curl GET /abs?n=-5 验证响应严格 schema] → [evaluator 输出 PASS/DONE，pipeline 记录 completed，全程无 abort 阻断]

---

### Step 1: generator 在 playground/server.js 新增 GET /abs 端点

**可观测行为**: `playground/server.js` 中存在 `/abs` 路由处理器，query 参数名字面量为 `n`，成功返回 `{"result": <number>, "operation": "abs"}`

**验证命令**:
```bash
grep -qE "app\.get\(['\"]\/abs" /workspace/playground/server.js || { echo "FAIL: /abs 路由不存在"; exit 1; }
grep -qE "req\.query\.n" /workspace/playground/server.js || { echo "FAIL: query 参数名不是 n"; exit 1; }
echo "✅ Step 1 静态验证通过"
```

**硬阈值**: `/abs` 路由存在 + query 名为 `n`

---

### Step 2: GET /abs?n=-5 返回严格 schema `{"result":5,"operation":"abs"}`

**可观测行为**: 负数输入 n=-5 → `{"result":5,"operation":"abs"}`，类型 number + string，keys 完全等于 `["operation","result"]`

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3091 node server.js & SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3091/abs?n=-5")
echo "$RESP" | jq -e '.result == 5' || { echo "FAIL: result 值错误"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "abs"' || { echo "FAIL: operation 值错误"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { echo "FAIL: result 类型非 number"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { echo "FAIL: keys 不完整或有多余"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 2 验证通过"
```

**硬阈值**: `result == 5`（number），`operation == "abs"`，`keys == ["operation","result"]`

---

### Step 3: 边界值验证（零、正数）

**可观测行为**: n=0 → `{"result":0,"operation":"abs"}`；n=3 → `{"result":3,"operation":"abs"}`

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3092 node server.js & SPID=$!
sleep 2

RESP0=$(curl -fs "localhost:3092/abs?n=0")
echo "$RESP0" | jq -e '.result == 0 and .operation == "abs"' || { echo "FAIL: 零值边界失败"; kill $SPID; exit 1; }

RESP3=$(curl -fs "localhost:3092/abs?n=3")
echo "$RESP3" | jq -e '.result == 3 and .operation == "abs"' || { echo "FAIL: 正数边界失败"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 3 验证通过"
```

**硬阈值**: n=0 → result=0，n=3 → result=3，operation 均为 "abs"

---

### Step 4: 禁用字段反向 + error path（含 body 格式验证）

**可观测行为**: response 中不存在 `value`/`answer`/`data` 等禁用字段；n=foo（非数字）→ HTTP 400 + `{"error":"<string>"}` 且 body **禁用** `message`/`msg`/`reason` 字段

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3093 node server.js & SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3093/abs?n=-5")
echo "$RESP" | jq -e 'has("value") | not' || { echo "FAIL: 禁用字段 value 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("answer") | not' || { echo "FAIL: 禁用字段 answer 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data 漏网"; kill $SPID; exit 1; }

# error path — 验证 400 状态码 + body 含 error 字段 + 禁用 message 字段
curl -s -o /tmp/err_body.json -w "%{http_code}" "localhost:3093/abs?n=foo" > /tmp/err_code.txt
CODE=$(cat /tmp/err_code.txt)
[ "$CODE" = "400" ] || { echo "FAIL: 非数字未返 400，实际=$CODE"; kill $SPID; exit 1; }
jq -e 'has("error")' /tmp/err_body.json || { echo "FAIL: error body 缺 error 字段"; kill $SPID; exit 1; }
jq -e 'has("message") | not' /tmp/err_body.json || { echo "FAIL: error body 含禁用字段 message"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 4 验证通过"
```

**硬阈值**: 禁用字段不存在；n=foo → HTTP 400 + `has("error")=true` + `has("message")=false`

---

### Step 5: propose_branch mismatch warn+fallback 验证（B42 验证点）

**可观测行为**: harness pipeline 源码中 propose_branch mismatch 处理为 warn+fallback 而非 abort

**验证命令**:
```bash
grep -rqE "(WARN|warn).*propose_branch|propose_branch.*(WARN|warn)|mismatch.*(WARN|warn)|(WARN|warn).*mismatch" \
  /workspace/packages/brain/src/workflows/ 2>/dev/null || \
  { echo "FAIL: 未找到 warn+fallback 逻辑（B42 修复点）"; exit 1; }
echo "✅ Step 5 B42 warn+fallback 存在"
```

**硬阈值**: 源码含 warn+fallback 逻辑，grep 返回 exit 0

---

## Risks

### Risk 1: Step 5 grep pattern 不够精确

**描述**: B42 warn 日志可能用不同大小写或格式记录 mismatch，grep pattern 可能漏匹配。

**Mitigation**: pattern 含 WARN/warn 双写 + propose_branch/mismatch 双路径，已足够覆盖常见实现风格。

### Risk 2: playground 端口冲突

**描述**: 多步骤使用不同端口（3091-3096），避免残留进程造成假绿。

**Mitigation**: 各步骤使用独立端口；E2E 脚本启动前清理端口残留；`curl -f` 确保 HTTP 5xx 非 0 exit。

### Risk 3: error response body format 漂移

**描述**: generator 实现 /abs 时可能将 400 错误响应字段命名为 `message`/`msg`/`reason` 而非 PRD 要求的 `error`，仅校验 HTTP 状态码无法检测此漂移（R1 实证漏洞）。

**Mitigation**: DoD [BEHAVIOR]5 和 [BEHAVIOR]6 已补充 `jq -e 'has("error")'` 正向验 + `jq -e 'has("message") | not'` 反向禁用字段检查，两条断言同时过才 PASS，generator 使用 `message` 字段时 evaluator 直接 FAIL。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -e

lsof -ti:3095 | xargs kill -9 2>/dev/null || true

cd /workspace/playground
PLAYGROUND_PORT=3095 node server.js & SPID=$!
sleep 2

# 1. result 字段值（负数）
RESP=$(curl -fs "localhost:3095/abs?n=-5")
echo "$RESP" | jq -e '.result == 5' || { echo "FAIL: result 值错误"; kill $SPID; exit 1; }

# 2. operation 字段值
echo "$RESP" | jq -e '.operation == "abs"' || { echo "FAIL: operation 值错误"; kill $SPID; exit 1; }

# 3. result 类型为 number
echo "$RESP" | jq -e '.result | type == "number"' || { echo "FAIL: result 非 number 类型"; kill $SPID; exit 1; }

# 4. schema 完整性 — keys 恰好 ["operation","result"]
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { echo "FAIL: schema keys 不符"; kill $SPID; exit 1; }

# 5. 禁用字段 value/answer 反向
echo "$RESP" | jq -e 'has("value") | not' || { echo "FAIL: 禁用字段 value 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("answer") | not' || { echo "FAIL: 禁用字段 answer 漏网"; kill $SPID; exit 1; }

# 6. 零值边界
RESP0=$(curl -fs "localhost:3095/abs?n=0")
echo "$RESP0" | jq -e '.result == 0 and .operation == "abs"' || { echo "FAIL: 零值边界失败"; kill $SPID; exit 1; }

# 7. 正数边界
RESP3=$(curl -fs "localhost:3095/abs?n=3")
echo "$RESP3" | jq -e '.result == 3 and .operation == "abs"' || { echo "FAIL: 正数边界失败"; kill $SPID; exit 1; }

# 8. error path — 非数字 → 400 + body {error:string} + 禁用 message 字段
curl -s -o /tmp/e2e_err_foo.json -w "%{http_code}" "localhost:3095/abs?n=foo" > /tmp/e2e_code_foo.txt
CODE=$(cat /tmp/e2e_code_foo.txt)
[ "$CODE" = "400" ] || { echo "FAIL: 非数字未返 400，实际=$CODE"; kill $SPID; exit 1; }
jq -e 'has("error")' /tmp/e2e_err_foo.json || { echo "FAIL: error body 缺 error 字段（非数字路径）"; kill $SPID; exit 1; }
jq -e 'has("message") | not' /tmp/e2e_err_foo.json || { echo "FAIL: error body 含禁用字段 message（非数字路径）"; kill $SPID; exit 1; }

# 9. error path — 缺少 n 参数 → 400 + body {error:string} + 禁用 message 字段
curl -s -o /tmp/e2e_err_no_n.json -w "%{http_code}" "localhost:3095/abs" > /tmp/e2e_code_no_n.txt
CODE2=$(cat /tmp/e2e_code_no_n.txt)
[ "$CODE2" = "400" ] || { echo "FAIL: 缺少 n 未返 400，实际=$CODE2"; kill $SPID; exit 1; }
jq -e 'has("error")' /tmp/e2e_err_no_n.json || { echo "FAIL: error body 缺 error 字段（缺 n 路径）"; kill $SPID; exit 1; }
jq -e 'has("message") | not' /tmp/e2e_err_no_n.json || { echo "FAIL: error body 含禁用字段 message（缺 n 路径）"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Golden Path 全部验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground/server.js 新增 GET /abs 端点

**范围**: `playground/server.js` 新增 `/abs` 路由：query 参数 `n`（严格数字），成功返回 `{"result": Math.abs(n), "operation": "abs"}`，非法输入返 400 + `{"error":"..."}`
**大小**: S（< 50 行净增，1 文件）
**依赖**: 无

**Evaluator 路径**: `sprints/contract-dod-ws1.md` [BEHAVIOR]×6（manual:bash 内嵌命令，evaluator 直接执行）
**TDD 参考测试（非 evaluator 路径）**: `sprints/tests/ws1/abs.test.ts`（generator TDD red-green 用，evaluator 不读）

---

## Workstream 切分硬规则自查

- 净增 < 200 行（仅改 server.js 约 30 行）→ `workstream_count=1` ✓

---

## Test Contract

| Workstream | DoD 文件 / Evaluator 路径 | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/contract-dod-ws1.md` [BEHAVIOR]×6（manual:bash 内嵌命令） | result 字段值、operation 字段值、schema keys 完整性、禁用字段 value/answer 反向、error path 400+body{error}+禁用message（×2） | 修复前所有 6 条 manual:bash 命令 exit 1（server.js 无 /abs 路由） |

> **注**：`sprints/tests/ws1/abs.test.ts` 是 generator TDD red-green 参考测试，**不是** evaluator 执行路径。Evaluator 只执行 `sprints/contract-dod-ws1.md` 中各 [BEHAVIOR] 条目的 `Test: manual:bash` 命令。

---

## proposer 自查 checklist 结果

1. **PRD response 字段名**: `result`（number）、`operation`（string "abs"）
2. **contract jq -e 字段名**: `.result`, `.operation` — 字面一致 ✓
3. **断言 contract keys == PRD keys**: `["operation","result"]` 完全一致 ✓
4. **PRD 禁用列表**: `value`/`answer`/`data`/`output`/`res`/`response`/`number` — contract 全用 `has("X") | not` 反向检查 ✓
5. **[BEHAVIOR] 数量**: 6 条（≥4 阈值）✓ — 覆盖 schema 字段值、keys 完整性、禁用字段反向、error path（含 body 格式 has("error")+禁用 message）各至少 1 条
6. **预期行数自查**: 净增约 30 行（1 文件）< 200 行阈值 → workstream_count=1 ✓
7. **R2 修订点**：BEHAVIOR 5/6 从仅验 HTTP 状态码 → 补 jq-e error body 验证（修复 R1 reviewer 问题 1）；新增 Risk 3 覆盖 error body format drift（修复 R1 reviewer 问题 2）
