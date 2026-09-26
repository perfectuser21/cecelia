# 晨报/日报「业务断言红灯」行 — 设计（链 bf5088a3 棒4 消费）

任务 4ff8ad43 · 决策 702949b6 / ebcbc038

## 目标

棒3a 的业务探针（`executor_kind='business_probe_runner'`）把 PASS/FAIL 回执写进
`journey_assertion_receipts` 后，主理人要在晨报（Bark 一行）和日报（一个板块）看到
过去 24h 的 FAIL 汇总，按 路径/步骤/探针 分组计数并分级：任一 `severity=error` → RED，
只有 `warn` → AMBER，无 FAIL → 不出行/不出板块。

## 数据形状（只依赖形状，不依赖棒3a 已合并）

`journey_assertion_receipts`（migration 374）：`journey_step_link_id`、`run_id`、
`assertion_ref_snapshot`（探针为 `probe:<key>`）、`verdict` PASS|FAIL、
`scenario_evidence` JSONB `{observed, expected, op, severity:"warn"|"error", reason?}`、
`executor_kind`、`created_at`。经 `journey_step_links(id) → journey_steps(step_id).name` /
`journeys(journey_id).name` 取步名/路名。

## 组件

### `packages/brain/src/lib/assertion-red-report.js`（新）

- `PROBE_EXECUTOR_KIND = 'business_probe_runner'`，`WINDOW_HOURS = 24`
- `readAssertionRedState(pool)` → `{ level:'RED'|'AMBER', total, window_hours, groups:[{journey, step, probe_key, fail_count, severity:'error'|'warn', last_at}] } | null`
  - 单条 SQL：JOIN 三表，`WHERE executor_kind=$1 AND verdict='FAIL' AND created_at >= NOW() - INTERVAL '24 hours'`，
    `GROUP BY journey.name, step.name, assertion_ref_snapshot`，`BOOL_OR(scenario_evidence->>'severity'='error')`，
    `ORDER BY has_error DESC, fail_count DESC`，`LIMIT 50`
  - `probe_key` = `assertion_ref_snapshot` 去掉 `probe:` 前缀
  - severity 缺失/非 error 一律按 warn（宁低不高，仍可见）
  - 空集 → null；查询失败/超时（10s）→ `console.warn` 返回 null（best-effort）
- `renderAssertionRedLine(state)` → 晨报一行；null → null。
  `🔴 RED 断言红灯：<路名>/<步名> <key>×<n>, <key>×<n>；<路名>/<步名> …（24h）`
  最多列 3 个 路/步 组，超出加 `…`
- `renderAssertionRedSection(state)` → 日报板块；null → `''`。
  首行 `== 业务断言红灯（24h）==`，次行 `🔴 RED 共 N 次 FAIL（含 error 级）` / `🟡 AMBER 共 N 次 FAIL（仅 warn 级）`，
  每组一行 `  - 🔴|🟡 <路名> / <步名> · <key> ×<n>（error|warn）`，最多 20 组

### `morning-cockpit-bark.js`

`fetchAssertionRedLine(pool)` 与 `fetchBareRunLine` 并列（try/catch → null），
加入 `Promise.all`，`bareRunLine` 之后 push。

### `daily-report-generator.js`

import `readAssertionRedState` / `renderAssertionRedSection`，re-export
`renderAssertionRedSection`；`buildReportText(..., rescanStaleness=null, assertionRed=null)`
尾参，`if (assertionRed)` 出板块九；主流程 3.9 读状态。

## 错误处理

全部 best-effort：任何异常只 `console.warn`，晨报仍 `sent:true`，日报正常生成。

## 测试

- `lib/__tests__/assertion-red-report.test.js`：error→RED / 只 warn→AMBER / 空→null /
  查询失败不抛 / 渲染行与板块文案 / probe: 前缀去除 / severity 缺失按 warn
- `__tests__/morning-cockpit-bark.test.js`：假 pool 命中 `FROM journey_assertion_receipts` 返回
  FAIL 行 → Bark 正文含「断言红灯」；查询抛错 → 仍 sent:true 且无该行
- `__tests__/daily-report-generator.test.js`：`buildReportText` 传 state → 含板块；null → 不含
- smoke `scripts/smoke/assertion-red-report-smoke.sh`：假 pool 跑真逻辑 + readFileSync 查接线，
  登记 `packages/quality/smoke-allowlist.txt`

## 不做

- 不改回执表约束（executor_kind CHECK 由棒3a 放开）
- 不加 scheduler job、不写 working_memory
- 不碰版本五件套，条目走 `changes/cp-0926203442-baton4-report.md`
