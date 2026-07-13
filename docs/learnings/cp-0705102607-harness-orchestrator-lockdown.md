## harness_initiative 点火路径隔离：废弃 LangGraph 图隐式兜底（2026-07-05）

给 `packages/brain/src/executor.js` 的 `_driveHarnessInitiative` 加硬校验：`payload.orchestrator !== 'skill-relay'` 时立即 terminal failed，不再默认降级走 LangGraph 图路径。落实 2026-07-04 主理人拍板：全面转向单 session skill-relay 接力（实测 3/3~4/4 merged vs 旧图 30 天基线 21.7% 成功率）。

### 根本原因

两条历史遗留问题被这次改动暴露：

1. **隐式默认路径的设计隐患**：`orchestrator` 字段缺省时代码 fallthrough 到已验证更差的 LangGraph 图，不报错、不提醒，任何调用方忘记带 flag 就悄悄退化。硬校验把这个隐式行为变成显式拒绝。

2. **`tasks.custom_props` 列从未被真正迁移过**：`markInitiativeTerminalFailed`（本次硬校验 + 既有 `MAX_INITIATIVE_FRESH_STARTS` 保护共用）执行的 `UPDATE tasks SET ... custom_props = jsonb_set(...)` 引用了一个 `packages/brain/migrations/` 里从未添加到 `tasks` 表的列（只有 `okr_initiatives` 有）。这个 bug 自该保护逻辑引入以来一直存在，因为：a) 单测全部 mock DB，从未真正打到 Postgres；b) 函数自身 `try/catch` 把这个 SQL 报错静默吞掉（`console.warn`，non-fatal），c) 本地开发库 `cecelia`（非 CI 用的 `cecelia_test`）不知何时被人手动 ALTER 过，掩盖了这个缺口——本地跑测试"看起来正常"，CI 从零建库才真正暴露。是本次新增的 `harness-orchestrator-lockdown-smoke.sh`（为满足 `lint-feature-has-smoke` 门禁而写的真环境验证脚本）第一次在真实 Postgres 上跑到这条代码，才抓到。

### 次生发现（未修复，已建 Issue 跟踪）

skill-relay 路径自己的重试保护（`harness-relay-watchdog.js`，`MAX_RELAY_ATTEMPTS=5`）计数方式和被废弃的 `MAX_INITIATIVE_FRESH_STARTS`（`execution_attempts`，无条件递增覆盖所有失败场景）不等价——relay-watchdog 只统计 spawn 成功的尝试（`initiative_runs` INSERT），早期 spawn 失败（账号 401、docker 起不来）完全不计数，可能无限重跑不收敛。已记录 Notion Issue `1ea53e09-b088-4d2a-b03a-ad8c976bbc6c`，本次不修复。

### 下次预防

- [ ] 涉及"缺省行为 vs 显式声明"的双轨设计，观察期结束后应主动排期删除旧路径代码，不要无限期"保留观察"——本次已用 eslint-disable + 归属注释标注死代码位置，方便后续清理。
- [ ] 任何 `UPDATE`/`INSERT` 语句引用的列，若相关单测全部 mock 掉 DB 层，必须至少有一个真环境（real Postgres）的 smoke/integration test 覆盖，否则 schema drift 类 bug 会长期潜伏；`lint-feature-has-smoke` 这类"feat + brain/src 改动必须配 smoke.sh"门禁本身就是为了堵这个洞，这次生效了。
- [ ] 本地开发数据库如果被手动 ALTER 过、和 migrations/ 目录记录的 schema 不一致，会让本地测试"骗过"开发者——本地库应定期用 `node src/migrate.js` 从 CI 同款干净库重建校验一次，而不是长期依赖历史累积状态。
- [ ] 本次 session 期间该 worktree 目录被外部进程反复删除 5 次（每次都在 push/跑长测试期间），已排除 janitor.sh（该脚本不存在，cron 一直报错）和 QuickCheck 自身互斥锁的嫌疑，怀疑与同时段另一个并发 Claude session 有关，具体机制未查明——需要单独立案排查，避免以后长任务反复因此中断重建。
- [ ] PR 分支被主分支持续反超导致 `mergeable_state=behind` 时，用 `gh pr update-branch`，不要本地 rebase 抢占公共 worker（`feedback_pr_stuck_behind_churn` 已有此教训，本次再次验证有效）。
