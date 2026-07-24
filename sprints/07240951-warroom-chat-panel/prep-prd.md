# 小改动 PrepPRD：WarRoomLineCommandPage 加议题列表 + 军师对话栏（主理人对话回路 PR3/4）

## 改什么
`apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx` 在现有三栏（军师决策流水/连接全景图/节奏与健康度）基础上，新增第四块「军师对话」面板：
- 议题列表（`GET /api/brain/conversations?journey_id=<id>`）：显示该 Line 下 conversations 记录，每条带标题/状态(active/resolved/suspended)/最后一条消息摘要/更新时间
- 点击某议题 → 展开对话框（`GET /api/brain/conversations/:id` 取消息 + `POST /api/brain/conversations/:id/messages` 发消息），5 秒轮询取新回复（PR1/2 已实现的 assistant 回复是同步写入的，轮询只是兜底 UI 刷新，不依赖 SSE）
- 无活跃议题 / 点"新议题" → `POST /api/brain/conversations {journey_id}` 新建，`ttl_hours` 用后端默认值 24

前端只做 UI + 已有 API 的消费方，不改后端 conversations.js / conversation-agent.js（PR1/PR2 已合并）。

## 为什么改
主理人对话回路（Journey 8bb8252f-29b4-4c34-acb9-1accda7ddfcf，Ability journey_features.id=c36467aa-c59a-4319-af21-b36c16b8d82b，thickness=thin）后端已具备完整会话能力（conversations/conversation_messages 表 + spawn/resume 调用层），但没有入口——用户唯一可达渠道是这次要建的 Dashboard 对话栏。设计已经过 07-23 主理人当面拍板锁定 9 组决策（见 task `264b8c8d` payload.prep_prd_body 全文，decisions `d33bb636`/`cdfe6797`/`f68fa355`），本次严格按已锁定设计落地，不重新论证。

## 关联上下文
- Journey/Ability：journey_id=8bb8252f-29b4-4c34-acb9-1accda7ddfcf（工厂·F5指挥舱），ability_id/feature_id=c36467aa-c59a-4319-af21-b36c16b8d82b（主理人对话回路）
- 挂载 Step：journey_steps `e51f80a3-8559-48ad-bb54-264f6fbde599`（"舱内拍板"，promise=主理人在舱内即可完成全部拍板动作）
- 前身任务：61662df9（被 S2 锚点闸终态 failed，不可回收）→ 本次任务 `07d4bca9-2eb3-4a8f-9c5a-627220ead5bb`（已补锚）
- 已合并：PR1 `#4244`（conversations/conversation_messages 基础层）、PR2 `#4253`（spawn/resume 调用层）、`#4262`（migration 359 存量归档 hotfix）
- 本次不做：PR4（Stop Hook 硬闸 `[TURN:...]` 协议对账 + cron TTL 归档 job）——设计⑧a/⑧d，属于 packages/engine + packages/brain 的另一条改动面，另开 sprint

## 影响范围
只加代码，不改现有三栏逻辑；只读现有 API，不新增/改动 conversations 路由。风险面：轮询频率若过高会打 Brain API，用 5 秒 interval + 面板可见时才轮询（unmount 清理 interval）控制。

## 验收标准
- [ ] WarRoomLineCommandPage 新增议题列表 + 对话框面板，可创建新议题、发消息、看到 assistant 回复
- [ ] 议题列表按 updated_at 倒序，展示 status 徽章
- [ ] 移动端（窄屏）布局不破（沿用页面现有 Tailwind 响应式模式）
- [ ] 前端单元测试覆盖：议题列表渲染 / 发消息后乐观更新或轮询取到回复 / 空状态
- [ ] CI 全绿
