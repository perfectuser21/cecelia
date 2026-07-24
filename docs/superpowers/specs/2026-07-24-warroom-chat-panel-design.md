# WarRoomLineCommandPage 军师对话抽屉设计

- task_id: 07d4bca9-2eb3-4a8f-9c5a-627220ead5bb（前身 61662df9，被 S2 锚点闸终态 failed）
- 锚点：journey_id=8bb8252f-29b4-4c34-acb9-1accda7ddfcf / gp_id=step_id 见 payload.anchor
- 关联 PR：#4244（PR1 conversations 基础层）、#4253（PR2 spawn/resume）
- 设计来源：task 264b8c8d payload.prep_prd_body 全文（07-23 主理人当面拍板 9 组决策），decisions d33bb636/cdfe6797/f68fa355
- 本文档只覆盖 PR3（Dashboard UI）。PR4（Stop Hook 硬闸 + cron 归档）不在本设计范围内，属于另一条改动面。

## 背景

主理人对话回路后端已就绪（conversations/conversation_messages 表 + headless claude spawn/resume 调用层），但没有任何前端入口。本设计给 `WarRoomLineCommandPage`（`/warroom/line/:id`）加一个对话入口，让用户能在 Line 指挥页直接和该线军师（带工具 agent，会真查 Brain DB）聊，验证系统真相、多轮续接不失忆。

## 已有约束（来自锁定设计，不重新论证）

1. 会话续接：agent 调用层已做 session resume，前端不用管 session_id，只管 conversation_id
2. 锚定粒度：Line 页对话默认锚 journey_id，注水线级全景（GP 二级页锚 gp_id 是后续范围，不在本次）
3. 议题可见可回访：不能是"聊完就消失"的纯聊天框，必须是可回看的议题列表（像 ChatGPT Projects）
4. 对话中不允许 agent 静默执行写操作，确认后才落库——这是后端 agent 的职责（PR2 已实现引用 Brain API 工具白名单），前端不需要额外拦截逻辑，只是如实展示 agent 回复

## 方案取舍

三个候选布局：

| 方案 | 说明 | 问题 |
|---|---|---|
| A. 加第四列 | grid-cols-3 → grid-cols-4 | 现有三栏在桌面端本已挤（三栏各自 max-h 独立滚动），再挤一栏可读性下降；决策⑥要求"用户看的和agent查的是同一块作战板"，四栏并列反而分散注意力 |
| B. 整页 tab 切换（总览/对话） | 简单，两个视图切换 | 违反决策⑥——切走 tab 后板面看不见了，agent 说"我查到 XX" 时用户没法对照 |
| **C. 右侧滑出抽屉（选定）** | header 加"军师对话"按钮，点开从右侧滑出覆盖层，宽度约 400-480px；关闭恢复原三栏 | 无 |

选 C：不改动现有三栏渲染逻辑（零回归风险），展开时三栏仍在视觉背景中可见（决策⑥），移动端可做成全屏抽屉。

## 组件结构

```
WarRoomLineCommandPage.tsx（现有，改动：加 header 按钮 + 抽屉挂载点 + 打开态 state）
  └── ConversationDrawer.tsx（新增）
        ├── ConversationList（议题列表，drawer 内顶部，可折叠成"返回列表"）
        │     - 拉 GET /api/brain/conversations?journey_id=<line.id>
        │     - 每行：title || "议题 " + id.slice(0,8) / status 徽章 / last_message 摘要 / relativeTime(updated_at)
        │     - "+ 新议题" 按钮
        └── ConversationThread（对话区，选中某条议题后展示）
              - 拉 GET /api/brain/conversations/:id（含 messages）
              - 消息气泡列表（role=user 右对齐/assistant 左对齐/system 居中小字）
              - 输入框 + 发送按钮 → POST /api/brain/conversations/:id/messages { role: 'user', content }
              - 响应体是新写入的 user message row（不含 assistant 回复，因为路由用 message insert 返回单条），
                assistant 回复需要发送后重新 GET /api/brain/conversations/:id/messages 拉取——发送后立即重拉一次
                （不是纯轮询等待，是"送出→重拉"同步语义，配合 5s 兜底轮询防漏）
```

## 数据流

1. 打开抽屉 → `GET /conversations?journey_id=<line.id>` → 渲染列表，默认不选中任何议题
2. 点击议题 / 点"新议题"（`POST /conversations {journey_id}` 拿到新 id）→ 记录 `activeConversationId` → `GET /conversations/:id` 取历史消息 → 渲染 Thread
3. 发消息：`POST /conversations/:id/messages {role:'user', content}` → 成功后 `GET /conversations/:id/messages?limit=50` 重拉全量（保证拿到 assistant 回复，PR2 是同步写入的） → 追加渲染
4. Thread 打开期间维持 5s `setInterval` 轮询 `GET /conversations/:id/messages`（用 `before`/最后一条 id 做增量或直接整页重拉，选整页重拉更简单更不容易错），`activeConversationId` 变化或组件卸载时清理 interval
5. 关闭抽屉 → 清理 interval，不清空 state（下次打开保留上次选中的议题，减少重复请求）

## 错误处理

- 列表/详情/发消息任一请求失败 → 抽屉内联错误提示（复用页面已有的 `AlertCircle` 图标 + 红色文案模式），不阻断页面其余部分
- 发消息按钮在请求进行中禁用，防止重复提交
- conversation_id 不存在（404）→ 提示"议题已归档或不存在"，回到列表视图

## 测试策略

- **Unit（vitest + @testing-library/react）**：
  - ConversationList：空状态渲染 / 有数据渲染 status 徽章 / 点击回调触发
  - ConversationThread：消息气泡按 role 分列渲染 / 发送后调用重拉 / 加载态禁用发送按钮
  - 用 `vi.fn()` mock `fetch`，不打真实网络
- **Integration**：不新增（后端 API 已有 PR1/PR2 的 route/agent 测试覆盖，前端只是消费方）
- **Trivial**：布局/样式不做快照测试（Tailwind class 断言意义不大）

无 E2E（本次改动是 mac_web 场景下的纯前端消费层，路径B 小改动，不触发 harness Final E2E 门槛；`smoke.sh` 不适用——未改动 `packages/brain/src/`）。

## 不包含（本次不做）

- GP 二级页同款对话框（设计⑦c补/⑦d，锚 gp_id）——后续 sprint
- PR4：Stop Hook `[TURN:...]` 协议对账、cron TTL 归档 job——另一条改动面（packages/engine + packages/brain），另开 sprint
- SSE 实时推送——轮询已够用，PR2 的 agent 调用是同步阻塞返回，本来就没有"异步到达"的消息
