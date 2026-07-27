# Contract Draft — PR3/4 主理人对话回路：Dashboard 对话栏 UI

**Task ID**: 496dceb8-0ded-4923-80e3-d5772af256a7
**Sprint Dir**: sprints/07271849-relay-496dceb8
**生成时间**: 2026-07-27

---

## 不变量（Invariants）

- `POST /api/brain/conversations` 签名不变：必须接受 `journey_id` + 可选 `gp_id`
- `POST /api/brain/conversations/:id/messages` 签名不变：必须同步触发 `invokeAgent` 并写入 assistant 消息
- `ConversationsPanel` 复用不得破坏现有 Line 页第 4 栏行为（渲染路径不变，仅扩展状态徽章和轮询）
- 不新增 Brain 路由（GP 页的 `gp_id` 注水从 URL 参数直接传入 `ConversationsPanel`）

---

## 行为契约（[BEHAVIOR] 条目）

### D1 — 状态徽章

**[BEHAVIOR] B-D1-01** `active` 状态对话卡片显示蓝色徽章，文案"进行中"
**[BEHAVIOR] B-D1-02** `resolved` 状态对话卡片显示绿色徽章，文案"已解决"
**[BEHAVIOR] B-D1-03** `suspended` 状态对话卡片显示黄色徽章，文案"挂起"
**[BEHAVIOR] B-D1-04** `statusBadge(status)` 纯函数：输入 `active` → 返回含 `text-blue` 的 className 和文案"进行中"
**[BEHAVIOR] B-D1-05** `statusBadge(status)` 纯函数：输入 `resolved` → 返回含 `text-green` 的 className 和文案"已解决"
**[BEHAVIOR] B-D1-06** `statusBadge(status)` 纯函数：输入 `suspended` → 返回含 `text-yellow/amber` 的 className 和文案"挂起"
**[BEHAVIOR] B-D1-07** `statusBadge(status)` 纯函数：未知状态 → 返回空文案（不渲染徽章）

### D2 — 发消息后轮询

**[BEHAVIOR] B-D2-01** `sendMessage` 成功后，前端开启轮询：每 1500ms 调用一次 `GET /:id/messages`
**[BEHAVIOR] B-D2-02** 轮询检测到新的 `role=assistant` 消息后立即停止轮询，显示回复内容
**[BEHAVIOR] B-D2-03** 轮询超过 20 次（30s）未检测到 assistant 回复时，停止轮询并显示"军师暂无回复，请稍后重试"
**[BEHAVIOR] B-D2-04** 轮询期间 `sending` 状态为 `true`，按钮禁用，显示"军师思考中…"
**[BEHAVIOR] B-D2-05** `pollForReply(convId, maxAttempts, intervalMs)` 纯逻辑函数：当 fetchMessages 返回含 assistant 消息时，返回 `{ stopped: true, timedOut: false }`
**[BEHAVIOR] B-D2-06** `pollForReply` 超过 maxAttempts 时，返回 `{ stopped: true, timedOut: true }`

### D3 — GP 页 `/warroom/gp/:gpId`

**[BEHAVIOR] B-D3-01** 访问 `/warroom/gp/:gpId` 路由返回 `WarRoomGPPage` 组件，不 404
**[BEHAVIOR] B-D3-02** `WarRoomGPPage` 右栏嵌入 `ConversationsPanel`，`gp_id` 注水：创建对话时 `POST /api/brain/conversations` body 含 `gp_id`
**[BEHAVIOR] B-D3-03** `WarRoomGPPage` 创建对话后，DB 断言 `conversations.gp_id = :gpId`（非 NULL）
**[BEHAVIOR] B-D3-04** ConnectionsPanel Feature 行包含 `→` 跳转按钮，点击导航到 `/warroom/gp/:feature.id`
**[BEHAVIOR] B-D3-05** GP 页刷新后历史议题仍可见（依赖 `GET /api/brain/conversations?journey_id=…&gp_id=…`）

### D4 — 移动端降级

**[BEHAVIOR] B-D4-01** viewport `< lg`（<1024px）时，四栏布局改为 tabs 切换
**[BEHAVIOR] B-D4-02** tabs 包含"决策"、"连接"、"健康"、"对话" 四个 tab，对话 tab 可达
**[BEHAVIOR] B-D4-03** 输入框 `min-height` ≥ 44px（触控目标）
**[BEHAVIOR] B-D4-04** `lg:` 断点以上恢复四栏 grid 布局

---

## DB 断言（最终验收必须直查 DB）

**[BEHAVIOR] B-DB-01** 场景 A：发送消息后，`conversations` 表 `status = 'active'`
**[BEHAVIOR] B-DB-02** 场景 A：`conversation_messages` 含 `role='user'` 且 content 非空
**[BEHAVIOR] B-DB-03** 场景 A：`conversation_messages` 含 `role='assistant'` 且 content 非空
**[BEHAVIOR] B-DB-04** 场景 B（GP 页创建对话）：`conversations.gp_id IS NOT NULL`，值等于 URL 中的 `gpId`

---

## API 契约（接口签名不变量）

| 接口 | 方法 | 必填参数 | 返回断言 |
|------|------|---------|---------|
| `/api/brain/conversations` | POST | `journey_id` (UUID) | `status=201`, body 含 `id`, `status='active'` |
| `/api/brain/conversations` | GET | `journey_id` (query) | `status=200`, body 含 `conversations[]` 数组 |
| `/api/brain/conversations/:id/messages` | POST | `role`, `content` | `status=201`; role=user 时同步写入 assistant 消息 |
| `/api/brain/conversations/:id/messages` | GET | — | `status=200`, body 含 `messages[]` |

---

## 边界约束

- 不含：PR4（Stop Hook + cron 归档）、用户鉴权、SSE 升级、decision 前端落库逻辑
- `ConversationsPanel` props 签名变更：从 `{ journeyId }` 扩展为 `{ journeyId, gpId? }`，向后兼容（gpId 可选）
