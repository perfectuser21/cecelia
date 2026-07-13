# Design：/reports 日报骨架（relay-baton4 item3）

- 日期：2026-07-07；Brain task f607b2d3；分支 cp-07072121-battle-report
- 审查：Research Subagent APPROVE + 1 必改（migration 扩 design_docs type CHECK——195 实为 11 种白名单非放开，生产实测 battle_report 被拒）
- PrepPRD：sprints/07072121-battle-report/prep-prd.md（其中"不建 migration"一条作废，以本文为准）

## 范围（骨架第一刀；Line/Repo 下钻与 token 归因不做）

### 1. migration 316_design_docs_battle_report.sql
DROP + ADD `design_docs_type_check`，白名单 = 195 的 11 种 + `battle_report`。selfcheck.js `EXPECTED_SCHEMA_VERSION` '315'→'316'。

### 2. packages/brain/src/battle-report.js（新模块）
- `isInBattleReportWindow(now)`：UTC 22:00 且 minute<5（= 北京 06:00-06:05），照 daily-backup 先例
- `alreadyGeneratedToday(pool)`：design_docs 20h 内已有 type=battle_report → true
- `buildBattleReportData(pool)`：24h 窗口四段——
  ① merged PR：dev_records WHERE merged_at >= NOW()-'24 hours'（pr_title/pr_url）；**数据源现状：dev_records 自 2026-05-13 起无新写入，段落恒空需容忍（渲染"暂无"），接回写入链路留第二刀**
  ② 按线 run：抄 routes/harness.js by=journey SQL（JOIN journeys 排孤儿 + LEFT JOIN tasks 过滤 smoke-% + phase done/failed 聚合），窗口 24h
  ③ 用户决策：decisions WHERE made_by='user' AND created_at 窗口内（topic/created_at）
  ④ 哨兵摘要：working_memory scheduler_job_last_run:* + scheduler_jobs_expected（同 routes/sentinel.js 口径：ok && age<=1800）
- `renderBattleReportMarkdown(data)`：L1 Summary 四段 markdown，空段渲染"暂无"
- `generateBattleReport(pool)`：INSERT design_docs(type='battle_report', title='作战日报 YYYY-MM-DD'(上海日), content, area='cecelia', author='cecelia', diary_date=上海日) RETURNING id → `sendFeishu('作战日报已生成：http://perfect21:5211/reports/<id>?source=design_docs')`（best-effort，失败不回滚；不用 raise——非紧急告警不打 Bark）
- `maybeGenerateBattleReport(pool)`：window && !already → generate；否则 {skipped:true, reason}

### 3. scheduler-jobs.js
JOBS 加 `{ name:'battle-report', needsPool:true, timeoutMs:DEFAULT, handler:maybeGenerateBattleReport, description:'作战日报（北京06:00窗口+当日去重自 gate）' }`。
既有测试两处硬编码随改：job 名数组 toEqual + toHaveLength(5)→6（it 描述"4 个"笔误顺手改）。expected 自动+1；dead-man-switch EXPECT_KEYS_FALLBACK 4→6 顺手 bump（无害增敏）。

### 4. 前端（两页小改）
- ReportsListPage.tsx：并拉 `/api/brain/design-docs?type=battle_report&limit=20`（形状 `{success,data,total}`，列表无 content/summary）与现有 `/api/brain/reports`（`{reports,...}`）合并倒序；battle_report 项：title/created_at 映射、summary 固定"每日作战日报"、TYPE_LABELS 加 battle_report:'作战日报'；点击 `navigate('/reports/'+id+'?source=design_docs')`。合并逻辑抽纯函数 `mergeReportSources(sys, docs)` 供单测
- ReportDetailPage.tsx：`searchParams.get('source')==='design_docs'` 分支 fetch `/api/brain/design-docs/:id` 取 `json.data`，独立早返回渲染 `<pre whiteSpace:pre-wrap>{data.content}</pre>`（抄页面既有 pre 样式），不动现有渲染路径

### 5. 版本与守卫
- brain minor 1.239.0→1.240.0（四处同步）；smoke `packages/brain/scripts/smoke/battle-report-smoke.sh`（结构断言：模块导出/JOBS 注册/migration 白名单含 battle_report/selfcheck 316，proven-to-fire）
- DevGate 三连；lint-migration-unique-version（316 唯一）

## 测试策略
unit 档：brain 侧 battle-report.test.js（窗口边界 21:59/22:00/22:04/22:05、去重 gate、markdown 四段与空段容忍、generateBattleReport 落库+飞书调用 mock pool/notifier）；scheduler-jobs.test.js 更新；前端 mergeReportSources 纯函数单测。TDD 红绿。
行为层验收：部署后手动调 generateBattleReport 落一条真 design_docs + 飞书收到 + /reports 列表可见可点开。
