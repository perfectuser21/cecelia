## Brain {VERSION} — runner 原语：一次执行 = 一行 task_runs（链 bf5088a3 棒1·地基，任务 66db3dfb）

- 新增 `lib/task-run.js`：全仓唯一写 `task_runs` 的入口——`startRun`（`ON CONFLICT (run_id) DO NOTHING`，一次执行恒一行）/ `finishRun`（`WHERE ended_at IS NULL`，已终态不覆盖，无终态回执保持 running 不伪造）/ `recordRunFromCallback` / `startRunForExecResult` / `findBareRuns` + 纯逻辑 `normalizeRunStatus` / `buildRunContext` / `buildRunResult` / `detectBareRuns`；全部 fail-open（留痕失败只 warn，不拖垮执行主链）
- 五条执行路径接线：executor 漏斗（`triggerCeceliaRun` 包装，覆盖 dispatcher / tasks 路由 / execution 路由三处调用方，internal handler 合成 run 立即成功）/ dispatcher 兜底 / openclaw-agent-executor（起时 start、收割 `.exit` 时 finish）/ `POST /execution-callback` 回执（cecelia-run、cecelia-bridge、脚本步统一出口）/ kernel `finalizeKernelRun` 终态
- dispatcher 写 `dispatch_events(dispatched)` 补传 `task_id`（此前恒为 NULL，裸跑检测无 join 键）
- 迁移 468：`task_runs` 加 `notion_id` / `notion_synced_at` / `notion_digest`（Notion 投影记账，纯 additive）
- 机械守卫 `task-run-single-writer-guard.test.js`：扫 src + scripts，除 lib/task-run.js 外任何 INSERT/UPDATE/DELETE task_runs 即红（内置违规样本 proven-to-fire）
- 二阶效应：`alertness/healing.js` 的 `quarantineProblematicTasks` 读 `task_runs.status='failed'` 三次以上隔离 queued/pending 任务，此前表为空休眠，写口上线后激活
- smoke `task-run-primitive-smoke.sh`
