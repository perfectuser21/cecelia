# Sprint PRD — B39 验证重跑：evaluator verdict + playground /echo {msg}

## OKR 对齐

- **对应 KR**：N/A（Brain API 不可达，跳过 OKR 关联）
- **当前进度**：N/A
- **本次推进预期**：端对端验证 B39 evaluator 修复在真实 harness 流程中正常工作

## 背景

B39 修复已合并（#2968）：evaluator verdict 归一化（FIXED/APPROVED→PASS）、去掉 --auto 标志、移除 LLM_RETRY。
playground /echo 已在 #2966 实现，但当前返回 `{"echo": msg}`，thin_prd 要求 `{"msg": "hello"}`，schema 不符。
本 sprint 修正 /echo schema，作为 harness 端对端验证载体，确认 B39 修复正确生效。

## Golden Path（核心场景）

系统从 [harness 启动 playground + 运行 evaluator] → 经过 [evaluator 输出 FIXED 或 APPROVED] → 到达 [harness 识别为 PASS，merge 无 --auto 错误，无并发容器爆炸]

具体：
1. `playground/server.js` 的 GET /echo?msg=hello 返回 `{"msg": "hello"}`
2. harness 运行 evaluator，检查 /echo 端点响应是否符合 schema
3. evaluator 输出 FIXED 或 APPROVED
4. harness 将 FIXED/APPROVED 归一化为 PASS（B39 修复验证点）
5. PR merge 流程无 --auto 标志错误（B39 修复验证点）
6. 全程只启动一个 playground 实例，无多余容器（无并发爆炸，B39 验证点）

## Response Schema

### Endpoint: GET /echo

**Query Parameters**:
- `msg` (string, 必填): 待回显的消息内容，允许空字符串
- **禁用 query 名**: `text`, `input`, `message`, `q`, `str`, `value`, `content`, `m`, `s`, `echo`
- **强约束**: generator 必须字面用 `msg` 作为 query param 名

**Success (HTTP 200)**:
```json
{"msg": "hello"}
```
- `msg` (string, 必填): 与 query param `msg` 值完全相同（包括空字符串）
- **禁用 key 名**: `echo`, `message`, `result`, `response`, `data`, `output`, `text`, `reply`, `body`

**Schema 完整性**: response 顶层 keys 必须**完全等于** `["msg"]`，不允许多余字段

## 边界情况

- `msg=`（空字符串）→ `{"msg": ""}` 非 null、非 undefined
- evaluator 输出任意大小写 FIXED / APPROVED → harness 识别为 PASS
- 单次 harness 运行只启动一个 playground 进程

## 范围限定

**在范围内**：
- `playground/server.js` 修复 GET /echo 响应字段：`echo` → `msg`
- 端对端验证 evaluator verdict 归一化（FIXED/APPROVED → PASS）
- 验证 merge 无 --auto 标志错误

**不在范围内**：
- 新增其他 playground 端点
- 修改 evaluator 核心逻辑（B39 已完成）
- CI 流程大改

## 假设

- [ASSUMPTION: Brain API 不可达，OKR 关联跳过]
- [ASSUMPTION: B39 evaluator 归一化逻辑已在 #2968 合并，本 sprint 只做验证]

## 预期受影响文件

- `playground/server.js`: 修复 /echo 响应字段 `echo` → `msg`

## E2E 验收

```bash
# ✅ 启 playground + 测自己的端点（不使用 Brain 端口 5221）
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2

# 验证 /echo 响应 schema
curl -f localhost:3001/echo?msg=hello | jq -e '.msg == "hello"'

# 验证空字符串边界
curl -f "localhost:3001/echo?msg=" | jq -e '.msg == ""'

kill $SPID
echo "✅ playground /echo {msg} 验证通过"
```

## journey_type: dev_pipeline
## journey_type_reason: 主要目标是验证 harness evaluator B39 修复的端对端行为，playground /echo 作为测试载体
