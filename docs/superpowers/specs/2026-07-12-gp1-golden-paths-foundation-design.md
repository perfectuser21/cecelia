# Design: [GP1/7] T1 golden_paths 底座——新表+状态机+保质期 delta job

> 任务 0feee5d3 / plan=golden-path-mode T1。设计 SSOT：`docs/architecture/2026-07-12-golden-path-mode/architecture.md`
> （字段清单勿改）。本文档只记录 T1 落地时的实现级决策，不复述架构。验收对应 initiative-dod.md F1/F6/F7。

## 范围

1. `migrations/334_golden_paths.sql`：新表 golden_paths（DDL 照 architecture.md 原文，加 IF NOT EXISTS/COMMENT 仓库惯例）
2. `src/routes/golden-paths.js`：GET 列表(?status=) / POST 建 candidate / PATCH 状态机内部流转（select/approve/veto 三拍板端点在 T7，不做）
3. `src/gp-shelf-life.js` + scheduler-jobs 登记：保质期 delta + 报备否决窗自动生效
4. CI 两闸：smoke 脚本登记 smoke-allowlist + routes 同名 test 配对

既有 `golden_path`（单数）表及其 `/golden_path` 路由一字不动。

## 实现级决策

| 决策 | 选择 | 理由 |
|---|---|---|
| migration 编号 | 334（当前最大 333） | migrate.js 按文件名自动发现；同步改 selfcheck.js EXPECTED_SCHEMA_VERSION='334' |
| 索引命名 | `idx_golden_paths_status`（复数前缀） | 避免与既有 `idx_golden_path_*` 撞名混淆 |
| 路由路径 | `/api/brain/golden-paths`（复数连字符） | 与既有 `/golden_path`（单数下划线，FR 台账）区分；`/journeys/:id/golden-paths` 是不同资源不冲突 |
| PATCH 状态机模式 | 照 tasks.js `allowedTransitions` 映射 + 409 `INVALID_TRANSITION`（回传 allowed 数组） | 仓库现成范式，有测试先例 |
| 报备窗数据表示 | 报备中 = `status='converged' AND auto_release=true AND veto_deadline IS NOT NULL` | 与 gp-shelf-life"veto_deadline 过期未否决→自动生效 approved"语义自洽：窗内尚未 approved |
| approved 副作用 | 流转到 approved 时自动写 `approved_at=now()`，`review_after` 未显式给则默认 +14d | architecture.md：保质期默认 approved_at+14 天 |
| 测试栈 | vitest + supertest + `vi.mock('../../db.js')`（mock pool） | routes/__tests__/ 57 个同类文件的既有模式 |
| job 骨架 | 照 receipt-collector.js：模块级 `lastRunAt` 10min 自 gate + env 覆盖 + `__resetGpShelfLifeForTest()` + `needsPool:true` | 任务描述点名此模式 |

## 状态机流转表（PATCH 白名单）

活清单原则（解法⑦）：任何状态可捞回；superseded/delivered 为终态。

| from | 允许 to |
|---|---|
| candidate | proposed, rejected, superseded, blocked_gate |
| proposed | converged, rejected, superseded, blocked_gate |
| converged | approved, rejected, superseded, blocked_gate |
| approved | in_dev, expired, converged, superseded, blocked_gate |
| in_dev | delivered, superseded, blocked_gate |
| expired | converged, superseded, blocked_gate |
| rejected | candidate, superseded |
| blocked_gate | candidate, proposed, converged, approved, in_dev, superseded |
| delivered | superseded |
| superseded | （终态） |

> approved→converged 对应"否决→回批审"的内部流转载体（T7 veto 端点复用 PATCH 语义）。
> expired→converged 对应"重上批审段"。

## gp-shelf-life job 两条规则

1. **保质期**：`status='approved' AND review_after < now()`（且未 in_dev，即仍是 approved）→ `status='expired'` + `status_reason='保质期过期：approved 超 review_after 未开工（delta）'`
2. **报备窗自动生效**（b416bfb3）：`status='converged' AND auto_release AND veto_deadline < now()` → `status='approved'` + `approved_at=now()` + `review_after=now()+14d` + `status_reason='报备制自动生效：24h 否决窗过期无否决（b416bfb3）'`

单条 UPDATE...RETURNING 各跑一次，fail-open（DB 错只 warn），不 import notifier（防环，照 receipt-collector 纪律）。

## 测试策略（integration 档：mock-db 单测 + 容器 smoke）

- `src/routes/__tests__/golden-paths.test.js`：GET 全量/按 status 过滤；POST 201（默认 status=candidate、source 枚举校验 400、缺 title/one_liner 400）；PATCH 合法流转 200、非法流转 409 INVALID_TRANSITION、不存在 404、approved 副作用（approved_at/review_after 注入）
- `src/__tests__/gp-shelf-life.test.js`：10min gate skip；过期 approved 翻 expired；报备窗过期翻 approved 留痕；两条 SQL 参数断言
- `packages/brain/scripts/smoke/golden-paths-t1-smoke.sh`（登记 smoke-allowlist.txt）：真 postgres+容器 brain 上 POST→GET→PATCH 合法/非法全链，非法状态 INSERT 被 CHECK 拒（DoD F1）
- TDD 两段 commit：commit-1 失败测试 / commit-2 migration+实现变绿

## 改动文件清单

新建：`migrations/334_golden_paths.sql`、`src/routes/golden-paths.js`、`src/routes/__tests__/golden-paths.test.js`、`src/gp-shelf-life.js`、`src/__tests__/gp-shelf-life.test.js`、`scripts/smoke/golden-paths-t1-smoke.sh`（均在 packages/brain 下）
修改：`server.js`（import+挂载）、`src/scheduler-jobs.js`（import+JOBS 条目）、`src/selfcheck.js`（334）、`packages/quality/smoke-allowlist.txt`、版本四处（package.json/package-lock/.brain-versions/DEFINITION.md）
