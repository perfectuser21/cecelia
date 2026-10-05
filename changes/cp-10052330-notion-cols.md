## Brain {VERSION} — 树+仓库 v3.0 第 3 刀 b/c 段：Notion 的 Activity 页补 15 列和 8 格颜色，Step 页补三列，新增仓库物件库与用料库

- 仓库物件库、用料库（c 段）：迁移 524 给 `warehouse_items` / `activity_uses` 补 Notion 记账列；新模块 `notion-warehouse-projection` 把仓库物件（8 个货架选项带色，「被用于」列出用到它的 Activity）和用料（Activity、物件各一个 relation）单向推到 Notion。库缺就在目录父页下建（带来源标记，认领同名同标记库，建后登记注册表，重跑不重复建）。Notion API 建不了按货架过滤的视图，库里的「货架」选项列按它分组/过滤即是 8 个货架视图。

- 任务 f4f75a20：目录投影（Brain → Notion 六层目录库）给 Activity 页加机器列：承诺、输入、输出、前提、不变量、NFR、失败语义、读回、判定点、对抗、保质期（天）、用料，再加 8 个格子列（格·承诺 … 格·保质期），颜色取自 `activity_cells` 的 8 个标准格：🟢 绿、🔴 红、🟡 待判、⚪ 灰。缺格按灰，子项格（场景检查）不进卡片，不会串到别的 Activity。
- Step 页补「动作」「失败处理」「模式」三列（`steps` 的 action / on_fail / mode）。
- 列名与取值集中在 `projection/activity-card.js`，目录 schema 建列与目录源构造行共用，改一处两边一致；空值不编造。库里缺的列由目录投影器每轮 `ensureDirectorySchemas` 自动补，格子列带颜色选项。
- 目录源 SQL 增载 `activity_cells` 与 `activity_uses`，真 PG 测试覆盖。人在 Notion 上改这些列会被下一轮覆盖：以后怎么改，改 Brain 真身（合同/技能沉淀），Notion 自动跟。
