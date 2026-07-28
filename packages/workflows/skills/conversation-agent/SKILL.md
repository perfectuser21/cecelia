# conversation-agent Skill 规程

**Skill ID**: conversation-agent
**Journey Type**: user_facing
**Task ID 关联**: 2a4ead8d-a979-48e6-b317-676129e45f6a（PR4/4 对话回路收尾）

---

## 角色定义

本 skill 定义主理人对话 agent（headless claude）在一次对话会话中的行为规程。
agent 以"线上军师"角色接入，协助主理人在 journey 范围内完成决策形成与落库。

---

## 协议标记（turn_marker）规程

每一轮 assistant 回复的末尾**必须**打一个协议标记（turn_marker），三选一：

| 标记 | 语义 | 触发条件 |
|------|------|---------|
| `[TURN: chat]` | 纯聊天，无待落库结论 | 信息传递、澄清、追问 |
| `[TURN: decision_saved=<uuid>]` | 用户已确认，decision 已落库 | 用户明确说"就这么办/确认"后，POST /api/brain/decisions，标记返回 id |
| `[TURN: pending_user]` | 已抛出问题或选项，等用户拍板 | agent 提出方案/选项，等待用户回应 |

**铁律**：
- 禁止无 turn_marker 退出对话（stop hook 会检测并 block）
- decision_saved 必须在 decisions 表真实落库后才可标记（stop hook 对账，未落库 → exit 2）
- pending_user 标记后，stop hook 会阻断会话退出（exit 2），强制等待用户确认

---

## 生命周期钩子

### spawn（首次建立对话）

1. `conversation-agent.js` 调用 `spawnConversationAgent({ conversationId, workDir })`
2. 在 `workDir` 下写入 `.conversation-mode` 文件（内含 conversation_id）
3. 调用 `claude -p <prompt> --output-format json`（首轮含 journey_id/gp_id 锚点）
4. 锁文件存在 → stop.sh 路由到 stop-conversation.sh（协议对账硬闸激活）

### resolve / archive（对话结束）

1. `resolveConversation({ conversationId, workDir })` 或 `archiveConversation({ conversationId, workDir })`
2. 删除 `workDir` 下的 `.conversation-mode` 文件
3. 锁文件删除 → stop.sh 不再路由到 stop-conversation.sh（硬闸失活）

---

## Stop Hook 行为（stop-conversation.sh）

| 场景 | exit code | 说明 |
|------|-----------|------|
| 无 `.conversation-mode` 文件 | 0 | 不在对话模式，直接放行 |
| transcript 文件不存在/为空 | 0 | 无法解析，放行（宽容策略） |
| 末轮含 `[TURN: chat]` | 0 | 纯聊天轮，放行 |
| 末轮含 `[TURN: decision_saved=<uuid>]`，且 decisions 表有该 uuid | 0 | 决策已落库，放行 |
| 末轮含 `[TURN: decision_saved=<uuid>]`，但 decisions 表无该 uuid | 2 | 未落库，阻断（强制补落库重试） |
| 末轮含 `[TURN: pending_user]` | 2 | 等待用户确认，阻断退出 |
| `.conversation-mode` 存在但末轮无任何 `[TURN:...]` 标记 | 2 | 防止 agent 静默退出，阻断 |

---

## 决策落库规程（decisions）

用户显式确认（"就这么办"/"确认"）后，agent 必须：

1. 调用 `POST /api/brain/decisions`，写入 decisions 表
2. 取返回的 `id`（UUID v4）
3. 在当轮末尾打 `[TURN: decision_saved=<uuid>]`
4. stop hook 对账：curl GET `/api/brain/decisions/<uuid>` → 200 → 放行

**禁止**：
- 仅口头说"已记录"而未真实 POST decisions
- 标记错误的 uuid（非本轮落库的 decision id）
- 在用户未明确确认前打 decision_saved 标记

---

## 约束与边界

- agent **只读权限**：只能 GET Brain API，不可 POST/PATCH/DELETE（写入由后端流程执行）
- 锚点注入：首轮 prompt 含 `journey_id` + `gp_id`（如有），续接轮不重复注入
- 每轮回复长度建议：≤ 800 字（用户体验约束）
- 对话 TTL：由 `conversation-ttl-archiver.js` 每 10 分钟扫描，到期 active/suspended → archived

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `packages/brain/src/lib/conversation-agent.js` | spawn/resolve/invokeAgent 实现 |
| `packages/engine/hooks/stop-conversation.sh` | Stop Hook 协议对账硬闸 |
| `packages/engine/hooks/stop.sh` | Stop Hook 路由器（含 .conversation-mode 路由） |
| `packages/brain/src/conversation-ttl-archiver.js` | TTL 到期归档调度器 |
| `packages/brain/src/__tests__/conversation-ttl-archiver.test.js` | TTL archiver 单测 |
