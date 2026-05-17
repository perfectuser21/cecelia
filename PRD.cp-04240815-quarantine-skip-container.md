# PRD: quarantine 扩展 skip-active 守卫至 docker container

**分支**：cp-04240815-quarantine-skip-container
**日期**：2026-04-24

## 背景

PR #2570 在 `handleTaskFailure` 入口加了 `hasActiveCheckpoint(taskId)` 守卫，让活跃任务不被 shepherd 误判 `quarantined: repeated_failure`。但此守卫只覆盖走 LangGraph 的 **GAN 类任务**（harness_contract_propose / harness_contract_review 等，会写 `checkpoints` 表）。

**Generator 类任务（harness_task / content-pipeline）不走 LangGraph**，直接在 docker 容器里跑 Claude Code，不写 checkpoints。今晚真机 Initiative `2303a935` 的 ws1-4 Generator 任务被 shepherd 打 `quarantined: repeated_failure`，就是因为 #2570 的守卫对 Generator 不生效。

## 根因

`hasActiveCheckpoint` 只查 `checkpoints` 表，覆盖面不足：

| 任务类型 | 执行路径 | 写 checkpoints？ | #2570 守卫是否生效 |
|---|---|---|---|
| harness_contract_propose/review | LangGraph | 是 | 是 |
| harness_task（Generator） | docker + Claude Code | 否 | **否** |
| content-pipeline | docker + Claude Code | 否 | **否** |

## 修复范围

在 `handleTaskFailure` 的 checkpoint 守卫**之后**再加一条 docker container 守卫：

- 新增 `hasActiveContainer(taskId)`：用 `docker ps --format '{{.Names}}'` 精确匹配容器名 `cecelia-task-<taskId 前 12 位 hex>`
- 命中 → 返回 `{ quarantined: false, skipped_active: true, reason: 'active_container' }`，不计失败、不隔离
- docker 不可达 / 超时（3s）→ 保守返回 false，按原逻辑继续

容器名约定示例：task `33b37ea3-4b3c-4a9a-bb40-...` → container `cecelia-task-33b37ea34b3c`。

## 成功标准

1. 新测试 `quarantine-skip-active-container.test.js` 验证 `hasActiveContainer` 三种分支（命中/不命中/docker 异常）均正确
2. handleTaskFailure 对活跃容器任务返回 `{ skipped_active: true, reason: 'active_container' }` 且不写 tasks 表
3. checkpoint 守卫命中时不会继续查 docker（顺序正确）
4. 既有 quarantine 测试（checkpoint 守卫、block、billing-pause 等）全部不回归
