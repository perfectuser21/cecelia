## Brain {VERSION} — 删除 D 类 7 张空表连引用代码（个人页面/开发日志/开发评审/模型额度快照/内容选题/心跳历史/项目仓库）

- 迁移 484：删 alex_pages、dev_execution_logs、dev_reviews、llm_usage_snapshots、content_topics、tick_history、project_repos（非空闸、无 CASCADE、回滚=生产 pg_dump -s）；生产结构副本实测闸拦截/up/down/重放。
- 同 PR 删引用代码：`routes/alex-pages.js`（及 server 挂载）、`routes/dev-logs.js`（从未挂载）、`routes/dev-reviews.js` + `review-parser.js`（及 routes 汇总挂载）、analytics 的 `compute-snapshot` / `compute-usage` 两接口、capture-atoms `content_seed` 分支（改判返回 400；决策 959d081f：内容走 Notion 真身）、metrics 对 tick_history 的读取（该表从无写入方，响应时间指标行为不变）、executor.resolveRepoPath 的 project_repos 首查（本就容错缺表）。
- 看板随手记复核页去掉「内容种子」「事件」两个已无后端分支的选项。
- 不在本 PR：topic_decision_feedback（周报写+选题读的活回路，待主理人定）；user_annotations、life_events（看板页面，另开 PR）。
