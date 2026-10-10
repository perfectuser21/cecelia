## Brain {VERSION} — coding harness：全链计费 + 合并后交付复盘落库

- 决策 a1fdbc51 审计 P2 #35（旧 controller「cost 诚实」）：以前只有合同对抗和 QA 评估会话计费，spec/build/CI 预检修复/verify/CI 修复/QA 修复都漏了。
  - `runClaude` 没指定输出格式时统一补 `--output-format json`（真 claude 实测：末尾一行 result 事件带 total_cost_usd），返回 `cost_usd`。
  - 各活动把会话花费写进 `metrics.cost_usd`（失败也计），执行器回执汇总后写入 `result.runner.cost_usd`。
  - QA 门（evaluate + qa-fix）和 CI 修复的花费累加进各自状态（随 #6192 同步进 Brain）。
  - 合并时写 `result.cost_usd = {chain, qa, ci_fix, total}`。
- 审计 P2 #22（旧 report 6.5/6.8）：合并门合并后，用这次的真实记录拼交付复盘（合同对抗轮数与结论、真人 QA 各轮结论、CI 修复的检查与结果、撤销批准、强制通过时仍开着的问题、总花费），POST `/api/brain/learnings-received`，带 task_id，不传 issues_found（免得自动建 fix 任务）。
- 判为不适用：
  - #15 api/db registry 是扫描生成的照相表，没有 planned→done；
  - #20 blast-radius 只有读接口；
  - #21 staging-e2e 只服务旧 harness，coding workflow 已有预览环境 + 真人 QA；
  - #23 journey_features 翻牌已退役，现行改为 spans 驱动；
  - #24 / #26 spans 需要 coding workflow 活动先登记 activity uuid，另行决定。
