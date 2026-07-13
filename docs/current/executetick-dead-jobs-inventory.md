# executeTick 死 job 处置清单（migration-orphan-audit）

> 本清单满足 **migration-orphan-audit 铁律**：替换核心调度器时必须清点被留下的孤儿调用，
> 逐个给出「迁移 / 待迁移 / 废弃」处置，不允许静默丢弃。
>
> **背景**：`executeTick()`（`packages/brain/src/tick-runner.js`）自 **Wave 2（2026-05-04）** 调度重构后
> 不再被 tick-loop 调用（`tick-loop.js` 只调新的纯派发 `runScheduler`）。挂在 executeTick 里的所有定时/巡检/
> 汇报/触发类调用因此全部成为死代码。本 PR（作战循环 P1-PR1）用声明式注册表 `scheduler-jobs.js`
> 恢复其中最关键的 4 个，其余按下表分期处置。
>
> **处置图例**：✅ 已迁移 scheduler-jobs（本 PR）  ·  ⏳ 待迁移（后续期）  ·  🗑 建议废弃（死/重复/已有活触发）
>
> **行号**：均为本 PR 插入 DEPRECATED 注释后的 tick-runner.js 行号（调用行本身）。

## 一、清单（40 条）

| # | 调用 | tick-runner 行号 | 处置 | 归属期 | 理由 |
|---|------|-----------------|------|--------|------|
| 1 | `maybeTriggerStrategySession(pool)` | :1044 | ✅ 已迁移 | P1-PR1 | 军师应急触发（active_goals=0），本 PR 注册为 strategy-trigger job，自带 24h 冷却+幂等 |
| 2 | `deptHeartbeatPlugin.tick(now, tickState)` | :1524 | ⏳ 待迁移 | P3 | 部门心跳，依赖 tickState 上下文；军师上岗后随意识循环一并重挂 |
| 3 | `triggerDailyReview(pool)` | :1539 | ⏳ 待迁移 | P1 后续 | code_review 调度，是路径 A 自动发现 bug 的前提，P1 收尾补上 |
| 4 | `triggerArchReview(pool)` | :1546 | ✅ 已迁移 | P1-PR1 | 架构巡检，本 PR 注册为 arch-review job，自带 4h 窗口+guard |
| 5 | `generateDailyDiaryIfNeeded(pool)` | :1551 | ⏳ 待迁移 | P2 | diary 机制，P2 重生为对齐会/战报生成器，不原样复活 |
| 6 | `runConversationDigest()` | :1560 | ✅ 已迁移 | P1-PR1 | 对话日志提炼，本 PR 注册为 conversation-digest job |
| 7 | `runCaptureDigestion()` | :1565 | ✅ 已迁移 | P1-PR1 | capture 消化=想法箱进箱通道，本 PR 注册为 capture-digestion job（拍板7 依赖） |
| 8 | `runRumination(pool)` | :1570 | 🗑 建议废弃 | — | consciousness.graph.js 的 ruminationNode 已有活触发，双触发有害 |
| 9 | `updateNarrative(emotion, pool)` | :1576 | ⏳ 待迁移 | P3 | 内在叙事更新（每小时），意识层，随军师/意识循环重整 |
| 10 | `collectSelfReport(pool)` | :1580 | ⏳ 待迁移 | P3 | 欲望轨迹采集（6h），意识层 Layer 4 |
| 11 | `runDailyConsolidationIfNeeded(pool)` | :1586 | 🗑 建议废弃（重复） | — | **与 server.js:815 Daily Memory Consolidation 活 loop 重复**（同一函数 consolidation.js，30min 轮询已在跑）；此死调用直接删 |
| 12 | `feedDailyIfNeeded(pool)` | :1591 | ⏳ 待迁移 | P3 | NotebookLM 喂入（每日），意识/记忆层 |
| 13 | `runSynthesisSchedulerIfNeeded(pool)` | :1597 | ⏳ 待迁移 | P3 | 分层记忆压缩（daily/weekly/monthly synthesis） |
| 14 | `flushAlertsIfNeeded()` | :1602 | ⏳ 待迁移 | P2 | 分级报警刷新（P1每小时/P2每日）；与 P1 死人开关告警链相关，P2 一并梳理 |
| 15 | `check48hReport(pool)` | :1606 | ⏳ 待迁移 | P2 | 48h 系统简报，并入 P2 战报体系（现存内容停在 2026-05-04 同日死亡） |
| 16 | `scanEvolutionIfNeeded(pool)` | :1610 | 🗑 建议废弃（重复） | — | **与 server.js:700 Evolution Scanner 活 loop 重复**（同一函数 evolution-scanner.js，24h 已在跑）；此死调用直接删 |
| 17 | `synthesizeEvolutionIfNeeded(pool)` | :1615 | ⏳ 待迁移 | P3 | 进化叙事合成（7天），意识层 |
| 18 | `triggerContractScan(pool)` | :1620 | ⏳ 待迁移 | P2 | 每日契约扫描（模块边界测试覆盖），质量巡检类 |
| 19 | `triggerDailyTopicSelection(pool)` | :1624 | ⏳ 待迁移 | P2 | 每日内容选题，内容流水线子系统 |
| 20 | `autoPromoteSuggestions(pool)` | :1628 | ⏳ 待迁移 | P2 | 选题推荐自动晋级，内容流水线子系统 |
| 21 | `triggerDailyPublish(pool)` | :1632 | ⏳ 待迁移 | P2 | 每日发布调度，内容流水线子系统 |
| 22 | `routeDailyReport(pool)` | :1637 | ⏳ 待迁移 | P2 | 每日内容日报，内容流水线子系统 |
| 23 | `generateWeeklyReport(pool)` | :1643 | ⏳ 待迁移 | P2 | 每周内容周报，内容流水线子系统 |
| 24 | `monitorPublishQueue(pool)` | :1647 | ⏳ 待迁移 | P2 | 发布队列监控（重试 failed），内容流水线子系统 |
| 25 | `schedulePostPublishCollection(pool)` | :1651 | ⏳ 待迁移 | P2 | 发布后数据回收（4h 后采集），内容流水线子系统 |
| 26 | `syncSocialMediaData(pool)` | :1655 | ⏳ 待迁移 | P2 | social_media_raw → content_analytics 同步，数据层 |
| 27 | `scheduleDailyScrape(pool)` | :1659 | ⏳ 待迁移 | P2 | 每日全平台采集调度，采集子系统 |
| 28 | `scheduleKR3ProgressReport(pool)` | :1663 | ⏳ 待迁移 | P2 | KR3 每日进度报告，OKR 度量回写 |
| 29 | `calculateKR3Progress(pool)` | :1667 | ⏳ 待迁移 | P2 | KR3 进度回写（修 25% 陈旧数据），OKR 度量回写 |
| 30 | `updatePublishSuccessKRs(pool)` | :1671 | ⏳ 待迁移 | P2 | KR1/KR2 发布成功率回写，OKR 度量回写 |
| 31 | `runDailySmoke(pool)` | :1675 | ⏳ 待迁移 | P2 | 每日真业务 E2E smoke（防生产腐蚀），质量巡检类 |
| 32 | `runSuggestionCycle(pool)` | :1680 | ⏳ 待迁移 | P3 | 欲望解堵循环（desires→suggestions），意识层 |
| 33 | `runConversationConsolidator()` | :1686 | 🗑 建议废弃（重复） | — | **与 server.js:782 Conversation Consolidator 活 loop 重复**（同一函数 conversation-consolidator.js，5min 已在跑）；此死调用直接删 |
| 34 | `memorySyncIfNeeded(pool)` | :1691 | ⏳ 待迁移 | P2 | auto-memory 同步（memory/*.md → design_docs/decisions，30min） |
| 35 | `runCredentialsHealthCheck(pool)` | :1695 | ⏳ 待迁移 | P2 | 凭据健康巡检（每日），运维巡检类 |
| 36 | `scheduleDailyBackup(pool)` | :1699 | ⏳ 待迁移 | P2 | 每日 DB 备份调度（幂等），运维巡检类 |
| 37 | `runSkillDriftPatrol(pool)` | :1704 | ⏳ 待迁移 | P2 | skill-drift 巡检（每日），质量巡检类 |
| 38 | `runTestLifecyclePatrol(pool)` | :1710 | ⏳ 待迁移 | P2 | test 生命周期巡检（孤儿 test 告警），质量巡检类 |
| 39 | `runDesireSystem(pool)` | :1721 | ⏳ 待迁移 | P3 | 欲望系统（六层主动意识），意识循环核心，随军师上岗重整 |
| 40 | `triggerCodeQualityScan(pool)` | :1731 | ⏳ 待迁移 | P2 | 代码质量扫描（每日首 tick），质量巡检类 |

## 二、汇总

| 处置 | 条数 | 说明 |
|------|------|------|
| ✅ 已迁移（本 PR） | 4 | arch-review / strategy-trigger / conversation-digest / capture-digestion |
| 🗑 建议废弃 | 4 | rumination（已有活触发）+ 3 个与 server.js 现存活 loop 重复（consolidation / evolution-scanner / conversation-consolidator） |
| ⏳ 待迁移 P1 后续 | 1 | triggerDailyReview（code_review 调度） |
| ⏳ 待迁移 P2 | 25 | 内容流水线 / OKR 度量回写 / 各类质量·运维巡检 / 战报体系（diary·48h）/ alerting flush |
| ⏳ 待迁移 P3 | 6 | 意识循环与记忆合成（dept-heartbeat / narrative / self-report / synthesis / feedDaily / desireSystem / suggestionCycle）——待军师上岗后随意识循环重整 |

> P3 计 7 项（含 dept-heartbeat），上表 P3=6 为 10.x 段内计数，dept-heartbeat 在段外（:1524）；两处相加 = 40 条全覆盖。
>
> **迁移原则**：⏳ 项迁移时统一走 `scheduler-jobs.js` 注册表模式（声明式 job + 模块自 gate + 哨兵观测），
> 不再挂回 executeTick。🗑 项在对应期的清理 PR 里连同 executeTick 死代码一并移除；移除前必须确认活 loop 仍在跑。
