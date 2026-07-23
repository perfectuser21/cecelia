# Sprint PRD — PR1：对话会话基础层

**Sprint 目录**：`sprints/07240616-relay-264b8c8d/`
**Task ID**：`264b8c8d-aad6-4f1c-84d1-274880beb3da`
**Base Repo**：cecelia
**PR 序号**：1/4（基础层）

---

## 0. 背景与范围

军师对话系统（relay-264b8c8d）分 4 个 PR 交付。本 PR 是纯后端基础层，目标是把"对话生命周期"的数据骨架和 API 接口跑通，不碰 Dashboard UI。

后续 PR 分工预期：
- PR2：headless claude agent 会话启动 + 工具白名单注入（spawn 改造）
- PR3：Dashboard 对话栏 UI（WarRoomLineCommandPage 旁挂 ConversationPanel）
- PR4：沉淀机制（Stop Hook 硬闸 + cron 归档 + 晨报接线）

本 PR 交付：DB schema + Brain API 端点 + 基础数据模型验证。

---

## 1. 不变式（Invariants）

| # | 描述 |
|---|------|
| I-1 | conversations 表必须有 journey_id（必填）和 gp_id（可选），坐标体系复用 S2 锚点 |
| I-2 | conversation 是"议题/魂"，session 是"转录容器/壳"——二者解耦，conversation.id 跨 session 连续 |
| I-3 | 每条用户消息不 spawn 新 claude 会话，第一条消息创建 session 并持久化 session_id，后续轮次通过 `claude --resume <session_id>` 续接 |
| I-4 | PR1 阶段 Agent 未实际 spawn（仅建立数据骨架），API 对 status 的语义约束在代码层强制 |
| I-5 | decisions 表是唯一落库入口，conversations 表只存对话过程；结论写 decisions，不写 conversations.history |
| I-6 | conversations 表 status 枚举：`active` / `resolved` / `suspended` / `archived`，不可扩展为自由文本 |
| I-7 | 对话禁止执行任何写动作，显式确认后才允许写 decisions/建任务——PR1 阶段在 API 文档和响应结构中约束，PR2 阶段 agent prompt 层面强制 |

---

## 2. 需求（Functional Requirements）

### 2.1 Migration 359：conversations 表

新建文件 `packages/brain/migrations/359_conversations.sql`

```sql
-- 字段说明

conversations (
  id              UUID PK
  journey_id      UUID NOT NULL REFERENCES journeys(id)   -- 必填：议题属于哪条 Line
  gp_id           UUID REFERENCES golden_path(id)         -- 可选：聚焦到具体一刀 GP
  title           VARCHAR(200)                            -- 议题标题（agent 生成或用户指定）
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK IN ('active','resolved','suspended','archived')
  current_session_id  TEXT                               -- 当前 claude session_id（claude --resume 用）
  session_compact_count  INT NOT NULL DEFAULT 0          -- 被 compact 次数（rollover 触发阈值）
  turn_count      INT NOT NULL DEFAULT 0                 -- 累计轮次
  ttl_expires_at  TIMESTAMPTZ                            -- idle TTL 到期时间
  archived_summary TEXT                                  -- 议题归档摘要（归档/挂起时写入）
  related_decision_ids UUID[]                            -- 本议题产生的 decisions（外键数组引用）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

-- 索引
idx_conversations_journey   ON conversations(journey_id)
idx_conversations_gp        ON conversations(gp_id) WHERE gp_id IS NOT NULL
idx_conversations_status    ON conversations(status)
idx_conversations_ttl       ON conversations(ttl_expires_at) WHERE status = 'active'
```

conversation_messages 表（消息流水）：

```sql
conversation_messages (
  id              UUID PK
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE
  role            VARCHAR(20) NOT NULL CHECK IN ('user','assistant','system')
  content         TEXT NOT NULL
  turn_marker     TEXT                    -- agent 结构化标记：[TURN: chat|decision_saved=<id>|pending_user]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

idx_conv_messages_conv_id  ON conversation_messages(conversation_id, created_at ASC)
```

**FR-1**：migration 必须幂等（IF NOT EXISTS 全覆盖），对已有库安全。

### 2.2 Brain API 端点

新建路由文件 `packages/brain/src/routes/conversations.js`，挂载路径 `/api/brain/conversations`。

**FR-2**：`POST /api/brain/conversations`

请求体：
```json
{
  "journey_id": "<UUID>",        // 必填
  "gp_id": "<UUID>",             // 可选
  "title": "string",             // 可选，不传则 null
  "ttl_hours": 24                // 可选，默认 24 小时，写入 ttl_expires_at
}
```

响应 201：
```json
{
  "id": "<UUID>",
  "journey_id": "<UUID>",
  "gp_id": null,
  "title": null,
  "status": "active",
  "current_session_id": null,
  "turn_count": 0,
  "ttl_expires_at": "<ISO>",
  "created_at": "<ISO>"
}
```

校验：journey_id 必填且 UUID 格式；journey_id 必须在 journeys 表存在（外键保障，失败返回 404）；gp_id 如传入必须在 golden_path 表存在。

**FR-3**：`GET /api/brain/conversations`

查询参数：`journey_id`（必填）、`gp_id`（可选）、`status`（可选，默认返回 active+suspended）、`limit`（默认 20）

响应 200：
```json
{
  "conversations": [
    {
      "id": "<UUID>",
      "journey_id": "<UUID>",
      "gp_id": null,
      "title": null,
      "status": "active",
      "current_session_id": null,
      "turn_count": 0,
      "ttl_expires_at": "<ISO>",
      "last_message": null,           // 最近一条消息摘要（conversation_messages 最新行 content 前120字符）
      "last_message_at": null,
      "related_decision_count": 0,
      "created_at": "<ISO>",
      "updated_at": "<ISO>"
    }
  ],
  "total": 1
}
```

**FR-4**：`GET /api/brain/conversations/:id`

响应 200：完整 conversation 对象 + `messages`（最近 50 条，按 created_at ASC）+ `decisions`（related_decision_ids 对应的 decisions 查询结果）。

**FR-5**：`PATCH /api/brain/conversations/:id`

支持字段：`status`、`current_session_id`、`title`、`session_compact_count`、`archived_summary`、`related_decision_ids`、`ttl_expires_at`

校验：status 只允许枚举值；current_session_id 更新时写入 updated_at。

**FR-6**：`POST /api/brain/conversations/:id/messages`

请求体：
```json
{
  "role": "user",               // 必填：user|assistant|system
  "content": "string",          // 必填
  "turn_marker": "[TURN: chat|pending_user]"  // 可选
}
```

响应 201：message 对象 + conversation 的 turn_count 自增（若 role=user 则 +1）。

**FR-7**：`GET /api/brain/conversations/:id/messages`

查询参数：`limit`（默认 50）、`before`（游标，message_id，用于翻页）

响应 200：`{ messages: [...], has_more: bool }`，按 created_at ASC 排序。

### 2.3 server.js 注册

在 `packages/brain/server.js` 中注册路由：

```js
import conversationsRoutes from './src/routes/conversations.js';
// ...
app.use('/api/brain/conversations', conversationsRoutes);
```

位置：跟 warroom/strategic-decisions 相邻的路由区段。

### 2.4 单元测试

新建测试文件 `packages/brain/src/routes/__tests__/conversations.test.js`（Jest）。

**FR-8**：至少覆盖以下 happy-path + error case：
- POST 创建 conversation，缺 journey_id 返回 400
- POST 传不存在 journey_id 返回 404
- GET 列表按 journey_id 过滤，返回正确 conversations
- GET 单条 conversation 带 messages
- PATCH 更新 status，枚举外的 status 返回 400
- POST message，turn_count 正确自增

**FR-9**：测试使用 pool mock（不要求真实 DB），但 SQL 语句结构必须对应实际 pg 语法。

---

## 3. 非功能性约束

- 所有端点响应时间 < 200ms（简单查询，无 LLM 调用）
- 端点日志：`[conversations] POST ...` 风格，失败必打 stack
- migration 失败不阻塞 Brain 启动（migrate.js 已有 try-catch，确保 conversations 表建表幂等）
- 禁止在本 PR 引入任何 claude spawn / headless agent 调用（那是 PR2 的工作）

---

## 4. 数据模型关系图

```
journeys (journey_id)
  └── conversations (多个议题)
        ├── golden_path (gp_id, 可选)
        ├── conversation_messages (消息流水)
        └── decisions[] (通过 related_decision_ids[] 引用)
```

**坐标对齐**：conversations.journey_id = journeys.id（Line 级别），conversations.gp_id = golden_path.id（GP 级别）——与 decisions 表现有 target_id/scope 体系坐标兼容，但本 PR 不改 decisions 表。

---

## 5. 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/brain/migrations/359_conversations.sql` |
| 新建 | `packages/brain/src/routes/conversations.js` |
| 新建 | `packages/brain/src/routes/__tests__/conversations.test.js` |
| 修改 | `packages/brain/server.js`（注册路由） |

---

## 6. 验收标准（DoD）

### Contract（技术断言）

**C-1**：`psql cecelia -c "\d conversations"` 输出包含列：id, journey_id, gp_id, title, status, current_session_id, session_compact_count, turn_count, ttl_expires_at, archived_summary, related_decision_ids, created_at, updated_at

**C-2**：`psql cecelia -c "\d conversation_messages"` 输出包含列：id, conversation_id, role, content, turn_marker, created_at

**C-3**：curl `POST /api/brain/conversations` 传合法 journey_id → 返回 201 + JSON 含 id、status=active、turn_count=0

**C-4**：curl `POST /api/brain/conversations` 传空 journey_id → 返回 400

**C-5**：curl `GET /api/brain/conversations?journey_id=<id>` → 返回 200 + conversations 数组

**C-6**：curl `POST /api/brain/conversations/:id/messages` body `{role:"user",content:"测试"}` → 返回 201，随后 GET conversation 的 turn_count=1

**C-7**：curl `PATCH /api/brain/conversations/:id` body `{status:"invalid"}` → 返回 400

**C-8**：Jest 单测全绿（npm test --filter conversations）

### Final E2E（人工验收，本 PR 范围）

由于 PR1 无 UI，验收形式为 Brain 起动后 API 可用性冒烟：

```bash
# Brain 重启后 migration 自动执行
curl -X POST localhost:5221/api/brain/conversations \
  -H "Content-Type: application/json" \
  -d '{"journey_id":"<某个真实 journey_id>"}'
# 预期：201 + id 字段存在

curl localhost:5221/api/brain/conversations?journey_id=<id>
# 预期：200 + conversations 数组含刚创建的条目
```

---

## 7. 累积 FR 数量

本 PR：9 条（FR-1 ~ FR-9）
Sprint 累积：9 条

---

## 8. 风险与注意事项

| 风险 | 缓解 |
|------|------|
| related_decision_ids UUID[] 查询性能 | 本 PR 仅 JOIN 查询，数据量小，GIN 索引在 PR4 按需加 |
| golden_path 表外键：golden_path.id 非 journeys.id | 已确认 migration 294 定义了 golden_path 表，外键 gp_id REFERENCES golden_path(id) |
| migration 顺序 | 358 已落库，359 是下一个，命名安全 |
| current_session_id 存 TEXT 不加 UNIQUE | 正确——同一个 claude session_id 在多个 conversation 中不应共用，但 session 可为空（PR1 阶段不 spawn） |
