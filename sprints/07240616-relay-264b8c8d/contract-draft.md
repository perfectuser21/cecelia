# Contract Draft — PR1：对话会话基础层

**Sprint**：`sprints/07240616-relay-264b8c8d/`
**Task ID**：`264b8c8d-aad6-4f1c-84d1-274880beb3da`
**PR 序号**：1/4（基础层）
**起草日期**：2026-07-23

---

## 范围声明

本合同覆盖 PR1 的交付范围：

1. Migration 359：`conversations` 表 + `conversation_messages` 表
2. Brain API：`/api/brain/conversations` 路由（7 个端点）
3. `packages/brain/server.js` 路由注册
4. Jest 单测骨架（mock pool，不依赖真实 DB）

**明确排除**：claude spawn / headless agent 调用（属 PR2）；Dashboard UI（属 PR3）；Stop Hook / cron 归档（属 PR4）。

---

## 不变式确认（来自 PRD）

| 编号 | 描述 | 本 PR 实现方式 |
|------|------|---------------|
| I-1 | conversations 必须有 journey_id（必填）+ gp_id（可选） | migration 字段 + API 校验 |
| I-2 | conversation 是"议题/魂"，session 是"转录容器/壳"，二者解耦 | current_session_id 单独字段，不与 conversation.id 耦合 |
| I-3 | 第一条消息创建 session，后续通过 `claude --resume` 续接 | PR1 仅建数据骨架，字段预留 |
| I-4 | PR1 阶段 Agent 未实际 spawn | API 不调用任何 claude 命令 |
| I-5 | decisions 是唯一落库入口，conversations 只存过程 | related_decision_ids UUID[] 引用，不复制 decisions 内容 |
| I-6 | status 枚举：active/resolved/suspended/archived | CHECK 约束 + API 层校验 |
| I-7 | 对话禁止执行写动作 | PR1 API 文档层约束，无写动作端点 |

---

## 功能约定

### Migration 359

**文件**：`packages/brain/migrations/359_conversations.sql`

#### conversations 表

| 字段 | 类型 | 约束 |
|------|------|------|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() |
| journey_id | UUID | NOT NULL REFERENCES journeys(id) |
| gp_id | UUID | REFERENCES golden_path(id)，可为空 |
| title | VARCHAR(200) | 可为空 |
| status | VARCHAR(20) | NOT NULL DEFAULT 'active'，CHECK IN ('active','resolved','suspended','archived') |
| current_session_id | TEXT | 可为空 |
| session_compact_count | INT | NOT NULL DEFAULT 0 |
| turn_count | INT | NOT NULL DEFAULT 0 |
| ttl_expires_at | TIMESTAMPTZ | 可为空 |
| archived_summary | TEXT | 可为空 |
| related_decision_ids | UUID[] | 可为空 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

索引：journey_id、gp_id（partial WHERE NOT NULL）、status、ttl_expires_at（partial WHERE status='active'）

#### conversation_messages 表

| 字段 | 类型 | 约束 |
|------|------|------|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() |
| conversation_id | UUID | NOT NULL REFERENCES conversations(id) ON DELETE CASCADE |
| role | VARCHAR(20) | NOT NULL CHECK IN ('user','assistant','system') |
| content | TEXT | NOT NULL |
| turn_marker | TEXT | 可为空 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

索引：(conversation_id, created_at ASC)

**幂等性要求**：所有 CREATE TABLE 语句使用 `IF NOT EXISTS`，所有 CREATE INDEX 使用 `IF NOT EXISTS`。

### API 端点约定

#### POST /api/brain/conversations

- 必填：`journey_id`（UUID 格式）
- 可选：`gp_id`、`title`、`ttl_hours`（默认 24）
- 成功：201 + conversation 对象（含 id、status="active"、turn_count=0）
- journey_id 缺失或格式错误：400
- journey_id 不存在于 journeys 表（外键约束失败）：404
- gp_id 不存在于 golden_path 表：404

#### GET /api/brain/conversations

- 必填参数：`journey_id`
- 可选参数：`gp_id`、`status`（默认 active+suspended）、`limit`（默认 20）
- 成功：200 + `{ conversations: [...], total: N }`
- 每条包含 `last_message`（最近消息前 120 字符）、`last_message_at`、`related_decision_count`

#### GET /api/brain/conversations/:id

- 成功：200 + 完整 conversation 对象 + `messages`（最近 50 条 ASC）+ `decisions`（related_decision_ids 查询结果）
- 不存在：404

#### PATCH /api/brain/conversations/:id

- 支持字段：`status`、`current_session_id`、`title`、`session_compact_count`、`archived_summary`、`related_decision_ids`、`ttl_expires_at`
- status 非枚举值：400
- 更新时自动写入 `updated_at`

#### POST /api/brain/conversations/:id/messages

- 必填：`role`（user|assistant|system）、`content`
- 可选：`turn_marker`
- 成功：201 + message 对象
- role=user 时 conversation.turn_count 自增 +1
- conversation 不存在：404
- role 非枚举值：400

#### GET /api/brain/conversations/:id/messages

- 可选参数：`limit`（默认 50）、`before`（message_id 游标，用于翻页）
- 成功：200 + `{ messages: [...], has_more: bool }`，按 created_at ASC

#### DELETE /api/brain/conversations/:id（可选，范围内如实现）

- 软删除：将 status 更新为 'archived'，不物理删除
- 成功：200

### server.js 路由注册

在 `packages/brain/server.js` 靠近 warroom/strategic-decisions 路由区段注册：

```js
import conversationsRoutes from './src/routes/conversations.js';
app.use('/api/brain/conversations', conversationsRoutes);
```

---

## E2E 验收

本 PR 无 Dashboard UI，验收形式为 Brain 启动后 API 可用性冒烟。

### 前提条件

- Brain 服务运行于 `localhost:5221`
- 数据库 `cecelia` 已存在且 Brain 启动时 migration 359 自动执行
- 已有至少一条 `journeys` 表记录可用（JOURNEY_ID）

### 步骤 1：获取真实 journey_id

```bash
JOURNEY_ID=$(psql cecelia -t -c "SELECT id FROM journeys LIMIT 1;" | tr -d ' ')
echo "使用 journey_id: $JOURNEY_ID"
```

### 步骤 2：验证表结构存在

```bash
psql cecelia -c "\d conversations" | grep -E "journey_id|status|turn_count|session_compact_count"
psql cecelia -c "\d conversation_messages" | grep -E "role|content|turn_marker"
```

预期：所有关键列存在，无报错。

### 步骤 3：创建 conversation

```bash
CONV_RESP=$(curl -s -w "\n%{http_code}" -X POST localhost:5221/api/brain/conversations \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\"}")
HTTP_CODE=$(echo "$CONV_RESP" | tail -1)
CONV_BODY=$(echo "$CONV_RESP" | head -1)
echo "HTTP 状态码: $HTTP_CODE"  # 预期 201
echo "响应体: $CONV_BODY"
CONV_ID=$(echo "$CONV_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "conversation id: $CONV_ID"
```

预期：HTTP 201，响应含 `id`、`status: "active"`、`turn_count: 0`。

### 步骤 4：POST message，验证 turn_count 自增

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/conversations/$CONV_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"测试消息"}'
# 预期 201

CONV_DETAIL=$(curl -s "localhost:5221/api/brain/conversations/$CONV_ID")
echo "$CONV_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); print('turn_count:', d['turn_count'])"
# 预期 turn_count: 1
```

### 步骤 5：GET 列表验证

```bash
curl -s "localhost:5221/api/brain/conversations?journey_id=$JOURNEY_ID" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('total:', d['total'], 'conversations:', len(d['conversations']))"
# 预期：total ≥ 1，conversations 数组非空
```

### 步骤 6：异常校验

```bash
# 缺失 journey_id → 400
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/conversations \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期 400

# 无效 status → 400
curl -s -o /dev/null -w "%{http_code}" -X PATCH "localhost:5221/api/brain/conversations/$CONV_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"invalid_status"}'
# 预期 400
```

### 步骤 7：Jest 单测

```bash
cd /workspace
npx vitest run packages/brain/src/routes/__tests__/conversations.test.js
# 预期：全绿，无 failing test
```

---

## 边界与排除

- **本 PR 不实现**：headless agent spawn、claude --resume 实际调用、Dashboard UI、Stop Hook、cron 归档
- **不引入新依赖**：使用现有 express + pg pool 模式
- **migration 失败不阻塞 Brain 启动**：migrate.js 已有 try-catch

---

## 风险确认

| 风险 | 处置 |
|------|------|
| related_decision_ids UUID[] 查询性能 | PR1 数据量小，GIN 索引在 PR4 按需加 |
| golden_path 表是否存在 | migration 294 已确认定义，PR1 安全引用 |
| migration 序号冲突 | migration 358 已落库，359 是下一个，安全 |
| current_session_id 无 UNIQUE 约束 | 正确设计，同一 session_id 在不同 conversation 间不应共用 |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| POST /conversations 创建 | `../../packages/brain/src/routes/__tests__/conversations.test.js` | 201 + status=active + turn_count=0 / 缺失 journey_id → 400 / journey_id 不存在于 journeys 表 → 404 | 路由文件不存在 → 全红 |
| POST /:id/messages turn_count | `../../packages/brain/src/routes/__tests__/conversations.test.js` | role=user → 201 + turn_count 自增 1 / role=assistant → 201，turn_count 不自增 | 路由文件不存在 → 全红 |
| PATCH status 枚举校验 | `../../packages/brain/src/routes/__tests__/conversations.test.js` | 无效 status → 400 | 路由文件不存在 → 全红 |
| GET 列表/单条 | `../../packages/brain/src/routes/__tests__/conversations.test.js` | 按 journey_id 返回 conversations 数组 + total / 返回 conversation + messages 数组 + decisions 数组 | 路由文件不存在 → 全红 |
