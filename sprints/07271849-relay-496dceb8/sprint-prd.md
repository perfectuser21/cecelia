# Sprint PRD — PR3/4 主理人对话回路：Dashboard 对话栏 UI

**Task ID**: 496dceb8-0ded-4923-80e3-d5772af256a7  
**Sprint Dir**: sprints/07271849-relay-496dceb8  
**PR 系列**: PR3（PR4=Stop Hook+cron 归档独立任务）  
**依赖 PR**: PR1 #4244 · PR2 #4253（已合并）

---

## Invariant 约束

- conversations API 接口签名（PR1）不得变更：POST /conversations 必须接受 journey_id + gp_id；POST /:id/messages 必须同步触发 invokeAgent 并写入 assistant 消息
- ConversationsPanel 复用不得破坏现有 Line 页第 4 栏行为
- 不引入新 Brain 路由，除非 GP 页确认无法从现有 /warroom/line/:id/command 数据取得 gp 信息

## 累积 FR

N/A（无已有 FR 需加载；本 sprint 在 PR1/PR2 已有 API 基础上纯做前端 UI 补全）

## NFR

- 轮询超时上限 30s（20 次 × 1.5s），超时后显示提示，不静默失败
- 移动端（< lg）必须有可达的对话栏路径（tabs 切换或独立视图）
- 输入框触控目标 ≥ 44px
- 无 TypeScript 编译错误，无 console.error

---

## 现状（已有，PR1+PR2）

`ConversationsPanel` 已存在（WarRoomLineCommandPage.tsx L412-648），嵌在第 4 栏。invokeAgent spawn/resume 已通。真实缺口：

| 编号 | 缺口 | 文件 |
|------|------|------|
| D1 | 列表卡片缺状态徽章（active/resolved/suspended） | WarRoomLineCommandPage.tsx |
| D2 | 发消息后无轮询，assistant 回复不自动刷新 | WarRoomLineCommandPage.tsx |
| D3 | `/warroom/gp/:gpId` 路由不存在，gp_id 无法注水 | 新建 WarRoomGPPage.tsx + App.tsx |
| D4 | 四栏 grid 无小屏降级 | WarRoomLineCommandPage.tsx |

---

## 交付物

**D1** 状态徽章：`active`→蓝 / `resolved`→绿 / `suspended`→黄，文案"进行中/已解决/挂起"。

**D2** 轮询：sendMessage 后每 1.5s 拉 GET /:id/messages，检测到新 assistant 行则停止；超 30s 显示"军师暂无回复，请稍后重试"。

**D3** GP 页：新建 `WarRoomGPPage.tsx`，路由 `/warroom/gp/:gpId`，右栏嵌 ConversationsPanel，创建对话时注入 gp_id；ConnectionsPanel Feature 行加 `→` 跳转入口。

**D4** 移动端：`< lg` 时四栏改 tabs 切换，对话栏 tab 可达；输入框 min-height 44px。

---

## Final E2E 验收（mac_web，Playwright）

**场景 A（必须通过）**：打开某 Line 指挥页 → 新建对话 → 输入含真实 decision topic 的质疑 → 等待 ≤30s assistant 回复 → 断言回复含该 decision 真实内容 → 返回列表断言议题可见且状态徽章正确。

DB 断言：`conversations.status = 'active'`；`conversation_messages` 至少含 user + assistant 各一行，assistant content 非空。

**场景 B+C（GP 页 + 历史回访）**：从 Feature → 进 GP 页 → 新建对话，DB 断言 `conversations.gp_id` 非 NULL；刷新后历史议题仍可见，点入消息记录完整。

---

## DoD

- [ ] D1–D4 全部实现
- [ ] 场景 A E2E 通过
- [ ] 场景 B+C E2E 通过
- [ ] workspace-ci.yml 绿，无 TS 错误，无 console.error

---

## 范围边界

不含：PR4（Stop Hook+cron 归档）、用户鉴权、SSE 升级、decision 前端落库逻辑。

---

*生成时间: 2026-07-27 | 任务: 496dceb8 | v2*

journey_type: feature
target_environment: mac_web
