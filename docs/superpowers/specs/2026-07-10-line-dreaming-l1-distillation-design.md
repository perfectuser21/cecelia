# Design: dreaming L1 —— line 级夜间蒸馏 job

日期：2026-07-10
状态：approved（autonomous /dev 路径B，Research Subagent 代批）
关联 PrepPRD：`sprints/07100726-line-dreaming-l1-distillation/prep-prd.md`
关联 decision：`0a2cb901-7b5b-45a5-84f8-cea0956f5ed7`

## 背景

`diary-scheduler.js`（日报）、`daily-review-scheduler.js` 里的 `triggerArchReview`（架构巡检）与 `maybeTriggerStrategySession`（战略会触发）三个日级任务，各自独立重新查询 24h 原始数据（decisions/issues/runs/…），存在口径可能漂移、重复查询的问题。本设计新增一个"L1 夜间蒸馏 job"：每晚在这三者之前跑一遍，把每条 active line（journey）的 24h 事实蒸馏成一份 L2 摘要落库，三个 L3 消费方读它而不是各自重查。

## 架构

沿用 `scheduler-jobs.js` 现有注册表模式（`battle-report.js` 是最贴近的先例：窗口判断 + 20h 去重 + design_docs 写入）。

```
scheduler-jobs.js JOBS[]
  ...
  { name: 'line-dreaming', handler: maybeRunLineDreaming }   ← 新增，排在 battle-report 之前
  { name: 'battle-report', handler: maybeGenerateBattleReport }
  ...
```

新文件 `packages/brain/src/line-dreaming.js`，导出：

- `isInLineDreamingWindow(now)` — UTC 21:00-21:05（北京 05:00-05:05），早于 battle-report 的 UTC 22:00 一小时
- `alreadyDreamedToday(pool, journeyId)` — 20h 内该 journey 是否已有 `type='line_ledger'` 记录
- `getActiveJourneys(pool)` — `SELECT id, name FROM journeys WHERE status='active'`
- `buildLineDreamData(pool, journeyId)` — 拉 24h 六段切片
- `renderLineLedgerMarkdown(data)` — 渲染 markdown（空段"暂无"）
- `upsertLineLedger(pool, journeyId, journeyName, markdown)` — 20h 内存在则 UPDATE，否则 INSERT
- `generateLineLedger(pool, journeyId, journeyName)` — 组合以上三步
- `maybeRunLineDreaming(pool)` — 窗口判断 → 遍历 active journeys → 逐条去重+生成，单条失败不影响其他 journey（catch 后 continue，仿 `runSchedulerJobsOnce` 的单 job 隔离思路，这里是单 journey 隔离）

## 数据切片（六段，每段独立 try/catch 容错留空）

| 段 | 查询 |
|---|---|
| 决策 | `SELECT d.* FROM decisions d JOIN journey_features jf ON d.target_id=jf.id WHERE d.target_type='journey_feature' AND jf.journey_id=$1 AND d.created_at >= NOW()-'24h'` |
| 推进项变化 | `SELECT * FROM advancement_items WHERE journey_id=$1 AND updated_at >= NOW()-'24h'` |
| Issue 变化 | `SELECT * FROM issues WHERE journey_id=$1 AND updated_at >= NOW()-'24h'` |
| Run 战况 | 复用 `battle-report.js` 里 `initiative_runs JOIN journeys` 的口径，按 `journey_id=$1` 过滤，24h 窗口 |
| Learnings（尽力关联） | `SELECT l.* FROM learnings l JOIN tasks t ON l.task_id=t.id WHERE t.payload->>'journey_id'=$1 AND l.created_at >= NOW()-'24h'` —— `task_id` 或关联失败时该段为空，不报错 |
| 军师留痕 | `SELECT * FROM notes WHERE title LIKE '军师决策[' \|\| $2 \|\| ']%' AND created_at >= NOW()-'24h'`（`$2` = journey name） |

## design_docs 落库

- migration（编号取仓库当前最大 migration+1）：`design_docs_type_check` 白名单加 `line_ledger`；若 `design_docs` 无 `journey_id` 列则新增（`UUID REFERENCES journeys(id)`，`IF NOT EXISTS` 幂等）
- upsert 逻辑：先查 `type='line_ledger' AND journey_id=$1 AND created_at >= NOW()-20h`，命中则 `UPDATE ... SET content=$2, updated_at=NOW()`，否则 `INSERT`

## L3 三文档改造

1. **diary-scheduler.js**：`fetchKRProgress`/`fetchTodayFailedTasks` 之外新增 `fetchLineLedgersSummary(pool)` — 查 20h 内所有 `type='line_ledger'` 记录，拼进日报的"各线动态"新段落；不删除现有段落，只新增数据源。
2. **daily-review-scheduler.js `triggerArchReview`**：建 `arch_review` 任务前，查相关 line 的最新 `line_ledger`，拼进任务 `description`（供 arch-review skill 直接读，不必自己重新调研 24h 事实）。
3. **daily-review-scheduler.js `maybeTriggerStrategySession`**：同上，把相关 line 的 `line_ledger` 摘要注入 `strategy_session` 任务 `payload.line_context`。

三处改造都是"新增数据注入"，不改变三个下游的现有输出结构/触发条件，风险可控。

## 测试策略

- **Unit（vitest，mock pool，仿 `battle-report.test.js` 模式）**：
  - `isInLineDreamingWindow` 边界（UTC 20:59/21:00/21:04/21:05）
  - `alreadyDreamedToday` SQL 断言（含 `line_ledger`/`20 hours`/`journey_id` 关键字）
  - `buildLineDreamData` 六段查询各自被正确调用 + 单段查询抛错时该段为空、不影响其他段
  - `renderLineLedgerMarkdown` 空数据渲染"暂无"，有数据渲染正确条目
  - `upsertLineLedger` 命中 20h 内记录走 UPDATE、否则走 INSERT
  - `maybeRunLineDreaming` 非窗口期不执行；窗口期遍历 active journeys，单 journey 失败不阻断其他 journey
  - `diary-scheduler.js`/`daily-review-scheduler.js` 改动点：mock pool 断言新增的 `line_ledger` 查询被调用、原有查询逻辑不变
- **Integration/CI 冒烟**：无需真实 API/账号，全部走 DB mock，纯逻辑，无需 manual 脚本
- **trivial**：无 UI/无外部依赖，不需要 E2E

## 不包含

- 不做 line 数量增长后的分批/并发优化（当前 active journey 数量个位数，5 分钟 timeout 够用）
- 不改变 diary/arch_review/strategy_session 的现有触发窗口与去重逻辑，只新增数据源
- 不处理 `decisions` 表里无法关联到任何 `journey_feature` 的决策（保持为空，不做语义兜底匹配）
