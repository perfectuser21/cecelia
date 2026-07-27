# Sprint PRD — 主理人对话回路 PR3/4：Dashboard 对话栏 UI

**Task ID**: 496dceb8-0ded-4923-80e3-d5772af256a7
**Sprint Dir**: sprints/07271849-relay-496dceb8
**Journey ID**: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
**PR 序列**: PR3/4（PR4 Stop Hook+cron 单独建任务）
**前置**: PR1 #4244（conversations API）、PR2 #4253（conversation-agent.js spawn/resume）均已合并

---

## 背景与现状快照

PR1/PR2 已落库：
- `conversations` + `conversation_messages` 两张表（migration 359）
- `GET/POST /api/brain/conversations`（支持 `journey_id`、`gp_id` 双维过滤）
- `POST /api/brain/conversations/:id/messages` 已接入 `conversation-agent.js` — headless claude spawn/resume，回复落库，`current_session_id` 写回
- 状态枚举：`active / resolved / suspended / archived`；`turn_marker`：`chat / pending_user / decision_saved=<uuid>`

`WarRoomLineCommandPage.tsx`（`/warroom/line/:id`）现状：
- 已有完整 `ConversationsPanel` 组件（议题列表 + 详情 + 消息气泡 + 输入框），第 1/2/3 条交付物骨架已存在
- 当前议题列表**缺 status badge**（active / resolved / 挂起 三态颜色区分）
- 无 GP 二级页对话框（第 4 条交付物缺失）

---

## 交付物清单

### D1 — 议题列表完善（WarRoomLineCommandPage 栏 4 补全）

在现有 `ConversationsPanel` 列表视图中，每条议题卡片增加状态 badge：

| status 值   | 显示文字 | 颜色                          |
|-------------|----------|-------------------------------|
| `active`    | 活跃     | `text-emerald-400 bg-emerald-500/10` |
| `resolved`  | 已解决   | `text-slate-400 bg-slate-700/40`     |
| `suspended` | 挂起     | `text-amber-400 bg-amber-500/10`     |

议题卡片还需显示：标题、状态 badge、最后更新时间（`updated_at` 相对时间）、最后一条消息摘要（`last_message` 截断 60 字）。

> 现有代码已有 `last_message` 字段，状态 badge 是唯一缺失项。

### D2 — 对话输入框 + 消息气泡（已存在，补齐细节）

现有 `sendMessage` 逻辑：POST 后立刻轮询 `fetchMessages` 拉全量。**维持现有轮询方案**（不引入 SSE，SSE 为 PR4 可选优化）。

补齐点：
- 发送中 `sending=true` 时 input 置灰 + "军师思考中…" 动画气泡（已有，确认保留）
- 错误状态展示（已有 `convError`，确认保留）
- 消息气泡去除 `[TURN:...]` 标记后展示纯文本（已有 `cleanContent`，确认保留）

> D2 基本已实现，仅需在 Code Review 时确认无遗漏。

### D3 — 新对话入口（journey_id 注入，已存在）

`createConversation()` 已注入 `journey_id = line.id`（URL 参数 `:id` 即 journey UUID），`gp_id` 不传（Line 级对话）。

> D3 已实现，无需额外工作。

### D4 — GP 二级页对话框（**核心新增**）

**新建页面**：`apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx`

路由：`/warroom/gp/:gpId`（新增）

入口：从 `WarRoomLineCommandPage` 的 `ConnectionsPanel` → Abilities 块，每个 Ability 卡片右上角加"对话"图标按钮，点击 `navigate(/warroom/gp/<gp_id>)`。

**注意**：`golden_paths` 表有 `journey_id` 字段（创建 GP 时关联），`conversations` 创建时需同时传 `journey_id`（从 GP 中取）和 `gp_id`。

GP 页布局（全屏，双栏）：
- 左栏：GP 基本信息（`title`、`one_liner`、`status`、`journey_id` 对应 Line 名）+ 返回 Line 页按钮
- 右栏：`ConversationsPanel`（复用，`journeyId` 从 GP.journey_id 取，`gpId` 传入，创建对话时注入 `gp_id`）

`ConversationsPanel` 组件需**提取为独立模块**，同时供 `WarRoomLineCommandPage`（无 gpId）和 `WarRoomGoldenPathPage`（有 gpId）复用。

**ConversationsPanel 接口扩展**：
```tsx
interface ConversationsPanelProps {
  journeyId: string;
  gpId?: string; // GP 二级页传入，Line 页不传
}
```
创建对话时若有 `gpId` 则追加到 POST body，`GET /api/brain/conversations` 列表请求也追加 `gp_id` 过滤。

**路由注册**（`apps/api/features/system-hub/index.ts`）：
```ts
{ path: '/warroom/gp/:gpId', component: 'WarRoomGoldenPathPage' },
```

**全高路由注册**（`apps/dashboard/src/App.tsx`）：
```ts
path.startsWith('/warroom/gp') ||  // GP 指挥页全屏
```

**pageComponents 注册**（`apps/api/features/system-hub/index.ts`）：
```ts
WarRoomGoldenPathPage: () => import('../../../dashboard/src/pages/warroom/WarRoomGoldenPathPage'),
```

---

## API 使用说明（无新 API，全复用 PR1/PR2）

| 操作 | 端点 |
|------|------|
| 拉议题列表 | `GET /api/brain/conversations?journey_id=<id>[&gp_id=<id>]&limit=20` |
| 创建对话 | `POST /api/brain/conversations` body: `{journey_id, gp_id?, title?}` |
| 发消息（触发 Agent） | `POST /api/brain/conversations/:id/messages` body: `{role:"user", content}` |
| 拉消息列表 | `GET /api/brain/conversations/:id/messages?limit=100` |
| 拉 GP 详情 | `GET /api/brain/golden-paths`（按 id 过滤）或 `PATCH /api/brain/golden-paths/:id`（只读 GET） |

> GP 详情端点：`/api/brain/golden-paths` 当前仅有列表 GET（按 status 过滤）和 PATCH，无单条 GET。实现时用 `GET /api/brain/golden-paths?status=all`（或不传 status）再前端过滤 id，或视情况直接把 gpId 透过 URL params 传入组件而不额外 fetch GP 详情（页面标题可以简化显示）。

---

## 边界情况

| 场景 | 处理方式 |
|------|----------|
| Line 无对话历史 | 显示"暂无议题对话"占位 + 蓝色"+ 开启对话"按钮（已有） |
| Agent 响应慢（claude 调用）| "军师思考中…" 动画气泡（已有），超时无 UX 超时限制（PR4 处理） |
| GP 页 gpId 对应 GP 不存在 | 显示"GP 不存在或已归档"错误卡，提供返回 Line 页按钮 |
| conversations API 列表 gp_id 过滤 | API 已支持（routes/conversations.js 85-88 行），只需前端传参 |
| Line 页 Ability 无 gp_id 字段 | `WarRoomLineCommandPage.tsx` 的 `JourneyFeature` 接口中无 `gp_id`，`ConnectionsPanel` 需改为：先 fetch `/api/brain/golden-paths`（不传 status 过滤）按 journey_id 筛选，在 Ability 旁挂对话入口；或直接在 Ability 卡片旁挂"对话"按钮 navigate 到 `/warroom/gp/<ability.id>`（以 ability_id 替代 gp_id）——见下方假设 |
| 移动端（Tailscale） | 使用现有 Tailwind 响应式，ConversationsPanel 单栏全宽即可 |

---

## 假设

- [ASSUMPTION: `/warroom/gp/:gpId` 中的 `gpId` 等同于 `golden_paths.id`，不是 `ability_id`；`golden_paths` 表有 `journey_id` 字段可用于 `conversations` 创建。若 Ability 卡片无对应 GP（golden_path 未建），则"对话"按钮不显示。]
- [ASSUMPTION: GP 详情页只需展示 GP title、one_liner、status，不需要完整的 GP 编辑/状态流转 UI（那是 ReportDetailPage 的职责）。]
- [ASSUMPTION: ConversationsPanel 提取为单独文件（如 `ConversationsPanel.tsx`），两个页面均 import 使用，消除代码重复。]
- [ASSUMPTION: 移动端横屏时 GP 页改为纵向单栏堆叠（GP info → ConversationsPanel），无需双栏。]
- [ASSUMPTION: `ConversationsPanel` 列表默认不过滤 status（API 默认返回 active+suspended），resolved 议题也在列表中可见（用 status badge 区分）。]

---

## 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx` | 修改 | 1. 将 `ConversationsPanel` 提取到独立文件；2. 议题卡添加 status badge；3. Ability 卡增加"对话"入口按钮 |
| `apps/dashboard/src/pages/warroom/ConversationsPanel.tsx` | 新建 | 从 WarRoomLineCommandPage 提取，接口加 `gpId?` 参数 |
| `apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx` | 新建 | GP 二级页（双栏：GP 信息 + ConversationsPanel） |
| `apps/api/features/system-hub/index.ts` | 修改 | 注册 `/warroom/gp/:gpId` 路由 + `WarRoomGoldenPathPage` pageComponent |
| `apps/dashboard/src/App.tsx` | 修改 | 在 `isFullHeightRoute` 中加 `path.startsWith('/warroom/gp')` |
| `apps/dashboard/src/pages/warroom/__tests__/WarRoomLineCommandPage.test.ts` | 修改 | 补充 status badge 纯函数测试 |
| `apps/dashboard/src/pages/warroom/__tests__/ConversationsPanel.test.ts` | 新建 | ConversationsPanel 接口单测（gpId 传参、列表过滤） |

---

## 验收（Final E2E，mac_web）

### E2E-1：Line 对话 + Agent 查库回复

```
Playwright 步骤（mac_web，localhost:5174）：
1. 导航到 /pipeline，点击某个 active line → 进入 /warroom/line/:id
2. 栏 4 可见议题列表（或"暂无议题对话"占位）
3. 点"新对话"→ 议题列表出现新议题卡片 + 自动进入详情视图
4. 输入框键入："请问当前 journey 8bb8252f 最近有哪些决策？" → 按 Enter
5. 断言：出现"军师思考中…"气泡（发送中状态）
6. 等待（max 60s）：气泡消失，出现 assistant 回复气泡
7. 断言：回复文本非空（len > 10），且包含真实 decision 内容片段（DB 查确认字段匹配）
   - psql 验证：`SELECT content FROM conversation_messages WHERE role='assistant' AND conversation_id=<id> ORDER BY created_at DESC LIMIT 1;`
   - 验证：message.content 与 UI 展示一致，且 content 引用了 decisions 表中真实存在的 decision title/content
8. 返回议题列表，确认新议题卡片可见（title + 状态 badge "活跃" + 相对时间）
```

### E2E-2：议题历史回访

```
1. 在 E2E-1 完成后，点"返回"回到议题列表
2. 议题列表显示刚才创建的议题，状态 badge 显示"活跃"
3. 点击议题卡片 → 进入详情，历史消息气泡可见（user + assistant 各 ≥1 条）
4. 可继续发消息，新消息追加到气泡流末尾
```

### E2E-3：GP 二级页对话框

```
1. 在 /warroom/line/:id 页，ConnectionsPanel（栏 2）中找到有对应 GP 的 Ability 卡片
2. 点击"对话"按钮 → 导航到 /warroom/gp/:gpId
3. 左栏显示 GP title、one_liner、status
4. 右栏 ConversationsPanel 默认按 gp_id 过滤（仅显示锚定该 GP 的对话）
5. 点"新对话"→ 输入质疑 → 发送
6. 等待 agent 回复，断言回复非空
7. DB 验证：`SELECT gp_id FROM conversations WHERE id=<新建的conversation_id>;` → 等于 gpId
```

### E2E-4：decision 落库验收

```
触发 agent 返回含 decision_saved=<uuid> 的 turn_marker 场景（需 DB 中存在真实 decision 可引用）：
1. 输入质疑（示例："请确认决策 <某已知 decision title> 是否有效，若有效请落库"）
2. 等待回复出现"已落决策"标记（消息气泡下方 amber 文字）
3. DB 验证：`SELECT id FROM decisions WHERE id=<uuid in turn_marker>;` → 存在记录
```

---

## 不在范围（PR4 单独任务）

- Stop Hook 硬闸：检查 `decision_saved=<uuid>` 声明与 DB 实际落库是否一致
- cron TTL 归档（`archived` 状态）
- SSE 推送（当前轮询即可，SSE 为后续可选优化）

---

## target_environment: mac_web
## base_repo: cecelia
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
