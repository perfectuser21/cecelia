# Sprint Contract Draft (Round 3)

## Golden Path

[harness 启动 playground] → [GET /echo?msg=hello 返回 {"msg":"hello"}] → [evaluator 验证 schema 严格合规] → [evaluator 输出 FIXED 或 APPROVED] → [harness 归一化 FIXED/APPROVED → PASS] → [PR merge 无 --auto 标志错误，仅启动一个 playground 实例]

---

### Step 1: playground /echo 端点返回正确 schema

**可观测行为**: GET /echo?msg=hello 返回 HTTP 200 + `{"msg":"hello"}`，顶层 keys 完全等于 `["msg"]`，禁用字段 `echo` 不存在

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3099 node server.js & SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3099/echo?msg=hello")
echo "$RESP" | jq -e '.msg == "hello"' || { echo "FAIL: .msg 值错误"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["msg"]' || { echo "FAIL: keys 不完整"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("echo") | not' || { echo "FAIL: 禁用字段 echo 漏网"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 1 验证通过"
```

**硬阈值**: HTTP 200，`msg == "hello"`，`keys == ["msg"]`，`echo` key 不存在

---

### Step 2: 空字符串边界验证

**可观测行为**: GET /echo?msg= 返回 `{"msg":""}` 而非 null 或 undefined

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3099 node server.js & SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3099/echo?msg=")
echo "$RESP" | jq -e '.msg == ""' || { echo "FAIL: 空字符串未正确回显"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 2 验证通过"
```

**硬阈值**: `{"msg":""}` 精确返回

---

### Step 3: 缺少必填参数 msg → 400

**可观测行为**: GET /echo（无 msg 参数）返回 HTTP 400 + `{"error": "..."}`

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3099 node server.js & SPID=$!
sleep 2

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3099/echo")
[ "$CODE" = "400" ] || { echo "FAIL: 缺失 msg 未返 400，实际=$CODE"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 3 验证通过"
```

**硬阈值**: HTTP 400

---

### Step 4: B39 harness 归一化验证（evaluator verdict → PASS）

**可观测行为**: evaluator 输出 FIXED 或 APPROVED 时，`normalizeVerdict()` 函数均返回 `'PASS'`，不报 unknown verdict 错误

**验证命令**:
```bash
grep -qE "FIXED.*PASS|APPROVED.*PASS|'PASS'.*'FIXED'.*'APPROVED'" \
  /workspace/packages/brain/src/workflows/harness-task.graph.js || \
  { echo "FAIL: 未找到 FIXED/APPROVED → PASS 归一化逻辑"; exit 1; }
echo "✅ Step 4 静态检验通过（B39 #2968 已合并）"
```

**硬阈值**: 源码含 FIXED/APPROVED → PASS 归一化逻辑，grep -q 返回 exit 0

---

### Step 5: 无 --auto 标志、无并发容器爆炸

**可观测行为**: harness 运行脚本不含 `--auto` 标志；单次运行只启动一个 playground 进程

**验证命令**:
```bash
grep -r "\-\-auto" /workspace/packages/engine/scripts/ 2>/dev/null && { echo "FAIL: --auto 未移除"; exit 1; } || echo "✅ --auto 已移除"
```

**硬阈值**: 源码中无 `--auto` 标志

---

## Risks

### Risk 1: normalizeVerdict 路径变更导致 Step 4 恒绿

**描述**: 如果 B39 后 `normalizeVerdict` 函数被重命名或移入其他文件，Step 4 的 grep 路径会返回非 0 exit code，误判为 FAIL；若 grep pattern 不精确，也可能恒绿。

**Mitigation**: Step 4 验证命令直接 grep 具体文件路径（`harness-task.graph.js`），pattern 同时匹配 Set 初始化语法 `'FIXED'.*'APPROVED'`，与函数实现绑定，减少漂移窗口。合同 Reviewer 检查 grep 可否造假。

### Risk 2: playground 端口冲突导致 E2E 假绿

**描述**: 若 3099 端口在 evaluator 运行时已被占用（上一个 playground 进程未正常退出），`node server.js` 启动失败但 `curl` 可能打到旧进程，返回旧 `echo` 字段，掩盖 schema 未修复的事实。

**Mitigation**: E2E 脚本在启动前用 `lsof -ti:3099 | xargs kill -9 2>/dev/null || true` 清理残留进程；`curl -f` flag 确保 HTTP 5xx 会返回非 0 exit code；`jq -e` 精确匹配 `keys == ["msg"]` 捕获 schema 漂移。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 清理可能残留的 3099 端口进程
lsof -ti:3099 | xargs kill -9 2>/dev/null || true

cd /workspace/playground
PLAYGROUND_PORT=3099 node server.js & SPID=$!
sleep 2

# 1. msg 字段值验证
RESP=$(curl -fs "localhost:3099/echo?msg=hello")
echo "$RESP" | jq -e '.msg == "hello"' || { echo "FAIL: .msg 值错误"; kill $SPID; exit 1; }

# 2. schema 完整性 — keys 完全等于 ["msg"]
echo "$RESP" | jq -e 'keys == ["msg"]' || { echo "FAIL: keys 不符"; kill $SPID; exit 1; }

# 3. 禁用字段 echo 反向
echo "$RESP" | jq -e 'has("echo") | not' || { echo "FAIL: 禁用字段 echo 仍存在"; kill $SPID; exit 1; }

# 4. 空字符串边界
RESP2=$(curl -fs "localhost:3099/echo?msg=")
echo "$RESP2" | jq -e '.msg == ""' || { echo "FAIL: 空字符串边界失败"; kill $SPID; exit 1; }

# 5. 缺失 msg 返 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3099/echo")
[ "$CODE" = "400" ] || { echo "FAIL: 缺失 msg 未返 400，实际=$CODE"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Golden Path 全部验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: 修复 playground /echo schema

**范围**: `playground/server.js` 中 GET /echo 端点响应字段由 `echo` 改为 `msg`；缺失 msg 参数时返回 400
**大小**: S（< 20 行净改动，1 文件）
**依赖**: 无

**Evaluator 路径**: `contract-dod-ws1.md` [BEHAVIOR]×5（manual:bash 内嵌命令，evaluator 直接执行）
**TDD 参考测试（非 evaluator 路径）**: `sprints/tests/ws1/echo.test.js`（generator TDD red-green 用，evaluator 不读）

---

## Workstream 切分硬规则自查

- 净增 < 200 行（仅改 server.js 约 5 行）→ `workstream_count=1` ✓

---

## Test Contract

| Workstream | DoD 文件 / Evaluator 路径 | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `contract-dod-ws1.md` [BEHAVIOR]×5（manual:bash 内嵌命令） | msg 字段值、schema 完整性、禁用字段 echo 反向、空字符串、400 error path | 修复前所有 5 条 manual:bash 命令 exit 1（playground 仍返 `{"echo":"hello"}`） |

> **注**：`sprints/tests/ws1/echo.test.js` 是 generator TDD red-green 参考测试，**不是** evaluator 执行路径。Evaluator 只执行 `contract-dod-ws1.md` 中各 [BEHAVIOR] 条目的 `Test: manual:bash` 命令。
