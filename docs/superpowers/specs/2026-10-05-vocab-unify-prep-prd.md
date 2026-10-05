# 小改动 PrepPRD：词表统一——面向人的 Journey/Golden Path 文案与 Notion 库标题改为标准词表

## 改什么
- 迁移 518：`notion_projection_map.title` 5 条同步为 Notion 已改的新标题
  （AI Journey→价值流与能力（journeys）；Backbone Activities→Activity（活动）；承诺地图格子→Activity 卡片格子；Workflows 总库→流程（workflows）；AI Feature→旧树 · Feature（只读，待退役））
- Dashboard 面向人的文案 4 文件 6 处：
  - apps/api/features/shared/pages/FeatureDashboard.tsx：「Golden Path Coverage」「Golden Path」→ 能力
  - apps/api/features/system/pages/LedgerPage.tsx：tooltip「Journey E2E 路径」→ 价值流
  - apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx：「该 Capability 未关联 Journey」×2 → 该能力未关联价值流
  - apps/dashboard/src/pages/reports/ReportDetailPage.tsx：「GP 拍板控制台」→ 能力拍板控制台

## 为什么改
框架标准 v2.0 术语表（主理人 10-05 拍板）：Journey/GP/Golden Path/Backbone 统一为 价值流/能力/流程/Activity。Notion 库标题已改，Brain 注册表要跟上，否则投影对账报告里显示旧名。

## 关联上下文
- 决策 cebd1540（small-change）；标准《AI 原生公司系统框架 v2.0》术语对照表
- 任务 726ca1b7

## 影响范围
- 不改表名、列名、API 路径、TypeScript 标识符（标准不规定实现）
- `notion_projection_map` 的 title 只用于日志/对账报告展示，代码按 notion_db_id 查找，无行为变化

## 验收标准
- [x] 迁移 518 + 回滚文件；测试断言 5 条标题
- [x] 4 个页面文案改为标准词表，测试断言
- [x] CI 全绿
