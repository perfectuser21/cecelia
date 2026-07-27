# Sprint PRD — PR3/4 主理人对话回路：Dashboard 对话栏 UI

**Task ID**: 496dceb8-0ded-4923-80e3-d5772af256a7  
**Sprint Dir**: sprints/07271849-relay-496dceb8  
**PR 系列**: PR3（共 4 个，PR4=Stop Hook+cron 归档独立任务）  
**优先级**: P1  
**目标环境**: mac_web（本机 Playwright，localhost:5174）  
**依赖 PR**:
- PR1: conversations API — https://github.com/perfectuser21/cecelia/pull/4244
- PR2: claude spawn/resume 调用层 — https://github.com/perfectuser21/cecelia/pull/4253

---

## 一、现状分析（代码已有什么）

### 已完成（PR1 + PR2 已合并）

| 层 | 文件 | 状态 |
|----|------|------|
| Brain API | `packages/brain/src/routes/conversations.js` | 已实现全套 REST：POST /conversations, GET /conversations, GET /:id, PATCH /:id, POST /:id/messages, GET /:id/messages, DELETE /:id |
| Agent 调用 | `packages/brain/src/lib/conversation-agent.js` | invokeAgent 已实现 spawn/resume 两态，turn_marker 协议已落库 |
| 前端（Line 页）| `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx` | `ConversationsPanel` 已存在（第 412-648 行），嵌在第 4 栏（第 810 行），能列议题/开新对话/发消息/轮询拉取回复 |

### PR3 的真实交付缺口

经代码审查，Line 页对话面板主体已经存在，但以下 4 个细节 **尚未实现**：

1. **议题状态徽章（active/resolved/挂起）**：列表卡片只显示标题和 turn_count，缺状态颜色徽章
2. **实时等待体验**：发消息后只有 "military 思考中…" 文字，缺轮询自动刷新（当前 sendMessage 只调一次 fetchMessages，不重试直到 assistant 消息出现）
3. **GP 二级页对话框**：`/warroom/gp/:id` 路由不存在，无法从 Line 页点刀列表进 GP 页并带 gp_id 注水到对话
4. **移动端 Tailscale 可用性**：viewport/overflow 未针对小屏适配

---

## 二、交付物（Deliverables）

### D1 — 议题列表状态徽章

**文件**: `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx`

- conversations 列表卡片新增状态徽章，颜色映射：
  - `active` → 蓝色 `bg-blue-500/20 text-blue-400`
  - `resolved` → 绿色 `bg-green-500/20 text-green-400`
  - `suspended`（挂起）→ 黄色 `bg-amber-500/20 text-amber-400`
- 徽章显示文案：`进行中` / `已解决` / `挂起`
- 标准：conversations GET 响应已含 `status` 字段，前端读取即可

### D2 — 消息发送后轮询等待 assistant 回复

**文件**: `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx`

- `sendMessage()` 发出 `POST /:id/messages` 后，开始轮询 `GET /:id/messages`
- 每 1.5s 检查一次，最多 30s（20 次），检测到新 assistant 消息则停止
- 轮询期间 "军师思考中…" 气泡持续显示，stopping 后移除
- 超时（30s 无 assistant 消息）显示 "军师暂无回复，请稍后重试"

### D3 — GP 二级页对话框

**新文件**: `apps/dashboard/src/pages/warroom/WarRoomGPPage.tsx`  
**路由**: `/warroom/gp/:gpId`（需在 App.tsx DynamicRouter 或路由配置中注册）

- 从 `connections.features`（或 AdvancementItem 中 ability_id）点击进入
- 页面布局：左栏展示 GP 基本信息（从 `/api/brain/warroom/line/:lineId/command` 已有的 connections 数据提取，或新建 `/api/brain/warroom/gp/:gpId` 简单端点），右栏嵌入 `ConversationsPanel`
- `ConversationsPanel` 用 `journeyId`（从 URL state 或 query param 传入）+ `gpId` 调用，创建对话时自动注入 `gp_id`
- 导航入口：在 `ConnectionsPanel` 内 Feature 行右侧加 `→` 按钮，`navigate('/warroom/gp/:id', { state: { lineId, journeyId } })`

### D4 — 移动端适配（Tailscale 可用）

**文件**: `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx`

- 四栏 grid 在小屏（`< lg`）时改为 tabs 切换（`军师决策 / 全景图 / 健康度 / 议题`）
- 或最低保障：第 4 栏（对话栏）在 `< lg` 时独占一页，其余三栏合并 scroll
- 输入框 `min-height: 44px`，符合移动端触控最低目标

---

## 三、API 端点（已有，无需新增）

| 操作 | 端点 | 状态 |
|------|------|------|
| 创建 conversation | POST /api/brain/conversations | 已实现（PR1） |
| 列议题 | GET /api/brain/conversations?journey_id=&gp_id= | 已实现（PR1） |
| 发消息 + 触发 agent | POST /api/brain/conversations/:id/messages | 已实现（PR1+PR2） |
| 拉消息列表 | GET /api/brain/conversations/:id/messages | 已实现（PR1） |
| 更新议题状态 | PATCH /api/brain/conversations/:id | 已实现（PR1） |

**GP 页可能需要新增**（评估 D3 实现时确认）：
- `GET /api/brain/warroom/gp/:gpId` — 返回 GP 名称/状态/所属 journey_id；若现有 `/warroom/line/:id/command` 的 connections 数据已够用则跳过

---

## 四、Final E2E 验收（mac_web，Playwright）

**路径**: `packages/quality/` 或 `apps/dashboard/test/e2e/`

### 场景 A：主流程（强制通过）

```
1. 浏览器打开 /pipeline
2. 点击某 Line → 进入 /warroom/line/:id
3. 右侧第 4 栏可见"议题对话"面板和"新对话"按钮
4. 点击"新对话" → 对话框切换到 detail 视图
5. 在输入框输入质疑文案（内容包含数据库中已有 decision 的 topic 关键词）
6. 点击"发"或 Enter 发送
7. 等待最多 30s，出现 assistant 气泡
8. 断言：assistant 回复中包含该 decision 的真实 topic 文字（证明 agent 真查了库）
9. 点击"← 返回"回到列表
10. 断言：列表中可见刚才的议题条目，状态徽章显示"进行中"
```

**DB 断言**：
```sql
SELECT id, status FROM conversations WHERE journey_id = '<test_journey_id>' ORDER BY created_at DESC LIMIT 1;
-- 期望：status = 'active'

SELECT role, content FROM conversation_messages WHERE conversation_id = '<conv_id>' ORDER BY created_at;
-- 期望：至少 2 行，role IN ('user', 'assistant')，assistant 内容非空
```

### 场景 B：GP 页对话框（D3 完成后）

```
1. 在 Line 指挥页 ConnectionsPanel 中点击某 Feature 的 → 按钮
2. 跳转到 /warroom/gp/:gpId
3. 右侧对话栏可见，创建新对话时 gp_id 自动注入
4. 发送消息 → 触发 agent，agent 回复中引用 gp 相关内容
```

**DB 断言**：
```sql
SELECT gp_id FROM conversations WHERE id = '<new_conv_id>';
-- 期望：gp_id = '<expected_gp_id>'（非 NULL）
```

### 场景 C：历史议题回访

```
1. 先运行场景 A 创建一条议题
2. 刷新页面
3. 断言：议题列表仍可见历史议题（持久化）
4. 点击历史议题 → 消息记录完整还原
```

---

## 五、DoD（完成标准）

- [ ] D1 状态徽章：列表卡片显示 active/resolved/suspended 颜色徽章
- [ ] D2 轮询：发送后自动拉取 assistant 回复，超时提示
- [ ] D3 GP 页：路由 `/warroom/gp/:gpId` 存在，ConversationsPanel 含 gp_id 注水
- [ ] D4 移动端：`< lg` 屏有可用的对话栏访问路径
- [ ] 场景 A E2E 通过（mac_web，Playwright）
- [ ] 场景 C E2E 通过（历史议题回访）
- [ ] 无 console.error，无 TypeScript 报错
- [ ] CI（workspace-ci.yml）绿

---

## 六、不含内容（范围边界）

- PR4（Stop Hook + cron 归档）：独立任务，不在本 PR
- 用户登录/鉴权：现有页面无登录门槛，保持不变
- SSE 实时推送：当前用轮询实现；SSE 升级留 PR4 或后续
- decision 自动落库：conversation-agent 内部逻辑已处理（turn_marker=decision_saved），前端无需额外代码

---

## 七、关键文件路径

| 文件 | 说明 |
|------|------|
| `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx` | Line 指挥页 + ConversationsPanel（主修改点 D1/D2/D4） |
| `apps/dashboard/src/pages/warroom/WarRoomGPPage.tsx` | 新建 GP 二级页（D3） |
| `apps/dashboard/src/App.tsx` | 注册 `/warroom/gp/:gpId` 路由（D3） |
| `packages/brain/src/routes/conversations.js` | conversations API（只读参考，无需修改） |
| `packages/brain/src/lib/conversation-agent.js` | agent 调用层（只读参考，无需修改） |

---

*生成时间: 2026-07-27 | 任务: 496dceb8 | 版本: v1*
