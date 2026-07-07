# warroom 四板块动态化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WarRoomPage 新增四板块（战况横幅+哨兵灯 / 接力史流 / 决策流）接真数据。

**Architecture:** 新文件 WarRoomPanels.tsx 承载纯函数 + 三组件（BattleBanner 含哨兵灯、HandoffStream、DecisionStream），各自独立 fetch + 60s 轮询 + 失败静默；WarRoomPage.tsx 三处最小接线。Spec: docs/superpowers/specs/2026-07-07-warroom-dynamic-panels-design.md

**Tech Stack:** React + TS + Tailwind（深色 slate 系）+ vitest（纯函数单测，从 .tsx import 有先例）。

**约束：** TDD——commit-1 失败测试 / commit-2 实现。测试命令：`cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/WarRoomPanels.test.ts`。

---

### Task 1: WarRoomPanels.tsx（纯函数 TDD + 组件）

**Files:**
- Test: `apps/dashboard/src/pages/warroom/__tests__/WarRoomPanels.test.ts`（新建）
- Create: `apps/dashboard/src/pages/warroom/WarRoomPanels.tsx`

- [ ] Step 1: 写失败测试（六个纯函数 + 容错分支，完整测试代码见实现者 prompt，要点：journeyStatRows 的 success_rate ×100 / last_failure 截断 36 字符 + 原文保留 / 非对象容错；handoffRows 取 resp.handoffs / next_steps[0] 回退空串；decisionRows 裸数组 / 上海日期 YYYY-MM-DD；sentinelLight age_seconds 边界 1800 绿 1801 黄 / ok=false 黄；sentinelRows 自算 healthy（全绿 且 数量>=expected 且 expected 非 null）；pctLabel null→"—"）
- [ ] Step 2: `npx vitest run` 确认 FAIL（模块不存在）
- [ ] Step 3: commit-1 `test: warroom 四板块纯函数失败测试`
- [ ] Step 4: 实现 WarRoomPanels.tsx（纯函数 + BattleBanner/HandoffStream/DecisionStream，复用 WarRoomPage 的 relativeTime/verdictMeta；fetch 失败 setData(null) 静默；60s setInterval + cleanup）
- [ ] Step 5: 测试全绿
- [ ] Step 6: commit-2 `feat(dashboard): warroom 四板块组件（战况横幅/哨兵灯/接力史/决策流）`

### Task 2: WarRoomPage 接线 + 构建验证

**Files:**
- Modify: `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`（import + 两处插入）

- [ ] Step 1: import { BattleBanner, HandoffStream, DecisionStream } from './WarRoomPanels'
- [ ] Step 2: 顶栏 div 结束后（`{/* ── 三栏 ── */}` 注释之前）插 `<BattleBanner />`
- [ ] Step 3: 跨线总览分支 `!inLineView` 的 `<>` 内、`{loading && !data && (` 之前插 `<div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 pt-3"><HandoffStream /><DecisionStream /></div>`
- [ ] Step 4: `cd apps/dashboard && npx vitest run`（全量，含既有 WarRoomPage.test.ts 不回归）+ `npx vite build` 通过（vite 无类型检查，build 过 = 语法/import 闭合）
- [ ] Step 5: commit `feat(dashboard): WarRoomPage 接入四板块（保留三栏/Line 树结构）`

## Self-Review
- Spec 覆盖：四板块 → Task 1 组件 + Task 2 接线；测试策略 → Task 1；无占位符；类型一致（字段名 age_seconds/next_steps/journeys/handoffs 均按实测）✓
