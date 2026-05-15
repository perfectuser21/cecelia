# Sprint PRD — B42 验证重跑：完整 harness pipeline（Phase A→B→C）

## OKR 对齐

- **对应 KR**：N/A（Brain API 不可达，跳过 OKR 关联）
- **当前进度**：N/A
- **本次推进预期**：验证 B42 修复后 propose_branch mismatch 不再阻断 harness pipeline

## 背景

B42 修复已合并（#2972）：propose_branch mismatch 从 abort 改为 warn+fallback，buildProposerPrompt 注入确定性字面量分支名。
本 sprint 以 playground GET /abs 端点为载体，触发完整三阶段 harness pipeline（Phase A GAN → Phase B generator → Phase C evaluator），验证 mismatch 容错机制在真实流程中正确生效。

## Golden Path（核心场景）

系统从 [harness pipeline 启动，Brain 触发 Phase A Proposer GAN] → 经过 [Phase B generator 实现 /abs 端点，Phase C evaluator 验证响应 schema] → 到达 [pipeline 输出 DONE，全程无 propose_branch mismatch abort]

具体：
1. harness Phase A：planner PRD 传给 proposer，proposer GAN 产出 sprint 合同，propose_branch 注入字面量值
2. Phase A propose_branch 若发生 mismatch → 记录 warn 日志，fallback 继续，不 abort
3. harness Phase B：generator 在 `playground/server.js` 实现 GET /abs 端点
4. harness Phase C：evaluator 启动 playground，curl GET /abs?n=-5 → 验证响应 `{"result":5,"operation":"abs"}`
5. evaluator 输出 PASS/DONE，pipeline 记录 completed，无 abort 阻断

## Response Schema

### Endpoint: GET /abs

**Query Parameters**:
- `n` (number-as-string, 必填): 待取绝对值的数字（可为负数、零、正数）
- **禁用 query 名**: `num`, `value`, `x`, `input`, `number`, `val`, `a`, `v`
- **强约束**: generator 必须字面用 `n` 作为 query param 名；用错 query 名 endpoint 应返 400 或 NaN

**Success (HTTP 200)**:
```json
{"result": 5, "operation": "abs"}
```
- `result` (number, 必填): 输入数字的绝对值（`Math.abs(n)`），类型为 number 非 string
- `operation` (string, 必填): 字面量 `abs`，禁用变体 `absolute`/`absoluteValue`/`abs_value`/`op`/`method`
- **禁用响应字段名**: `value`/`answer`/`data`/`output`/`res`/`response`/`number`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason` 等替代

**Schema 完整性**: response 顶层 keys 必须**完全等于** `["result", "operation"]`，不允许多余字段

## 边界情况

- `n=-5` → `{"result":5,"operation":"abs"}`（负数正常取绝对值）
- `n=0` → `{"result":0,"operation":"abs"}`（零不变）
- `n=3` → `{"result":3,"operation":"abs"}`（正数不变）
- propose_branch mismatch 发生时 → 日志含 `[WARN]` 标记，pipeline 继续运行不 abort
- Phase A 到 Phase C 全程无 process.exit / throw 阻断

## 范围限定

**在范围内**：
- `playground/server.js` 新增 GET /abs 端点
- 完整运行 harness Phase A（planner+proposer GAN）→ Phase B（generator）→ Phase C（evaluator）
- 验证 propose_branch mismatch warn+fallback 机制（B42 验证点）

**不在范围内**：
- 修改 harness pipeline 核心逻辑（B42 已完成）
- 新增其他 playground 端点
- 修改 evaluator 判断逻辑

## 假设

- [ASSUMPTION: Brain API 不可达，OKR 关联跳过]
- [ASSUMPTION: B42 修复已在 #2972 合并，pipeline 代码已包含 warn+fallback]
- [ASSUMPTION: playground 目录可写，server.js 可正常扩展新端点]

## 预期受影响文件

- `playground/server.js`: 新增 GET /abs 端点实现

## E2E 验收

```bash
# ✅ 启 playground + 测 /abs 端点（不使用 Brain 端口 5221）
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2

# 验证负数
curl -f "localhost:3001/abs?n=-5" | jq -e '.result == 5 and .operation == "abs"'

# 验证零
curl -f "localhost:3001/abs?n=0" | jq -e '.result == 0 and .operation == "abs"'

# 验证正数
curl -f "localhost:3001/abs?n=3" | jq -e '.result == 3 and .operation == "abs"'

kill $SPID
echo "✅ playground /abs 验证通过"
```

## journey_type: dev_pipeline
## journey_type_reason: 主要目标是验证 harness pipeline B42 修复（propose_branch mismatch warn+fallback）在三阶段流程中正确生效，playground /abs 作为运行载体
