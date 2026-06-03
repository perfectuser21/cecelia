# Learning：harness 全局并发上限（OPEN-1 OOM 防线）

- 分支：cp-06031141-harness-concurrency-cap
- Brain task：71532c4c-b3ad-46d2-9a71-163d412c3c7b
- 日期：2026-06-03

## 现象

harness pipeline「一跑就跑挂」。失败审计统计：真 OOM `exit=137` 15 thread、通用 `exit 1` 12 thread。
checkpoint error 通道实证 OOM 发生在 `node:planner` / `node:gan`，多条 thread 并发时尤甚。

## 根本原因

1. **并发叠加撑爆 VM**：OrbStack VM 仅 ~13.6GB（`docker info MemTotal=13644607488`）。harness 的
   `planner` / GAN(`proposer`/`reviewer`) 是 `pipeline-heavy` 档（`--memory=2048m`，
   resource-tier.js）。`dispatcher.js` 的 initiative lock **只挡同 `project_id`** 的 harness，
   对 `null` / 跨 project 的 `harness_initiative` 没有任何全局并发上限 → 4-5 条 pipeline 并发各拉
   一个 2GB agent + brain 自身 + dev/content 任务 → 总占用超 13.6GB → docker `OOM_killed (exit=137)`。
2. **调大 --memory 不是解**：`planner`/`gan` 已观测到在 2048m 上限仍 OOM，说明单 agent 峰值本就贴近
   2GB；继续抬高每容器内存只会更快吃光 VM。正确的杠杆是**限制同时存活的 pipeline 数**。
3. **exit 1 主要是账号 auth**：近期可复检的 stdout 末行 JSON 全是 auth 类（403「org disabled
   subscription」= account3，已由 #3240 改 ACCOUNTS=['account2'] 修；以及「Not logged in」）。
   12 条历史 exit-1 thread 的容器 stdout 已被清理（claude-output 仅留最近 136 个文件），无法逐条复检。
   并发上限同时减少对唯一可用账号 account2 的并发争抢，间接缓解 auth 类 exit 1。

## 修复

`dispatcher.js` 新增全局 `harness_initiative` 并发上限（默认 `MAX_CONCURRENT_HARNESS_INITIATIVES=2`，
env 可覆盖）+ 纯判定 `harnessConcurrencyExceeded()`。在原子 claim 之前对 harness_initiative 候选查
全局 `count(*)` of in_progress；达上限则 `reason='harness_concurrency_capped'` 本 tick 不派发、下一
tick 重试，让位给非 harness 任务。dev / content 不受影响。

cap=2 依据：2 × ~2GB harness + ~2GB brain + 其他任务 ≈ 10GB，13.6GB VM 留 ~3.6GB headroom。

## 下次预防

- [ ] 改 spawn 资源档位（resource-tier.js）后，必须连带评估「同类任务并发数 × 单容器内存」对
      OrbStack VM 总量的冲击，不能只看单容器是否够用。
- [ ] 新增会 spawn 重型容器的 task_type 时，默认问一句「它有没有全局并发上限」——project-scoped
      lock 不等于全局上限。
- [ ] 依赖项：本 cap 用 in_progress 计数，stuck-in_progress 的 harness 会占满 cap。需 OPEN-5
      （存活看门狗 / abort 传播到 tasks.status=failed）配合，否则卡死任务会让 cap 永久占满。部署本
      PR 前/后须先清理 stuck in_progress harness。
- [ ] OrbStack VM 扩容后，用 env `MAX_CONCURRENT_HARNESS_INITIATIVES` 同步调大，别让 cap 成为吞吐瓶颈。
