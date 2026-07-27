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

## 验收门槛

**全部 DoD 项打勾 + 场景 A/B/C E2E 全绿 + workspace-ci.yml 绿** → 任务可关闭
