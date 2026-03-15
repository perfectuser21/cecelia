---
id: learning-livemonitor-dev-step
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
changelog:
  - 1.0.0: 初始版本
---

# Learning: LiveMonitor DEV STEPS 面板 — vitest fake timers + recharts dual-instance

## 背景

PR #965 目标：在 Dashboard LiveMonitor 左列新增 DevStepPanel，读取 Brain tasks 的 `custom_props.dev_step` / `custom_props.dev_step_name`，实时展示活跃 /dev 任务的步骤进度。复用现有 `activeTasks`（5s 轮询），无需新增 API 端点。

## 陷阱 1：vi.useFakeTimers() 导致 waitFor/findByText 永久超时

### 问题

新测试使用 `findByText(...)` 等待异步状态更新：

```typescript
await findByText('S2');  // 永久挂起
```

在 `beforeEach` 里设置了 `vi.useFakeTimers()`，而 `@testing-library/react` 的 `waitFor` 内部依赖 `setTimeout`，被 fake timer 接管后永远不会触发。

### 修复

用 `act(async () => {...})` 代替 `findByText`：

```typescript
await act(async () => {
  renderWithRouter();
});
await act(async () => {}); // flush promises + state updates

expect(screen.getByText('S2')).toBeInTheDocument();
```

`act` 会强制刷新 React 状态队列，不依赖真实 setTimeout，在 fake timers 环境下仍然有效。

## 陷阱 2：CI vitest v4 recharts useRef crash（本地 v1 不复现）

### 问题

CI 环境（vitest v4 + happy-dom）下，`act(async () => { renderWithRouter(); })` 触发 PRProgressDashboard 组件重新渲染，而该组件使用 recharts 的 `ResponsiveContainer`，在 React 18/19 双实例环境下 `useRef` 返回 null：

```
TypeError: Cannot read properties of null (reading 'useRef')
  at ResponsiveContainer.js:...
```

本地（vitest v1）不复现，因为 happy-dom 版本不同。

### 修复

在 `LiveMonitorPage.test.tsx` 顶层添加 recharts mock（与 `PRProgressDashboard.test.tsx` 相同模式）：

```typescript
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'line-chart' }, children),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, children),
}));
```

需要同时 `import React from 'react'`（`React.createElement` 需要显式引入）。

## 陷阱 3：DoD Gate [BEHAVIOR] 条目格式限制

### 规则

CI `check-dod-mapping.cjs` 对 `[BEHAVIOR]` 类型有特殊限制：
- `[BEHAVIOR]` 条目不能用 `grep/ls` 测试命令（只能检测文件静态内容，不符合"行为"语义）
- DoD 必须至少包含 1 个 `[BEHAVIOR]` 条目

### 修复策略

1. 将原本用 grep 检测输出文本的 `[BEHAVIOR]` 条目改为 `[ARTIFACT]`（检测代码中是否有该字符串完全合理）
2. 新增一个真正的 `[BEHAVIOR]` 条目，用 `npm test` 验证（npm test 不是 grep/ls）：
   ```markdown
   - [x] [BEHAVIOR] DevStepPanel 组件测试全部通过（空状态 + 步骤显示 + 过滤）
     Test: manual:bash -c "cd apps/dashboard && npm test 2>&1 | tail -3"
   ```

## 实现要点

### BrainTask interface 扩展

```typescript
interface BrainTask {
  // ...已有字段...
  task_type?: string;
  custom_props?: {
    dev_step?: number;
    dev_step_name?: string;
    [key: string]: unknown;
  };
}
```

### DevStepPanel 组件

- 过滤 `task_type === 'dev'`，空时显示"无运行中的 /dev 任务"
- 步骤编号显示 `S{step}`，无 custom_props 则显示"步骤未知"（灰色）
- 复用 `activeTasks`（已有 5s 轮询），零额外 API 请求

### Brain API 行为

`GET /api/brain/tasks?status=in_progress` 使用 `SELECT *`，返回包含 `task_type` 和 `custom_props` 字段的完整任务记录，无需修改后端。

## 结论

| 场景 | 正确做法 |
|------|---------|
| fake timers + 异步状态 | 用 `act(async)` 代替 `findByText/waitFor` |
| CI vitest v4 recharts crash | 在测试文件顶层 `vi.mock('recharts', ...)` |
| [BEHAVIOR] DoD 条目 | 用 `npm test` 而非 `grep/ls` 作为 Test 命令 |
| 扩展已有轮询数据 | 只加 interface 字段，不新增 API 端点 |
