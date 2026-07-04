# Sprint PRD：Relay 进度条 Dashboard 页面

**Task ID**: d56d5ad9-0e03-4106-8b38-23507bb14dc6
**Sprint Dir**: sprints/07050450-relay-progress-dashboard
**Branch**: cp-07050456-ws-d56d5ad9
**日期**: 2026-07-04

---

## 目标

在 Cecelia Dashboard 新增「Relay 进度」页面，从 `GET /api/brain/orchestrator/relay-runs` 拉取数据，将每个活跃 initiative 渲染为七段横向进度条，让主理人一眼看清每个 harness 任务跑到哪一棒。

---

## 数据源

**API**：`GET /api/brain/orchestrator/relay-runs`（已上线）

**七段 Phase 顺序**：`planning → gan → generate → evaluate → judge → merge → report`

**查询参数**：`?limit=20`、`?phase=<phase>`、`?since=<ISO8601>`

---

## 新增文件

```
apps/dashboard/src/pages/harness-pipeline/RelayProgressPage.tsx
apps/dashboard/e2e/relay-progress.spec.ts
```

**修改文件**：`DynamicRouter.tsx`（lazy import）、路由接入（静态或动态）

---

## Golden Path（用户验收流程）

1. 打开 `http://localhost:5174/relay-progress`
2. 看到进度条容器，七段 phase 标签均可见
3. 每条 initiative 显示短码（前 8 位）+ 当前 phase badge
4. 无活跃 relay 时显示"暂无进行中的 relay"空态
5. 页面每 15 秒自动刷新

---

## E2E 验收（mac_web Playwright）

**文件**：`apps/dashboard/e2e/relay-progress.spec.ts`

- **TC-1**：`[data-testid="relay-progress-list"]` 元素可见
- **TC-2**：七段 phase 标签（Planning/GAN/Generate/Evaluate/Judge/Merge/Report）全部在 DOM
- **TC-3**：mock API 返回一条 initiative，短码 `abcd1234` 渲染可见
- **TC-4**：mock API 返回空数组，"暂无进行中的 relay"文案可见

---

## DoD Checklist

- [ ] 路由 `/relay-progress` 可访问，`RelayProgressPage.tsx` 新建
- [ ] 七段进度条 HTML 结构正确，已完成/当前/未到有视觉区分
- [ ] 每行显示 initiative_id 短码（前 8 位）+ 当前 phase 文字
- [ ] 无活跃 relay 时显示空态文案
- [ ] 页面每 15 秒自动刷新
- [ ] Playwright TC-1/TC-2/TC-3/TC-4 全部通过
- [ ] `npm run build` 无 TypeScript 编译错误
- [ ] CI（workspace-ci.yml）绿灯

---

## 不在本 Sprint 范围

- relay-runs API 修改（已上线，本 sprint 只消费）
- judge/merge/report 三段后端实现（前端做容错）
- 移动端响应式优化

---

## Invariant 约束

暂无跨 sprint invariant（journey_id bb8cc561 当前无硬性约束记录）

---

## 累积 FR

暂无累积 FR

---

## NFR

- E2E 环境：mac_web（本机 Playwright，localhost:5174）
- 自动刷新间隔：15s

journey_type: web_ui
target_environment: mac_web
