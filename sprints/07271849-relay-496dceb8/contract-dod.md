# Contract DoD — PR3/4 主理人对话回路

**Task ID**: 496dceb8-0ded-4923-80e3-d5772af256a7
**Sprint Dir**: sprints/07271849-relay-496dceb8

---

## DoD 检查清单

### 功能实现（D1-D4）

- [ ] **D1** 状态徽章：`statusBadge(status)` 函数已实现并导出；对话卡片渲染 `active`/`resolved`/`suspended` 对应徽章
- [ ] **D2** 轮询：`sendMessage` 后开启每 1500ms 一次轮询，检测到 assistant 消息停止；超 30s 显示超时提示
- [ ] **D3** GP 页：`WarRoomGPPage.tsx` 已创建；路由 `/warroom/gp/:gpId` 已注册于 `App.tsx`；Feature 行含 `→` 跳转入口
- [ ] **D4** 移动端：`< lg` 时四栏改 tabs；输入框 `min-height` ≥ 44px

### 单元测试

- [ ] `tests/unit/statusBadge.test.ts`：B-D1-04 ~ B-D1-07 全覆盖（7条 [BEHAVIOR]）
- [ ] `tests/unit/pollForReply.test.ts`：B-D2-05 ~ B-D2-06 覆盖（含超时路径）
- [ ] 所有单测 `pnpm test` 通过，无跳过

### E2E 测试（mac_web Playwright）

- [ ] `tests/e2e/conversation-flow.spec.ts` 场景 A：
  - 打开 Line 指挥页 → 新建对话 → 发送含 decision topic 的消息 → 等待 ≤30s 收到 assistant 回复
  - 断言回复内容非空
  - 返回列表断言议题卡片可见 + 状态徽章"进行中"
  - DB 断言：`conversations.status = 'active'`；`conversation_messages` user + assistant 各一行，content 非空
- [ ] `tests/e2e/conversation-flow.spec.ts` 场景 B：
  - 从 ConnectionsPanel Feature 行点 `→` 进入 GP 页 → 新建对话
  - DB 断言：`conversations.gp_id IS NOT NULL`
- [ ] `tests/e2e/conversation-flow.spec.ts` 场景 C：
  - 刷新 GP 页 → 历史议题仍可见 → 点入消息记录完整
- [ ] E2E 通过率 100%，无 flaky

### CI / 构建

- [ ] `workspace-ci.yml` 通过（绿）
- [ ] `pnpm tsc --noEmit` 无 TypeScript 错误
- [ ] 无 `console.error` 调用（grep 检查）
- [ ] 无 `*New.tsx` / `*Old.tsx` 临时文件

### 不变量保护

- [ ] `POST /api/brain/conversations` 签名未变（现有单测仍通过）
- [ ] `POST /api/brain/conversations/:id/messages` 签名未变
- [ ] `ConversationsPanel` 现有 Line 页第 4 栏渲染路径未破坏（回归测试通过）

---

## 行为断言（[BEHAVIOR] 完整列表）

**[BEHAVIOR] B-D1-01** `active` 状态对话卡片显示蓝色徽章，文案"进行中"
**[BEHAVIOR] B-D1-02** `resolved` 状态对话卡片显示绿色徽章，文案"已解决"
**[BEHAVIOR] B-D1-03** `suspended` 状态对话卡片显示黄色徽章，文案"挂起"
**[BEHAVIOR] B-D1-04** `statusBadge(status)` 纯函数：输入 `active` → 返回含 `text-blue` 的 className 和文案"进行中"
**[BEHAVIOR] B-D1-05** `statusBadge(status)` 纯函数：输入 `resolved` → 返回含 `text-green` 的 className 和文案"已解决"
**[BEHAVIOR] B-D1-06** `statusBadge(status)` 纯函数：输入 `suspended` → 返回含 `text-yellow/amber` 的 className 和文案"挂起"
**[BEHAVIOR] B-D1-07** `statusBadge(status)` 纯函数：未知状态 → 返回空文案（不渲染徽章）
**[BEHAVIOR] B-D2-01** `sendMessage` 成功后，前端开启轮询：每 1500ms 调用一次 `GET /:id/messages`
**[BEHAVIOR] B-D2-02** 轮询检测到新的 `role=assistant` 消息后立即停止轮询，显示回复内容
**[BEHAVIOR] B-D2-03** 轮询超过 20 次（30s）未检测到 assistant 回复时，停止轮询并显示"军师暂无回复，请稍后重试"
**[BEHAVIOR] B-D2-04** 轮询期间 `sending` 状态为 `true`，按钮禁用，显示"军师思考中…"
**[BEHAVIOR] B-D2-05** `pollForReply` 纯逻辑函数：fetchMessages 返回含 assistant 消息时，返回 `{ stopped: true, timedOut: false }`
**[BEHAVIOR] B-D2-06** `pollForReply` 超过 maxAttempts 时，返回 `{ stopped: true, timedOut: true }`
**[BEHAVIOR] B-D3-01** 访问 `/warroom/gp/:gpId` 路由返回 `WarRoomGPPage` 组件，不 404
**[BEHAVIOR] B-D3-02** `WarRoomGPPage` 右栏嵌入 `ConversationsPanel`，创建对话时 body 含 `gp_id`
**[BEHAVIOR] B-D3-03** `WarRoomGPPage` 创建对话后，DB 断言 `conversations.gp_id = :gpId`（非 NULL）
**[BEHAVIOR] B-D3-04** ConnectionsPanel Feature 行包含 `→` 跳转按钮，点击导航到 `/warroom/gp/:feature.id`
**[BEHAVIOR] B-D3-05** GP 页刷新后历史议题仍可见
**[BEHAVIOR] B-D4-01** viewport `< lg`（<1024px）时，四栏布局改为 tabs 切换
**[BEHAVIOR] B-D4-02** tabs 包含"决策"、"连接"、"健康"、"对话"四个 tab，对话 tab 可达
**[BEHAVIOR] B-D4-03** 输入框 `min-height` ≥ 44px（触控目标）
**[BEHAVIOR] B-D4-04** `lg:` 断点以上恢复四栏 grid 布局
**[BEHAVIOR] B-DB-01** 场景 A：发送消息后，`conversations` 表 `status = 'active'`
**[BEHAVIOR] B-DB-02** 场景 A：`conversation_messages` 含 `role='user'` 且 content 非空
**[BEHAVIOR] B-DB-03** 场景 A：`conversation_messages` 含 `role='assistant'` 且 content 非空
**[BEHAVIOR] B-DB-04** 场景 B（GP 页创建对话）：`conversations.gp_id IS NOT NULL`，值等于 URL 中的 `gpId`

---

## 验收门槛

**全部 DoD 项打勾 + 场景 A/B/C E2E 全绿 + workspace-ci.yml 绿** → 任务可关闭

---

## 手动验收命令（manual:bash）

```manual:bash
# 单测
pnpm --filter @cecelia/dashboard test -- --run sprints/07271849-relay-496dceb8/tests/unit/

# E2E（mac_web Playwright）
pnpm --filter @cecelia/dashboard exec playwright test sprints/07271849-relay-496dceb8/tests/e2e/conversation-flow.spec.ts
```
