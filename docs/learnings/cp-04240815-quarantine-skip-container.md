# Learning: quarantine 扩展 skip-active 守卫至 docker container

**分支**：cp-04240815-quarantine-skip-container
**日期**：2026-04-24

## 现象

PR #2570 上线后，真机 Initiative `2303a935-3082-41d9-895e-42551b1c5cc4` 的 ws1-4 Generator 类任务仍然被 shepherd 标记 `status='quarantined'`、`reason='repeated_failure'`，手动 reset 多次仍复发。

## 根本原因

PR #2570 的 `hasActiveCheckpoint(taskId)` 守卫**只覆盖走 LangGraph 的 GAN 类任务**（`harness_contract_propose` / `harness_contract_review` 等，会写 `checkpoints` 表）。

Generator 类任务的执行路径不一样：

| 任务类型 | 执行路径 | 写 checkpoints？ | #2570 守卫 |
|---|---|---|---|
| harness_contract_propose/review | LangGraph | 是 | 生效 |
| harness_task（Generator） | docker + Claude Code | 否 | **失效** |
| content-pipeline | docker + Claude Code | 否 | **失效** |

换言之：Initiative 的 harness_task 是用 docker run 起一个 `cecelia-task-<hex>` 容器跑 Claude Code，从头到尾不碰 LangGraph，checkpoints 表无该 task 行。`hasActiveCheckpoint` 返回 false → 进入原 failure 累加 → 很快 quarantine。

## 修复

在 `handleTaskFailure` 的 checkpoint 守卫**之后**再串联一个 docker container 守卫：

```js
// 1/2: LangGraph checkpoint 守卫（PR #2570）
if (await hasActiveCheckpoint(taskId)) {
  return { quarantined: false, skipped_active: true, reason: 'active_checkpoint', ... };
}

// 2/2: docker container 守卫（本 PR）
if (await hasActiveContainer(taskId)) {
  return { quarantined: false, skipped_active: true, reason: 'active_container', ... };
}
```

`hasActiveContainer` 用 `execFile('docker', ['ps', '--format', '{{.Names}}'], { timeout: 3000 })` 列出所有活跃容器名，**精确匹配** `cecelia-task-<taskId 前 12 位 hex，无 dash>`。

- 命中 → skipped_active=true
- 未命中 / docker 不可达 / 超时 / docker 命令缺失 → false（保守走原 failure 逻辑）

## 下次预防

- [ ] 活跃信号源目前已有两个（checkpoints 表 / docker ps），未来若再加（run_events.heartbeat_ts / executor registry / etc.）应抽统一的 `hasAnyActiveSignal(taskId)` 接口，串在守卫里
- [ ] 容器命名约定 `cecelia-task-<12 位 hex>` 是 executor 写死的，需要和 executor 保持同步；若改名要同步改 `hasActiveContainer`
- [ ] shepherd PR tick 路径（gh CLI 扫 PR）目前不走 `handleTaskFailure`，若未来它也会触发 quarantine，需要复用同一 helper
- [ ] `execFile` 超时 3s 是经验值：生产 docker daemon 健康时 <100ms；不健康时我们宁可 timeout 走 false 也不能阻塞 tick loop

## 涉及文件

- `packages/brain/src/quarantine.js`（加 `hasActiveContainer` + 在 `handleTaskFailure` 挂载第二道守卫）
- `packages/brain/src/__tests__/quarantine-skip-active-container.test.js`（新测试，9 项）
