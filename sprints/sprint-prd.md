# Sprint PRD — B41 验证：Phase C evaluator 读 origin/main 最新 playground/ 代码

## OKR 对齐

- **对应 KR**：N/A（Brain API 不可达，跳过 OKR 关联）
- **当前进度**：N/A
- **本次推进预期**：端对端验证 Phase C evaluator 读到 origin/main 最新 playground/ 后能正确校验 GET /echo 端点

## 背景

B41 修复了 Phase C evaluator 未从 origin/main 同步最新 playground/ 代码的问题（历史上 Phase C 用了旧快照，导致 /echo 端点缺失或 schema 错误）。本 sprint 验证该修复：harness Phase C evaluator 必须读到 `playground/server.js` 当前版本（含 `GET /echo`），并通过 `GET /echo?msg=hello → {msg:"hello"}` 验收。

## Golden Path（核心场景）

系统从 [harness 启动 Phase C evaluator] → 经过 [evaluator 从 origin/main 同步 playground/ 并启动服务] → 到达 [evaluator curl GET /echo?msg=hello，校验响应 {msg:"hello"}，输出 PASS]

具体：
1. Phase C evaluator 执行前从 origin/main 拉取最新 `playground/` 快照
2. 以当前 `playground/server.js` 启动服务（含 `GET /echo` 端点）
3. 执行 `curl localhost:$PLAYGROUND_PORT/echo?msg=hello`
4. 校验响应顶层 keys 完全等于 `["msg"]`，且 `msg === "hello"`
5. evaluator 输出 verdict PASS（或 APPROVED/FIXED 后归一化为 PASS）

## Response Schema

### Endpoint: GET /echo

**Query Parameters**:
- `msg` (string, 必填): 待回显的消息内容，允许空字符串
- **禁用 query 名**: `text`, `input`, `message`, `q`, `str`, `value`, `content`, `m`, `echo`
- **强约束**: 必须字面用 `msg` 作为 query param 名；缺失 `msg` 返回 HTTP 400

**Success (HTTP 200)**:
```json
{"msg": "hello"}
```
- `msg` (string, 必填): 与 query param `msg` 值完全相同（包括空字符串）
- **禁用 key 名**: `echo`, `message`, `result`, `response`, `data`, `output`, `text`, `reply`, `body`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```
- 必有 `error` key；禁用 `message`/`msg`/`reason` 替代

**Schema 完整性**: response 顶层 keys 必须**完全等于** `["msg"]`，不允许多余字段

## E2E 验收

```bash
# ✅ playground sprint e2e — 使用 playground 自己的端口，禁止使用 Brain 端口 5221
cd /workspace/playground
PLAYGROUND_PORT=3099 node server.js &
SPID=$!
sleep 2

# 核心验证：GET /echo?msg=hello → {msg:"hello"}
curl -sf "localhost:3099/echo?msg=hello" | jq -e '.msg == "hello"'

# 边界：空字符串
curl -sf "localhost:3099/echo?msg=" | jq -e '.msg == ""'

kill $SPID
echo "✅ GET /echo?msg=hello → {msg:\"hello\"} 验证通过"
```

## 边界情况

- `msg=`（空字符串）→ `{"msg": ""}` 合法（非 null/undefined）
- Phase C evaluator 必须从 origin/main 同步，不得用本地旧快照
- Phase C 只允许启动一个 playground 进程，无并发容器爆炸

## 范围限定

**在范围内**：
- 验证 `playground/server.js` 的 `GET /echo` 端点在 Phase C 评估中可被正确发现和调用
- 验证 Phase C evaluator 读取 origin/main playground/ 的同步行为（B41 修复点）

**不在范围内**：
- 修改 Brain API 路由或内部逻辑
- 新增其他 playground 端点
- 修改 evaluator 内部同步机制（仅验证，不实现）

## 假设

- [ASSUMPTION: playground/server.js 当前在 origin/main 上已含正确 GET /echo 实现，返回 {msg: <value>}]
- [ASSUMPTION: Phase C evaluator 同步机制已在 B41 中修复，本 sprint 仅做验证]
- [ASSUMPTION: Brain API 不可达，OKR 关联跳过]

## 预期受影响文件

- `playground/server.js`: 验证目标（GET /echo 端点，已实现，无需修改）
- `playground/tests/`: E2E 测试脚本落地位置

## journey_type: autonomous
## journey_type_reason: 纯后端 harness 验证流程，无 UI 交互，evaluator 自动从 origin/main 同步 playground/ 并 curl 校验
