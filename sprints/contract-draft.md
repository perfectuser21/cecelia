# Sprint Contract Draft (Round 2) — B1 playground GET /subtract

> **PR-G 验收承诺**：本合同字段名严格字面照搬 PRD `## Response Schema` 段：
> - response success keys = `result` + `operation`（字面，**不许漂到 `difference`/`diff`/`value`/`answer`/`data` 等任一禁用名**）
> - operation 字面值 = `"subtract"`（**禁用变体 `difference`/`diff`/`sub`/`minus`**）
> - query param 字面名 = `a`/`b`（禁用 `x`/`y`/`p`/`q`/`n`/`m`/`v1`/`v2`）
> - schema 完整性：成功响应顶层 keys 字面集合完全等于 `["operation","result"]`
>
> **Proposer 自查 checklist（v7.5 + v7.12 死规则）**：
> 1. PRD success keys = {`result`, `operation`} ✓ contract jq -e 用 {`result`, `operation`} ✓
> 2. PRD operation 字面 = `"subtract"` ✓ contract jq -e `.operation == "subtract"` ✓
> 3. 禁用清单（`difference`/`diff`/`value`/`answer`/`data`）→ 仅在反向 `has("X") | not` ✓
> 4. PRD keys 完整性 = `["operation","result"]` ✓ contract `keys | sort == ["operation","result"]` ✓
> 5. BEHAVIOR count ≥ 4：ws1 共 6 条，覆盖 schema 字段值 / keys 完整性 / 禁用字段反向 / error path ✓
> 6. depends_on：ws1=[]（唯一 workstream）✓
> 7. 假绿自查：所有 BEHAVIOR 以 `curl -sf` 开头（404 → exit 1）；缺参 400 检查路由未实现返 404≠400 → FAIL ✓

---

## Golden Path

```
[HTTP 客户端发 GET /subtract?a=10&b=3]
  → [playground server STRICT_NUMBER regex 校验 a、b 存在且匹配 ^-?\d+(\.\d+)?$]
  → [计算 result = Number(10) - Number(3) = 7]
  → [返回 HTTP 200 {"result":7,"operation":"subtract"}，keys = ["operation","result"]]
```

---

### Step 1: 客户端发合法减法请求 → HTTP 200 + 正确 schema

**来源**: `[FROM_PRD]` — PRD 段落 "Golden Path（核心场景）" 第 1-3 步直接定义

**可观测行为**: GET /subtract?a=10&b=3 → HTTP 200，body `{result:7, operation:"subtract"}`，顶层 keys = `["operation","result"]`

**验证命令**:
```bash
PLAYGROUND_PORT=3301 NODE_ENV=production node playground/server.js > /tmp/b1-step1.log 2>&1 &
SPID=$!; sleep 2

RESP=$(curl -sf "http://localhost:3301/subtract?a=10&b=3") || { kill $SPID; echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }
echo "$RESP" | jq -e '.result == 7'                              || { kill $SPID; echo "FAIL: result != 7"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"'                  || { kill $SPID; echo "FAIL: operation != subtract"; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"'                || { kill $SPID; echo "FAIL: result 非 number 类型"; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]'     || { kill $SPID; echo "FAIL: keys 不合规"; exit 1; }

kill $SPID
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 200；`result === 7`；`operation === "subtract"`；`keys == ["operation","result"]`

---

### Step 2: 禁用响应字段反向验证

**来源**: `[FROM_PRD]` — PRD 段落 "Response Schema" 下 "禁用响应字段: difference/diff/value/answer/data"

**可观测行为**: 成功响应顶层不包含任何 PRD 禁用字段名

**验证命令**:
```bash
PLAYGROUND_PORT=3302 NODE_ENV=production node playground/server.js > /tmp/b1-step2.log 2>&1 &
SPID=$!; sleep 2

RESP=$(curl -sf "http://localhost:3302/subtract?a=10&b=3") || { kill $SPID; echo "FAIL: curl 非 200"; exit 1; }
for k in difference diff value answer data; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { kill $SPID; echo "FAIL: 禁用字段 $k 出现"; exit 1; }
done

kill $SPID
echo "✅ Step 2 通过"
```

**硬阈值**: 5 个 PRD 禁用字段均不存在于响应顶层

---

### Step 3: 缺参 → HTTP 400 + error 字段

**来源**: `[FROM_PRD]` — PRD 段落 "Response Schema" "Error (HTTP 400)"；"边界情况" "缺参 → 400"

**可观测行为**: 缺 a 或缺 b → HTTP 400，body `{error:"<string>"}`

**验证命令**:
```bash
PLAYGROUND_PORT=3303 NODE_ENV=production node playground/server.js > /tmp/b1-step3.log 2>&1 &
SPID=$!; sleep 2

CODE=$(curl -s -o /tmp/b1-err-a.json -w "%{http_code}" "http://localhost:3303/subtract?b=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺 a 应返 400，实际 $CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/b1-err-a.json || { kill $SPID; echo "FAIL: error 字段不存在"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3303/subtract?a=10")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺 b 应返 400，实际 $CODE"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3303/subtract")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 双缺参应返 400，实际 $CODE"; exit 1; }

kill $SPID
echo "✅ Step 3 通过"
```

**硬阈值**: HTTP 400；error 字段类型为 string

---

### Step 4: 非法格式（1e5/Inf/+1/0xFF）→ HTTP 400

**来源**: `[FROM_PRD]` — PRD 段落 "边界情况" "非法格式（1e5/Inf/+1/0xFF）→ 400"；Query Parameters strict `^-?\d+(\.\d+)?$`

**可观测行为**: 格式不符合 regex → HTTP 400

**验证命令**:
```bash
PLAYGROUND_PORT=3304 NODE_ENV=production node playground/server.js > /tmp/b1-step4.log 2>&1 &
SPID=$!; sleep 2

for bad in "a=1e5&b=3" "a=Inf&b=3" "a=%2B1&b=3" "a=0xFF&b=3"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3304/subtract?$bad")
  [ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: $bad 应返 400，实际 $CODE"; exit 1; }
done

kill $SPID
echo "✅ Step 4 通过"
```

**硬阈值**: 4 种非法格式全部返 HTTP 400

---

### Step 5: 结果为负数 → HTTP 200 正常返回

**来源**: `[FROM_PRD]` — PRD 段落 "边界情况" "结果负数（a=3,b=10 → -7）正常返回"

**可观测行为**: GET /subtract?a=3&b=10 → HTTP 200，`{result:-7, operation:"subtract"}`

**验证命令**:
```bash
PLAYGROUND_PORT=3305 NODE_ENV=production node playground/server.js > /tmp/b1-step5.log 2>&1 &
SPID=$!; sleep 2

RESP=$(curl -sf "http://localhost:3305/subtract?a=3&b=10") || { kill $SPID; echo "FAIL: curl 非 200"; exit 1; }
echo "$RESP" | jq -e '.result == -7'         || { kill $SPID; echo "FAIL: result 应为 -7"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 5 通过"
```

**硬阈值**: HTTP 200；result === -7

---

### Step 6: 零结果边界 a=b → HTTP 200 + result=0

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防 generator 把零结果当 falsy 误处理（返 400 或 NaN），确保 a=b 时有符号减法结果 0 正常返回 number 类型

**可观测行为**: GET /subtract?a=5&b=5 → HTTP 200，`{result:0, operation:"subtract"}`，result 为 number

**验证命令**:
```bash
PLAYGROUND_PORT=3306 NODE_ENV=production node playground/server.js > /tmp/b1-step6.log 2>&1 &
SPID=$!; sleep 2

RESP=$(curl -sf "http://localhost:3306/subtract?a=5&b=5") || { kill $SPID; echo "FAIL: curl 非 200"; exit 1; }
echo "$RESP" | jq -e '.result == 0'               || { kill $SPID; echo "FAIL: a=b=5 result 应为 0"; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; echo "FAIL: result 类型不是 number"; exit 1; }

kill $SPID
echo "✅ Step 6 通过"
```

**硬阈值**: HTTP 200；result === 0（number 类型）

---

## E2E 验收（final-e2e — target_environment: playground）

> playground sprint 例外：BEHAVIOR 命令使用 `node playground/server.js`（target_environment: playground）；final-e2e 不混用 Brain API localhost:5221。

**journey_type**: autonomous  
**target_environment**: playground

```bash
#!/bin/bash
# final-e2e — B1 playground GET /subtract Golden Path 端到端验证
set -e

PPORT=${PLAYGROUND_PORT:-3399}

PLAYGROUND_PORT=$PPORT NODE_ENV=production node playground/server.js > /tmp/b1-e2e.log 2>&1 &
SPID=$!
sleep 2

cleanup() { kill $SPID 2>/dev/null || true; }
trap cleanup EXIT

# Golden Path: GET /subtract?a=10&b=3 → {result:7, operation:"subtract"}
RESP=$(curl -sf "http://localhost:$PPORT/subtract?a=10&b=3") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.result == 7'                              || { echo "FAIL: result != 7"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"'                  || { echo "FAIL: operation != subtract"; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]'     || { echo "FAIL: keys 不合规"; exit 1; }

# 禁用字段反向
for k in difference diff value answer data; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "FAIL: 禁用字段 $k"; exit 1; }
done

# 缺参 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PPORT/subtract?b=3")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 a 应返 400，实际 $CODE"; exit 1; }

# 非法格式 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PPORT/subtract?a=1e5&b=3")
[ "$CODE" = "400" ] || { echo "FAIL: 非法格式应返 400，实际 $CODE"; exit 1; }

# 负数结果 → 200 + result=-7
RESP=$(curl -sf "http://localhost:$PPORT/subtract?a=3&b=10") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e '.result == -7' || { echo "FAIL: result 应为 -7"; exit 1; }

# 零结果 → 200 + result=0
RESP=$(curl -sf "http://localhost:$PPORT/subtract?a=5&b=5") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e '.result == 0' || { echo "FAIL: result 应为 0"; exit 1; }

echo "✅ B1 Golden Path E2E 全部通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground/server.js 新增 GET /subtract 路由 + playground/tests/server.test.js 新增 describe 块

**范围**: 在 `playground/server.js` 注册 `GET /subtract` 路由（复用已有 `STRICT_NUMBER` regex，校验 a/b 存在且合法，计算 `Number(a) - Number(b)`，返回 `{result: <number>, operation: "subtract"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /subtract', ...)` 块  
**大小**: M（server.js ~35 行 + tests ~80 行 = ~115 行净增，2 文件）  
**依赖**: 无（唯一 workstream）

**辅助回归测试**（Generator TDD red-green 用，不被 evaluator 当 verdict 来源）: `sprints/tests/ws1/subtract.test.ts`

---

## Workstreams 切分合规性

- ws_count=1：净增 ~115 行 < 200 行 ✓，2 文件 ≤ 3 ✓
- ws1 depends_on: []（唯一 workstream）✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/subtract.test.ts` | happy path / schema 完整性 / 禁用字段反向 / 缺参 400 / 缺 b 400 / 非法格式 400 / 负数结果 / 零结果 | 8 failures（`/subtract` 未实现，supertest 返 404）|

---

## Risks

### RISK-1: Bug 10 假绿回归风险（端口冲突导致 BEHAVIOR 命令 exit 0）

**描述**: 若 Generator 没有正确实现 `/subtract` 路由，但测试机器上已有进程占用 3401-3406 端口中某一端口（或上一次测试残留进程未 kill），`node playground/server.js` 在该端口静默启动失败，`curl -sf` 转而连到已存在进程的旧 handler，老路由返回 404 → `curl -sf` exit 1 → BEHAVIOR FAIL。但若旧进程碰巧返回 200（如同端口 Express 兼容响应），则 BEHAVIOR 假绿通过，Generator 不实现也能 PASS。

**缓解措施**:
1. 每条 BEHAVIOR 命令使用不同端口（3401-3406 分开），降低碰撞概率
2. 每条命令在 `kill $SPID` 后加 `sleep 1` 以确保端口释放
3. Evaluator 在跑 BEHAVIOR 前应先 `lsof -ti tcp:3401-3406 | xargs kill -9 2>/dev/null || true` 清空端口
4. Contract 验证命令用 `PLAYGROUND_PORT` 动态赋值，evaluator 可注入空闲端口

**残余风险**: 低。各 Step 端口已不同；假绿要求旧进程碰巧返回同格式 JSON，概率极低。

---

### RISK-2: Bug 11 结果文件缺失风险（Bash 工具未执行导致 Brain 读不到 verdict）

**描述**: Proposer 工具链要求最后一步必须向 `/workspace/.brain-result.json` 写入 JSON（`propose_branch` + `workstream_count` + `task_plan_path`）。若 Bash 工具调用被跳过（如 LLM 在 Step 4 仅写文本而未实际执行），Brain 读到空文件或旧轮次数据，`inferTaskPlan` 拿到错误 `propose_branch`，导致 GAN 合同无法传递给 Generator，整条 pipeline 静默断链。

**缓解措施**:
1. v7.12 已在 Step 4 强制要求"结果文件写入"作为独立 Bash 命令（不依赖前序 git push 成功与否）
2. Brain 侧 `harness-gan.graph.js` 在读 `.brain-result.json` 前校验文件 mtime（若超过 5 分钟未更新视为写入失败，触发重试）
3. 本 Round 2 合同已在 Step 4 之后立即执行 `.brain-result.json` 写入，并 `echo "[proposer] .brain-result.json 写入完成"` 作为可观测确认输出
4. Reviewer 在审查合同时应验证 Step 4 代码块含 `cat > /workspace/.brain-result.json` 写入命令（非仅 git push）

**残余风险**: 低。Bug 11（#3111）已在 v6.6.0 强制 Bash 工具写结果文件修复；本合同 Step 4 含写入命令。
