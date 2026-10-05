## Brain {VERSION} — 流程层登记：旧 ability 转 workflows 流程，闹钟总账全部挂到流程

- 迁移 519（框架标准 v2.0，任务 6741b288）：树补齐「流程」层——22 条旧树 ability（能力 × 平台/渠道）转成 `workflows` 行并挂到 部门→价值流→能力 下（新列 `legacy_feature_id` 溯源）；26 个有闹钟但没流程的能力各补一条默认「定时作业」流程（关键词获客复用 `douyin_keyword_leadgen`）。
- 闹钟总账 `ops_schedule_entries`：先归位能力（经营节奏价值流上 11 条 OKR 闹钟→G5 战略 OKR；40 条未挂的按实际归位到 执行资源池/清理与容量/监控与告警/分发与同步/数据投影/账号凭据/网络入口/F1/经营对象/内容日历/关键词获客；收盘报告→经营播报；投资系统 run_daily、热点/天气保持个人区），再按 能力→流程 回填 `workflow_id`。生产演练：能力下无流程的活动闹钟 0 条、挂价值流 0 条、383 条有流程。
- 旧树 `journey_features` 只标 deprecated 不删：PC 端发布套 21 条（决策 117660b0 整套淘汰）、与能力重名/重复 11 条、已转换 22 条（`workflow_ref` 指向新流程 key）、smoke/e2e 垃圾；两条 10-05 误建的重复能力退役。原值进 `migration_519_backup`，回滚脚本按备份还原。
- 回归：`migration-519-workflow-layer.test.js`（先红后绿）；scratch 库 up→down→up→up 幂等验证通过。
