## Brain {VERSION} — 获客三张 Notion 镜子库登记 + Activity 页加「裁判结论」「生产版本」两列

任务 f6ad056e，决策 a029a7a7（PG 为真身，Notion 内部看，飞书给客户）。

- 迁移 540：「获客·视频 / 获客·评论 / 获客·线索」三张 Notion 库（挂在「数据落脚总台账 › 获客业务数据（PG 镜像）」）以 mirror/push/active 登记进 `notion_projection_map`，`brain_table` 为空（真身在 hk-vps `zenithjoy.leadgen_*`），血管为 zenithjoy-workspace `leadgen-notion-mirror.js`（MMV launchd 每 5 分钟）；登记后镜子库探活自动覆盖。附回滚。
- 六层目录 Activity 库新增两列：「裁判结论」= `activity_judgments` 最新一条 verdict 翻中文 + 连续绿/要求绿（如「收敛 · 连续绿 3/3」，没裁判过写「未裁判」）；「生产版本」= 发布线生产版指针，发布线未接线前留空。缺列由 `ensureDirectorySchemas` 自动补，列来源登记进 `DIRECTORY_COLUMN_SOURCES`。
