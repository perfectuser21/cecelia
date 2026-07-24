# 终审修复报告 — 军师对话抽屉（cp-warroom-chat-panel）

## Finding 1（Important）：`e.message ||` 死代码前缀泄漏英文网络错误文案

**问题**：4 处网络请求错误处理（`ConversationDrawer.fetchList`、`handleCreate`；
`ConversationThread.fetchMessages`、`handleSend`）在 HTTP 错误路径上都是 `throw new Error()`
（空 message），随后 `catch (e: any) { setXError(e.message || '<中文兜底>'); }`。因为 HTTP 错误
路径抛出的 Error 恒无 message，`e.message ||` 前缀在这条路径上永远是死代码；它唯一还活着的效果
是泄漏：一旦 `fetch()` 本身在网络层被拒绝（如 Brain API 重启期间的 `TypeError: Failed to fetch`，
这在本项目里是常态）或 `res.json()` 抛出 JSON 解析错误，`e.message` 会变成非空英文字符串直接展示
给用户，违反全局简体中文 UI 文案约束。

**修法**：4 处 catch 块统一去掉 `e.message ||` 前缀，改为固定中文兜底文案；由于 `e` 不再被使用，
一并把 `catch (e: any)` 改成裸 `catch {`（TS/ESLint 均无异议，`tsc --noEmit` 验证通过）。

- `fetchList`：`catch { setListError('加载议题列表失败'); }`
- `handleCreate`：`catch { setListError('创建议题失败'); }`
- `fetchMessages`：`catch { setError('加载消息失败'); }`
- `handleSend`：`catch { setError('发送失败'); }`

文件：`apps/dashboard/src/pages/warroom/ConversationDrawer.tsx`

## Finding 2（Important）：`fetchMessages` 缺失设计文档规定的 404 处理

**问题**：设计文档（`docs/superpowers/specs/2026-07-24-warroom-chat-panel-design.md` 错误处理节）
明确要求 `conversation_id` 不存在（404）→ 提示"议题已归档或不存在"，回到列表视图。但原实现把
404 和其它任意失败一视同仁，只是内联展示通用"加载消息失败"，用户被留在空的对话线程视图里，只能
靠手动点返回箭头逃出。

**修法**：
1. `ConversationThread` 新增 `onNotFound: (message: string) => void` prop，与已有的 `onBack`
   （挂在可见返回箭头按钮上的同一个语义）并列传入。
2. `fetchMessages` 里在 `!res.ok` 判断之前先检查 `res.status === 404`：命中时调用
   `onNotFound('议题已归档或不存在')` 并 `return`（不再走通用错误分支/不再 setMessages）。
3. `ConversationDrawer` 新增 `handleThreadNotFound`：`setActiveId(null)` 切回列表视图 +
   `setListError(message)` 把"议题已归档或不存在"展示在列表视图已有的错误提示区（复用
   `ConversationList` 现有的 `AlertCircle` + 红色文案渲染路径，不新增 UI 结构）。
4. `<ConversationThread ... onNotFound={handleThreadNotFound} />` 接线。

端到端行为：用户点开一个已归档/不存在的议题 → 拉消息命中 404 → 自动切回议题列表 → 列表页顶部
展示"议题已归档或不存在"错误提示，不再需要手动点返回箭头。

文件：`apps/dashboard/src/pages/warroom/ConversationDrawer.tsx`

## 新增测试

`apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx`，"对话区" describe 块内
新增用例「消息拉取404→提示"议题已归档或不存在"并自动回到议题列表」：mock 一个议题列表（1条）+
mock `GET /api/brain/conversations/conv-1/messages` 返回 `{ ok: false, status: 404, json: async
() => ({}) }`，点击该议题后断言 `screen.getByTestId('new-conversation-btn')` 重新可见（回到列表
视图，与已有"点返回按钮回到议题列表"用例断言方式一致）且 `screen.getByText('议题已归档或不存在')`
可见。

原有 15 个测试（含专门验证 Chinese 兜底文案的用例，如 500 响应 `json: async () => ({})` 场景）全部
未改动断言，验证行为不变——因为这些用例走的本来就是 `!res.ok` 空 Error 路径，`e.message` 恒为空，
去掉 `e.message ||` 前缀后展示的中文兜底文案与之前完全相同。

## 测试命令与结果

```
cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx
→ ✓ 16 tests passed (15 原有 + 1 新增 404 用例)

cd apps/dashboard && npx vitest run \
  src/pages/warroom/__tests__/WarRoomLineCommandPage.chat.test.tsx \
  src/pages/warroom/__tests__/WarRoomPage.test.ts
→ ✓ 2 files passed, 80 tests passed（无回归）

cd apps/dashboard && npx vitest run
→ ✓ 30 files passed, 305 tests passed（全量套件零回归）

cd apps/dashboard && npx tsc --noEmit -p .
→ ConversationDrawer.tsx 无类型错误
```

## 改动文件

- `apps/dashboard/src/pages/warroom/ConversationDrawer.tsx`
- `apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx`

## 顾虑

- 无。两处均为局部行为修正，未改变组件对外 props 签名（`ConversationDrawer` 本身签名不变，
  `ConversationThread` 是模块内私有组件，新增的 `onNotFound` prop 由同文件内的父组件接线，不影响
  外部消费方 `WarRoomLineCommandPage`）。
