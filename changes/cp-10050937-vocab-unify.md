## Brain {VERSION} — 词表统一：Notion 镜子库标题同步 + Dashboard 面向人的文案改为标准词表

- 迁移 518：`notion_projection_map` 5 条标题同步为 Notion 已改的新名（价值流与能力（journeys）/ Activity（活动）/ Activity 卡片格子 / 流程（workflows）/ 旧树 · Feature（只读，待退役））。按 `notion_db_id` 定位，只改 `title`，带回滚。框架标准 v2.0 术语表，决策 cebd1540。
- Dashboard 面向人的文案 4 文件 7 处：Golden Path / GP / Journey → 能力 / 价值流（FeatureDashboard、LedgerPage、WarRoomGoldenPathPage、ReportDetailPage）。表名、列名、API 路径、TypeScript 标识符不动。
- 回归：`migration-518-vocab-unify-titles.test.js`、`scripts/vocab-unify-labels.test.mjs`（守卫：JSX 文本与 label/tooltip 里不得再出现旧词；实测抓到一处漏改的表头）。任务 726ca1b7。
