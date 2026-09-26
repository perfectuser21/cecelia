# 晨报/日报「业务断言红灯」行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主理人在晨报（Bark 一行）与日报（一个板块）看到过去 24h 业务探针 FAIL 回执汇总，按路径/步骤/探针 key 计数并分 RED/AMBER。

**Architecture:** 新 lib `assertion-red-report.js` 一份 SQL 读取 + 两个渲染；晨报 `morning-cockpit-bark.js` 与日报 `daily-report-generator.js` 各接一处，沿棒7/棒8 best-effort 形状（异常→null→不出行）。

**Tech Stack:** Node ESM、pg Pool（假 pool 单测）、vitest、bash smoke。

## Global Constraints

- 全部输出简体中文；禁碰版本五件套（package.json/package-lock/.brain-versions/DEFINITION 版本行），条目走 `changes/cp-0926203442-baton4-report.md`
- TDD：每个 task 先 failing test 再实现；commit-1 test / commit-2 impl
- 只依赖回执表形状（`executor_kind`、`verdict`、`scenario_evidence.severity`、`assertion_ref_snapshot='probe:<key>'`、`created_at`、`journey_step_link_id`）
- feat PR 必须新增 `packages/brain/scripts/smoke/assertion-red-report-smoke.sh` 并登记 `packages/quality/smoke-allowlist.txt`

---

### Task 1: lib `assertion-red-report.js`

**Files:**
- Create: `packages/brain/src/lib/assertion-red-report.js`
- Test: `packages/brain/src/lib/__tests__/assertion-red-report.test.js`

**Interfaces:**
- Produces: `readAssertionRedState(pool, {windowHours=24}) → Promise<State|null>`，
  `State = { level:'RED'|'AMBER', total:number, window_hours:number, groups:[{journey, step, probe_key, fail_count, severity:'error'|'warn', last_at}] }`；
  `renderAssertionRedLine(state) → string|null`；`renderAssertionRedSection(state) → string`；`PROBE_EXECUTOR_KIND`、`probeKeyOf(ref)`

- [ ] **Step 1: 写 failing test**（内容见 `packages/brain/src/lib/__tests__/assertion-red-report.test.js`，覆盖：error→RED / 只 warn→AMBER / 空→null / 查询失败不抛 / `probe:` 前缀去除 / severity 缺失按 warn / 行与板块文案 / 行最多 3 组步骤）
- [ ] **Step 2: 跑测试确认失败** `cd packages/brain && npx vitest run src/lib/__tests__/assertion-red-report.test.js` → FAIL（模块不存在）
- [ ] **Step 3: 实现 lib**（SQL：三表 JOIN，`executor_kind=$1 AND verdict='FAIL' AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')`，`GROUP BY j.name, s.name, r.assertion_ref_snapshot`，`BOOL_OR(scenario_evidence->>'severity'='error') AS has_error`，`ORDER BY has_error DESC, fail_count DESC`，`LIMIT 50`；10s 超时；异常 console.warn 返回 null）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 分两次 commit**（`test(brain): …` / `feat(brain): …`）

### Task 2: 晨报接线

**Files:**
- Modify: `packages/brain/src/morning-cockpit-bark.js`（import；`fetchAssertionRedLine` 并列 `fetchBareRunLine`；`Promise.all` 增项；`bareRunLine` 后 push）
- Test: `packages/brain/src/__tests__/morning-cockpit-bark.test.js`

**Interfaces:**
- Consumes: Task 1 的 `readAssertionRedState` / `renderAssertionRedLine`

- [ ] **Step 1: failing test**：假 pool `/FROM journey_assertion_receipts/` 返回 `[{journey:'客户智能获客路径', step:'Lead 表进人', assertion_ref:'probe:videos_readback', fail_count:3, has_error:true}]` → Bark 正文匹配 `/🔴 RED 断言红灯/` 且含 `videos_readback×3`；第二个用例该 SQL 抛错 → `sent:true` 且正文不含「断言红灯」
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 接线实现**
- [ ] **Step 4: 跑测试通过**（整个文件）
- [ ] **Step 5: commit**

### Task 3: 日报接线

**Files:**
- Modify: `packages/brain/src/daily-report-generator.js`（import；`export { renderAssertionRedSection }`；`buildReportText` 尾参 `assertionRed=null`；板块九；主流程 3.9 `readAssertionRedState(dbPool)`）
- Test: `packages/brain/src/__tests__/daily-report-generator.test.js`

- [ ] **Step 1: failing test**：`buildReportText('2026-09-26','2026-09-25',{count:0,keywords:[]},[],[],0,null,null,null,null,state)` 含 `== 业务断言红灯（24h）==` 与 `🔴 RED 共 4 次`；传 null 不含；导出 `renderAssertionRedSection`
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: commit**

### Task 4: smoke + allowlist + 版本碎片

**Files:**
- Create: `packages/brain/scripts/smoke/assertion-red-report-smoke.sh`（假 pool 跑真逻辑：error→RED 行、warn→AMBER、空→null、抛错→null；readFileSync 查晨报/日报接线）
- Modify: `packages/quality/smoke-allowlist.txt`（追加一行）
- Create: `changes/cp-0926203442-baton4-report.md`

- [ ] **Step 1: 写 smoke 并本地跑通** `bash packages/brain/scripts/smoke/assertion-red-report-smoke.sh` → `PASS`
- [ ] **Step 2: 登记 allowlist、写碎片**
- [ ] **Step 3: DevGate 三件 + 全量相关单测 + commit**
