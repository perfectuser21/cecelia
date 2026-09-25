## Brain {VERSION} — runner 原语出口：脚本步留痕 + task_runs Notion 投影 + 晨报/日报裸跑 AMBER（链 bf5088a3 棒1·出口 B，任务 66db3dfb）

- 脚本步 run：`notion-push-sync` 的 ssh 直派（采收线「金诺采收·直驾」样板，source=`ssh-workflow`）与 OpenClaw webhook 派发（source=`openclaw-webhook`）入账后经 `startRun` 落一行 running；`reapSshWorkflowRuns` 读 `.exit` 补终态（0→success，非 0→failed，SQL 判超 6h→timeout，探不到 exit 且未超时保持 running，绝不伪造）；`syncOpenClawRuns` 随 ops_runs 终态补齐
- `pushTaskRuns` 投影面：库在 `notion_projection_map` 登记为 push+active 才推（未登记=占位 pending_vessel，整块 flag-off 安全跳过）；推前按 `OPS_DB_PROPS.task_runs` 缺列即补；走统一引擎、失败只记日志不抛，DB 为真相源；`runNotionPushSync` 与运行舱入口 `runOpsNotionPush` 均接线（吞错壳，不连坐）
- 晨报：`daily-report-generator` 新增 `renderBareRunSection`，`generateDailyReport` 调 `findBareRuns` 喂它，日报出现「裸跑检测」板块与 `🟡 AMBER` 裸跑行（无裸跑不误报、检测失败整块省略）；`morning-cockpit-bark` Bark 晨报加 AMBER 裸跑行
- smoke `task-run-primitive-smoke.sh` 补出口接线断言
