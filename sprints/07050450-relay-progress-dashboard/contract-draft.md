# Contract Draft：Relay 进度条 Dashboard 页面

**Task ID**: d56d5ad9-0e03-4106-8b38-23507bb14dc6
**Sprint Dir**: sprints/07050450-relay-progress-dashboard
**Branch**: cp-07050456-ws-d56d5ad9
**合同日期**: 2026-07-04

---

## 功能目标

在 Cecelia Dashboard 新增「Relay 进度」页面（路由 `/relay-progress`），从已上线的 `GET /api/brain/orchestrator/relay-runs` 接口拉取数据，将每个活跃 initiative 渲染为七段横向进度条，让主理人一眼看清每个 harness 任务跑到哪一棒。

---

## 数据契约

**接口**：`GET /api/brain/orchestrator/relay-runs?limit=20`

**响应结构**（Brain 侧已上线，本 sprint 只消费）：
```json
{
  "runs": [
    {
      "initiative_id": "abcd1234-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "current_phase": "generate",
      "phases": {
        "planning": "completed",
        "gan": "completed",
        "generate": "running",
        "evaluate": "pending",
        "judge": "pending",
        "merge": "pending",
        "report": "pending"
      }
    }
  ]
}
```

**七段 Phase 顺序**（固定，不可乱序）：
`planning → gan → generate → evaluate → judge → merge → report`

---

## 新增文件

| 文件路径 | 说明 |
|---------|------|
| `apps/dashboard/src/pages/harness-pipeline/RelayProgressPage.tsx` | 页面主组件 |
| `apps/dashboard/e2e/relay-progress.spec.ts` | Playwright E2E 测试（4 条） |

**修改文件**：
- `apps/dashboard/src/components/DynamicRouter.tsx`：新增 lazy import + 路由 `/relay-progress`

---

## UI 行为规范

### 进度条结构

每行 initiative 渲染一条进度条，包含：
- `[data-testid="relay-progress-list"]`：外层容器
- 每行：`[data-testid="relay-run-item"]`
- 短码显示：取 `initiative_id` 前 8 位
- 当前 phase badge：显示当前 `current_phase` 文字
- 七段横向进度条：`planning / gan / generate / evaluate / judge / merge / report`
  - 已完成（completed）：高亮色（绿色系）
  - 当前进行中（running）：活跃色（蓝色系）
  - 未到达（pending）：灰色

### 空态

- API 返回空数组时：显示文案「暂无进行中的 relay」
- `[data-testid="relay-empty-state"]` 元素可见

### 自动刷新

- 页面每 15 秒调一次 API（`setInterval` + `useEffect` cleanup）
- 刷新不触发全屏闪烁

---

## E2E 验收

**测试环境**：mac_web（本机 Playwright，`baseURL: http://localhost:5174`）
**测试文件**：`apps/dashboard/e2e/relay-progress.spec.ts`

### TC-1：进度条容器可见

```
访问 /relay-progress
断言：[data-testid="relay-progress-list"] 元素在 DOM 中可见
```

### TC-2：七段 phase 标签均在 DOM

```
访问 /relay-progress
断言：页面 DOM 中能找到以下所有文字（大小写不敏感）：
  Planning / GAN / Generate / Evaluate / Judge / Merge / Report
```

### TC-3：mock API 返回一条 initiative，短码渲染可见

```
拦截 GET **/orchestrator/relay-runs**，返回：
  { "runs": [{ "initiative_id": "abcd1234-...", "current_phase": "generate", "phases": {...} }] }
访问 /relay-progress
断言：页面中文字 "abcd1234" 可见
```

### TC-4：mock API 返回空数组，空态文案可见

```
拦截 GET **/orchestrator/relay-runs**，返回：{ "runs": [] }
访问 /relay-progress
断言："暂无进行中的 relay" 文案可见
```

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `../../apps/dashboard/e2e/relay-progress.spec.ts` | TC-1 / TC-2 / TC-3 / TC-4 | 存根 return null → 四条测试全红 |

---

## 不在本 Sprint 范围

- relay-runs API 修改（已上线，本 sprint 只消费）
- judge/merge/report 三段后端实现（前端做容错，phase 不存在时显示为 pending）
- 移动端响应式优化

---

## 技术约束

- `npm run build` 零 TypeScript 编译错误
- E2E 使用 `page.route()` mock API，不依赖真实 Brain 运行
- 自动刷新用 `useEffect` + `setInterval`，组件卸载时 `clearInterval`
