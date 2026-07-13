# 小改动 PrepPRD：/reports 日报骨架（battle-report）

以 docs/superpowers/specs/2026-07-07-battle-report-design.md 为准（本 PrepPRD 初稿中"不建 migration"一条已被设计审查推翻：migration 195 实为 11 种白名单，需 316 扩入 battle_report）。

## 改什么（摘要）
1. migration 316：design_docs_type_check 白名单 + battle_report；selfcheck 315→316
2. packages/brain/src/battle-report.js：窗口自 gate（北京 06:00，照 daily-backup）+ 24h 四段聚合（merged PR[dev_records，注：该表 05-13 起无新写入，段落恒空容忍]/按线 run[抄 harness stats by=journey SQL]/用户决策/哨兵摘要）→ markdown 落 design_docs + sendFeishu 链接（best-effort）
3. scheduler-jobs.js JOBS +battle-report（既有测试两处硬编码随改；dead-man-switch EXPECT_KEYS_FALLBACK 4→6）
4. 前端：ReportsListPage 合并 design-docs?type=battle_report 源（mergeReportSources 纯函数）；ReportDetailPage source=design_docs 分支渲染 content

## 验收标准
- [ ] brain/前端单测 TDD 红绿；DevGate + CI 全绿；smoke proven-to-fire
- [ ] 部署后手动 generateBattleReport 落真 design_docs + 飞书收到链接 + /reports 可见可点开
