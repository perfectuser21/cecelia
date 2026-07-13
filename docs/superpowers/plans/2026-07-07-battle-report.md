# battle-report 日报骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日北京 06:00 自动产 L1 作战日报落 design_docs + 飞书链接，/reports 可看。

**Architecture:** 见 docs/superpowers/specs/2026-07-07-battle-report-design.md（唯一细节来源，实现者必读）。四个 Task：migration+selfcheck → brain 模块 TDD → scheduler 注册+既有测试更新 → 前端两页+纯函数 TDD；最后 smoke+版本 bump。

**Tech Stack:** Node ESM + pg（mock pool 单测照 routes/__tests__ 惯例）；React+TS（照 WarRoomPanels 先例）；vitest。

**约束：** TDD 铁律 NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；commit-1 失败测试 / commit-2 实现。brain 测试 `cd packages/brain && npx vitest run <file>`；dashboard 测试需 `ESBUILD_BINARY_PATH`（主仓 esbuild 污染，见 learning cp-07071806）。

---

### Task 1: migration 316 + selfcheck bump
- [ ] `packages/brain/migrations/316_design_docs_battle_report.sql`：DROP CONSTRAINT IF EXISTS design_docs_type_check → ADD 白名单 = 195 的 11 种 + 'battle_report'（照 195 文件格式，注释别照抄它的"Migration 194"笔误）
- [ ] `packages/brain/src/selfcheck.js` EXPECTED_SCHEMA_VERSION '315'→'316'
- [ ] commit `feat(brain): migration 316 — design_docs type 白名单加 battle_report`

### Task 2: battle-report.js（TDD）
- [ ] commit-1：`packages/brain/src/__tests__/battle-report.test.js` 失败测试（mock pool + mock notifier）：窗口边界（UTC 21:59F/22:00T/22:04T/22:05F）、alreadyGeneratedToday 真假、buildBattleReportData 四段 SQL 形状断言（journeys JOIN/smoke-% 过滤/made_by='user'/scheduler_job_last_run 前缀）、renderBattleReportMarkdown 四段齐+空段"暂无"、generateBattleReport INSERT design_docs 参数含 battle_report + sendFeishu 收到 perfect21:5211 链接 + 飞书失败不抛、maybeGenerateBattleReport 窗口外 skipped
- [ ] commit-2：`packages/brain/src/battle-report.js` 实现（细节按 spec §2；sendFeishu 动态 import 或顶部 import from './notifier.js'——mock 用 vi.mock('../notifier.js')）
- [ ] 全绿后 commit

### Task 3: scheduler 注册 + 既有测试更新
- [ ] commit-1：更新 `packages/brain/src/__tests__/scheduler-jobs.test.js`——job 名数组加 'battle-report'、toHaveLength(5)→6、it 描述"4 个"笔误改、新 handler mock（vi.mock('../battle-report.js')）；先跑确认红
- [ ] commit-2：`packages/brain/src/scheduler-jobs.js` JOBS 加条目（spec §3）+ `scripts/sentinel/dead-man-switch.sh` EXPECT_KEYS_FALLBACK 4→6；测试绿
- [ ] commit

### Task 4: 前端两页（TDD）
- [ ] commit-1：`apps/dashboard/src/pages/reports/__tests__/report-sources.test.ts` 失败测试：`mergeReportSources(sys, docs)` 合并倒序/battle_report 项映射（summary='每日作战日报'、source='design_docs'）/两源任一非法容错 []
- [ ] commit-2：合并纯函数放 `apps/dashboard/src/pages/reports/report-sources.ts`（新文件，两页共用）；ReportsListPage 并拉两源 + TYPE_LABELS 加 battle_report + battle_report 行 navigate 带 ?source=design_docs；ReportDetailPage source 分支 fetch design-docs/:id 取 json.data 渲染 pre（spec §4）
- [ ] `cd apps/dashboard && npx vitest run` 全绿 + `npx vite build` 通过；commit

### Task 5: smoke + 版本 bump + DevGate
- [ ] `packages/brain/scripts/smoke/battle-report-smoke.sh`：断言 battle-report.js 导出四函数/scheduler-jobs.js 含 'battle-report'/migration 316 含 battle_report/selfcheck 316；proven-to-fire（注释掉 JOBS 行式断言看真红再恢复）
- [ ] brain bump 1.239.0→1.240.0：**手编**（勿跑 npm version——上次触发 node_modules reify 副作用）package.json + package-lock 两处 + .brain-versions 追加 + DEFINITION.md
- [ ] DevGate：facts-check + check-version-sync + node --check server.js 全 ✅；`npx vitest run src/__tests__/battle-report.test.js src/__tests__/scheduler-jobs.test.js` 绿
- [ ] commit `chore(brain): bump 1.240.0 + battle-report smoke`

## Self-Review
- Spec 覆盖：§1→T1 / §2→T2 / §3→T3 / §4→T4 / §5→T5 ✓；无占位符（细节指向 spec 对应节）✓；lint-tdd-commit-order：T2 commit-1 测试先行覆盖后续 brain src ✓；lint-test-pairing：battle-report.js ↔ __tests__/battle-report.test.js 命名配对 ✓
