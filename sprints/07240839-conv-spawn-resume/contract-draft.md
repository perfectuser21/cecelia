# Contract Draft — PR2：conversation-agent claude spawn/resume 调用层

**Sprint**：`sprints/07240839-conv-spawn-resume/`
**Task ID**：`1a03fbdf-53b5-4ad5-ab31-80fec8c4102c`
**PR 序号**：2/4（spawn/resume 调用层）
**起草日期**：2026-07-24

---

## 范围声明

本合同覆盖 PR2 的交付范围（续 PR1 #4244 已合并的 conversations 表/API 基础层）：

1. `packages/brain/src/lib/conversation-agent.js`：headless claude spawn/resume 调用 + 输出解析 + 协议标记解析
2. `packages/brain/src/routes/conversations.js`：POST /:id/messages 在 role=user 时接入真实 agent 调用

**明确排除**：Dashboard UI（属 PR3）；Stop Hook 硬闸执法 + cron TTL 归档（属 PR4）；session 健康度 rollover 触发逻辑（仅捕获返回的新 session_id，不主动触发）。

---

## 不变式确认

| 编号 | 描述 | 本 PR 实现方式 |
|------|------|---------------|
| I-3 | 第一条消息创建 session，后续通过 `claude --resume` 续接 | `invokeAgent`：`sessionId` 为空走首轮 spawn，非空走 `--resume` |
| I-4 | Agent 需实际 spawn（解除 PR1 阶段限制） | `spawnSync('claude', [...])` 真实调用 |
| I-7 | 对话禁止执行写动作 | system 锚定 prompt 明确约束"禁止 POST/PATCH/DELETE" |

---

## 功能约定

### conversation-agent.js

- `invokeAgent({ content, sessionId, journeyId, gpId })`：`sessionId` 为空 → spawn 新会话，prompt 内嵌 journey_id/gp_id 锚点 + 只读工具约束 + `[TURN: ...]` 协议标记要求；`sessionId` 非空 → `--resume <sessionId>`，只传用户原始 `content`
- `parseAgentOutput(stdout)`：解析 `claude --output-format json` 的 stdout，取最后一个含 `result` 字段的 JSON 对象，返回 `{ reply, sessionId }`
- `parseTurnMarker(replyText)`：从回复文本提取 `[TURN: chat|decision_saved=<uuid>|pending_user]`，无标记返回 `null`

### conversations.js 改动

- `POST /:id/messages`：conversation 存在性查询顺带取 `journey_id`/`gp_id`/`current_session_id`；role=user 时，turn_count 自增后调用 `invokeAgent`，assistant 回复写入 `conversation_messages`，`current_session_id` 写回

---

## E2E 验收

本 PR 无 Dashboard UI，验收为 Brain 启动后 API 调用可用性冒烟（需真实 claude CLI 可用）。

```bash
JOURNEY_ID=$(psql cecelia -t -c "SELECT id FROM journeys LIMIT 1;" | tr -d ' ')
CONV_ID=$(curl -s -X POST localhost:5221/api/brain/conversations \
  -H "Content-Type: application/json" -d "{\"journey_id\":\"$JOURNEY_ID\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

curl -s -X POST "localhost:5221/api/brain/conversations/$CONV_ID/messages" \
  -H "Content-Type: application/json" -d '{"role":"user","content":"你好"}'

# 预期：conversations.current_session_id 从 NULL 变为非空
psql cecelia -c "SELECT current_session_id FROM conversations WHERE id='$CONV_ID';"
```

---

## 边界与排除

- **本 PR 不实现**：Dashboard UI、Stop Hook 硬闸、cron TTL 归档、session rollover 主动触发
- **不引入新依赖**：仅用 Node 内置 `node:child_process`

---

## 风险确认

| 风险 | 处置 |
|------|------|
| claude CLI 不可用/未登录 | spawnSync 返回非 0 status，`parseAgentOutput` 对空/异常 stdout 降级返回空字符串，上层 500，不阻塞其他端点 |
| 单测消耗真实配额 | 单测全程 mock `node:child_process` 的 `spawnSync`，不做真实调用 |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| invokeAgent 首次调用 | `../../packages/brain/src/lib/__tests__/conversation-agent.test.js` | 首次调用：无 sessionId → spawn 参数不含 --resume，prompt 含 journey_id 锚点 | 模块不存在 → import 报错 → 全红 |
| invokeAgent 续接调用 | `../../packages/brain/src/lib/__tests__/conversation-agent.test.js` | 续接调用：有 sessionId → spawn 参数含 --resume <sessionId> | 模块不存在 → 全红 |
| parseAgentOutput 解析 | `../../packages/brain/src/lib/__tests__/conversation-agent.test.js` | 从 claude --output-format json 输出提取 result 文本 + session_id | 模块不存在 → 全红 |
| parseTurnMarker 解析 | `../../packages/brain/src/lib/__tests__/conversation-agent.test.js` | 解析 [TURN: chat] | 模块不存在 → 全红 |
