## 晨报/日报「业务断言红灯」行——探针 FAIL 回执消费出口（2026-09-26）

任务 4ff8ad43 · 决策 702949b6 / ebcbc038 · PR #5588 · 链 bf5088a3 棒4

### 根本原因

棒3a 探针把 PASS/FAIL 回执写进 `journey_assertion_receipts` 后，没有任何消费者读它：晨报/日报只有裸跑、skill 绑定、skill 分发、rescan 停滞四行，业务断言失败会静静躺在表里。回执按 `journey_step_link_id` 挂步骤，取路名/步名要经 `journey_step_links → journey_steps / journeys` 三表 JOIN，这个形状之前没有人在报表层查过。

### 做法

- 沿棒 7/8 的 lib 形状：一份 `readXxxState(pool)`（best-effort，异常→null）+ `renderXxxLine`（晨报）+ `renderXxxSection`（日报），晨报/日报只接线不写逻辑。
- 分级判据放在 SQL 聚合里（`BOOL_OR(severity='error')`），JS 只做 error→RED / 否则 AMBER；severity 缺失按 warn（宁低不高，仍出行可见）。
- 只依赖回执表形状，单测/smoke 全用假 pool；不改 migration 374 的 `executor_kind` CHECK（棒3a 放开前生产查询自然空集，不误报）。

### 下次预防

- [ ] 任何新回执/账本表落地时，同一棒或紧接一棒必须配「消费出口」（晨报一行/日报板块），否则只写不读=没发生。
- [ ] 报表行新增一律走 `lib/<name>-report.js` 三件套 + 晨报/日报接线 + smoke readFileSync 查接线，别把 SQL 写进晨报/日报文件。
- [ ] worktree 里 `packages/brain` 没 node_modules 时先 `npm ci`；`check-dod-mapping.cjs` 需 `NODE_PATH=$(npm root -g)` 才找得到 js-yaml。
- [ ] Bash 重定向写 `packages/` 会被 bash-guard 拦（按主目录分支判定），登记 allowlist 之类的小改用 Edit 工具。
