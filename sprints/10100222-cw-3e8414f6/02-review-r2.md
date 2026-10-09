---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 8
可执行: 9

核对结论：`status.js:284-327` 现状与规格描述一致（`parseInt(...) || 100`、status 原样入参、catch 带 `details`）；`TASK_STATUSES`（`lib/task-status-transitions.js:52`）含 queued/in_progress/completed/quarantined，Q-1/Q-6 的期望可成立；`tick-recovery.js:197` 的启动日志确为 `CECELIA_TICK_HARD_OFF=1 — env 硬关（staging 隔离）`，Q-1 前提可观测；全仓库对 `/api/brain/tasks` 传的 limit 没有超过 1000 的（`limit=2000` 均为 `/tasks/projects` 等其它路由），上限 1000 不会误伤现有调用方。

## 上轮问题
- R-1: 关闭 —— S-1 已定死 `MAX_TASK_LIST_LIMIT = 1000`、超上限一律 400 不钳制，单测含 `1001`/`99999999999999999999`/`1000` 边界；S-2 把 `status.js:325` 的 catch 去掉 `details` 并加 mock 抛错 → 500 无 `details` 用例；Q-3 已加超大 limit 用例，期望 400 且无 "bigint out of range"。
- R-2: 关闭 —— Q-1 前提已加 `CECELIA_TICK_HARD_OFF=1` 并要求看到对应启动日志（与 `tick-recovery.js:197` 实际文案吻合），其余 Q-n 继承；Q-7 改为 main 分支 5298 端口同库同配置起基线、diff 两端 id 列表，QA 可实际操作。

### R-3
针对: Q-6, I-3
严重度: 建议
场景: QA 用的测试库里恰好有几条 quarantined 任务，按 Q-6 请求 `?status=quarantined&limit=3` 拿到 200 + 3 条数据，与期望「返回 `[]`」不符，QA 会误判为失败。
依据: Q-6 前提只写「同 Q-1」，没有要求先确认该状态在测试库中无数据；cecelia_test 测试库的数据不受本任务控制。
说明: Q-6 操作前先 `?status=quarantined` 确认为空，或改选一个先查确认无数据的合法状态；期望可放宽为「HTTP 200 数组，所有元素 status 为该值（无数据时为 `[]`），不返回 400」。
