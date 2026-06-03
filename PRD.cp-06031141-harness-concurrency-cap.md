# PRD：harness 全局并发上限（OPEN-1 OOM 防线）

## 背景

harness pipeline「一跑就跑挂」。失败审计（`docs/harness-pipeline-failure-audit-2026-06-02.md`）★最高优先级 OPEN-1：
- 真 OOM `exit=137`（15 thread）：docker 容器被 OOM killer 杀。
- 通用 `exit 1`（12 thread）：多为账号 auth 失败。

诊断结论（实测）：
- OrbStack VM 总内存约 **13.6 GB**（`docker info MemTotal=13644607488`）。
- harness 的 `planner` / GAN(`proposer`/`reviewer`) 节点是 `pipeline-heavy` 档位，单容器 `--memory=2048m`（`packages/brain/src/spawn/middleware/resource-tier.js`）。已观测到 `node:planner` / `node:gan` 在 2048m 上限仍 `OOM_killed`，说明单 agent 峰值已贴近 2GB，**继续调大 --memory 只会更快吃光 VM**。
- `dispatcher.js` 原有 initiative lock **只挡同 `project_id`** 的 harness；`null` / 跨 project 的 `harness_initiative` 没有任何全局并发上限 → 4-5 条并发各拉起一个 2GB agent + brain 自身 + dev/content 任务 → 撑爆 13.6GB VM → OOM。

## 目标

给 `harness_initiative` 加**全局并发上限**（默认 2，env 可调），从派发源头限制同时存活的 harness pipeline 数，杜绝并发叠加把 VM 撑爆。dev / content 等非 harness 任务不受影响。同时降低对唯一可用账号 account2 的并发争抢（缓解 exit 1 中的 auth 类失败）。

## 方案

`packages/brain/src/dispatcher.js`：
1. 新增常量 `MAX_CONCURRENT_HARNESS_INITIATIVES`（默认 2，`process.env` 可覆盖）。
2. 新增纯函数 `harnessConcurrencyExceeded(runningCount, max)`。
3. 在原子 claim **之前**、候选确定之后，对 `task_type==='harness_initiative'` 的候选查全局 `count(*)` of in_progress harness_initiative；达到上限则返回 `reason='harness_concurrency_capped'`，本 tick 不派发（下一 tick 重试），让位给非 harness 任务。

## 成功标准

- 已有 `MAX_CONCURRENT_HARNESS_INITIATIVES` 条 harness_initiative 处于 in_progress 时，新的 harness_initiative 候选被拒派，`reason='harness_concurrency_capped'`，不调用 executor。
- 并发数低于上限时，harness_initiative 正常派发。
- dev / 非 harness 任务完全不查并发计数、不受 cap 影响。
- 既有 dispatcher / initiative-lock 回归测试全绿。

## 非目标（依赖项）

- stuck in_progress harness 的自动收尾属 OPEN-5（存活看门狗 / abort 传播），本 PR 不处理；但需注意：若 N 条 harness 卡死在 in_progress，会占满 cap → 需 OPEN-5 + 运维清理配合。
- exit 1 中真实运行时/git bug 的逐条定位：近期可读 stdout 均为账号 auth（403 account3 已由 #3240 修 / not-logged-in），12 条历史 exit-1 thread 的 stdout 已被清理无法复检，本 PR 不另修；并发上限同时缓解 account2 争抢。
