# Sprint PRD — 主理人对话回路 PR4/4：Stop Hook 硬闸 + Skill 规程 + cron 归档兜底

**Task ID**: 2a4ead8d-a979-48e6-b317-676129e45f6a
**Journey ID**: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
**PR 序列**: PR4/4（封闭对话回路完整交付，前置 PR1#4244/PR2#4253/PR3#4374 均已合并）

---

## 背景与现状快照

PR1-PR3 已落库：conversations/conversation_messages 表（migration 359）、conversations API、headless agent spawn/resume、Dashboard ConversationsPanel + GP 二级页、`turn_marker` 字段（`chat/pending_user/decision_saved=<uuid>`）。

**PR4 启动前现状**：

| 组件 | 现状 |
|------|------|
| `stop-conversation.sh` | 已存在：扫 transcript 提取 `decision_saved=<uuid>` → curl 对账，不存在→exit 2 |
| `stop.sh` | 已路由 `.conversation-mode`→`stop-conversation.sh`；非 conversation-mode 时内联 decision_saved 扫描 |
| `conversation-ttl-archiver.js` | 已存在：每 10min 归档 `ttl_expires_at < NOW()` 的 active/suspended 对话 |
| `tick.js` | 已注册 `conversation-ttl-archiver` job |
| Skill 规程（b） | **缺失**：对话 agent 专属 SKILL.md |
| `.conversation-mode` 锁文件 | **缺失**：stop.sh 的 `.conversation-mode` 路由分支永不触发 |
| `pending_user` block | **缺失**：stop-conversation.sh 未 block pending_user 标记 |
| TTL archiver 单测 | **缺失** |

---

## 交付物清单

**D1 — 对话 Agent Skill 规程**：新建 `packages/workflows/skills/conversation-agent/SKILL.md`，写死：用户显式确认→立即 `POST /api/brain/decisions` 落库并回复 `[TURN: decision_saved=<uuid>]`；确认建任务→POST tasks 建任务；会话收尾→写 `archived_summary` + 更新 status；每轮必落 `turn_marker`（chat/pending_user/decision_saved）。

**D2 — `.conversation-mode` 锁文件机制**：在 `conversation-agent.js` spawn 路径写入 `.conversation-mode`（内含 conversation_id），resolve/archive 时删除，使 stop.sh 路由分支真正触发。

**D3 — Stop Hook 硬闸强化**：`stop-conversation.sh` 补两个 block 分支：① 末轮 assistant 含 `[TURN: pending_user]` → exit 2；② `.conversation-mode` 存在但末轮无任何 `[TURN:...]` → exit 2。

**D4 — TTL archiver 单测**：新建 `packages/brain/src/__tests__/conversation-ttl-archiver.test.js`，断言：到期 active/suspended → archived；非到期 / 已终态 → 不变；gate 10min 内跳过。

---

## 协议标记行为表

| 末轮标记 | conversation-mode | Hook 行为 |
|---------|------------------|---------|
| `decision_saved=<uuid>`，DB 有记录 | 有/无 | 放行 |
| `decision_saved=<uuid>`，DB 无记录 | 有/无 | exit 2 |
| `pending_user` | 有 | exit 2（D3 新增） |
| 无标记 | 有 | exit 2（D3 新增） |
| 无标记 | 无 | 放行 |

---

## 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `packages/workflows/skills/conversation-agent/SKILL.md` | 新建（D1）|
| `packages/brain/src/conversation-agent.js` | 修改（D2：写/删 .conversation-mode）|
| `packages/engine/hooks/stop-conversation.sh` | 修改（D3：补 pending_user + 无标记 block）|
| `packages/brain/src/__tests__/conversation-ttl-archiver.test.js` | 新建（D4）|

---

## 验收（Final E2E，mac_web）

**E2E-1 decision_saved 对账**：构造含 `[TURN: decision_saved=<fake-uuid>]` 的伪 transcript + `.conversation-mode`，执行 `stop-conversation.sh` → exit 2；向 decisions 表插入记录后再执行 → exit 0。

**E2E-2 pending_user 阻断**：末轮含 `[TURN: pending_user]` 的 transcript + `.conversation-mode` → `stop-conversation.sh` exit 2，stdout 含"等待用户确认"。

**E2E-3 TTL archiver**：DB 插入 `ttl_expires_at = NOW()-1h, status='active'` 的 conversation → 调用 `runConversationTtlArchiver(pool)` → SELECT status = 'archived'。

**E2E-4 全流程（mac_web，localhost:5174）**：WarRoomLineCommandPage → 开对话 → 输入「确认决策 X」→ agent 回 `[TURN: pending_user]` → 输入「确定落库」→ 等 agent 回复（max 60s）→ 断言含 `[TURN: decision_saved=<uuid>]` → DB 验证 decisions 表存在该 uuid → 会话结束 hook exit 0。

---

## Invariant 约束

（来源：journey/ability/line 三源 + PR1-PR3 累积）

1. `conversations.journey_id` 外键约束真实 journeys.id，ConversationsPanel 不允许硬编码
2. `gp_id` 必须是真实 golden_path.id，后端校验不存在则 404
3. 所有 agent 调用必须经 `POST /api/brain/conversations/:id/messages` 走 `conversation-agent.js`，前端不得直接 spawn
4. `turn_count` 由后端写消息递增，前端只读
5. decisions 是唯一落库入口，`archived_summary` 只做摘要索引
6. `decision_saved=<uuid>` 声明与 decisions 落库之间不允许存在窗口期（原子性）
7. TTL archiver 只软归档（status→archived），不删行不删消息
8. 单 slot 串行，同时只允许一个任务在跑
9. secrets 不硬编码不进 git，聊天内容不明文进日志

---

## 累积 FR

| # | FR | 来源 | 状态 |
|---|----|------|------|
| 1 | conversations + conversation_messages 表 | PR1 #4244 | 已合并 |
| 2 | conversations CRUD API + 消息写入 | PR1 #4244 | 已合并 |
| 3 | headless agent spawn/resume | PR2 #4253 | 已合并 |
| 4 | ConversationsPanel + 状态 badge | PR3 #4374 | 已合并 |
| 5 | GP 二级页 WarRoomGoldenPathPage | PR3 #4374 | 已合并 |
| 6 | conversation-ttl-archiver cron 兜底 | 代码已存在 | PR4 补测试 |
| 7 | stop-conversation.sh decision_saved 对账 | 代码已存在 | PR4 强化 |
| 8 | Skill 规程层 conversation-agent SKILL.md | PR4 新建 | 本 PR |
| 9 | `.conversation-mode` 锁文件机制 | PR4 新建 | 本 PR |
| 10 | stop-conversation.sh pending_user/无标记 block | PR4 新增 | 本 PR |
| 11 | conversation-ttl-archiver 单测 | PR4 新增 | 本 PR |

---

## NFR

1. `stop-conversation.sh` 总执行时长 < 10s（curl timeout ≤ 8s，不阻断用户工作流）
2. TTL archiver gate：10min 内重复调用返回 `{skipped:true}`，无额外 DB 写入
3. Skill 规程独立文件，不内联代码，支持无需改代码迭代规程
4. 提交前清除 console.log，保留 Brain 侧 `[conversations]` 结构化日志

---

journey_type: user_facing
target_environment: mac_web
