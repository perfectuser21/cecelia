# Sprint PRD: disk-guard

**TASK_ID**: ba6fe51c-0948-48da-8889-beb1aa14ede8
**Sprint**: 07171630-disk-guard
**Date**: 2026-07-17
**target_environment**: local_api

---

## 背景

Brain 容器运行时缺乏磁盘空间监控，高水位时无告警也无自动清理，导致磁盘满引发服务崩溃。同时，已终态任务的 harness worktree 目录长期堆积，进一步消耗磁盘。

---

## Invariant 约束

| ID | 规则 | 违反后果 |
|----|------|----------|
| INV-01 | **fail-open**：worktree 归属不确定（taskId 无法匹配到已知任务、或任务状态非终态）时绝不删除。防第 6 次误杀。 | 回归测试必覆盖 in_progress worktree 不被删除 |
| INV-02 | **先写 failing test**：disk-guard 模块和 worktree-reaper 扩展必须先有 failing test，再写实现。CI 验证 red→green。 | 违反直接拒绝合并 |
| INV-03 | **日志必出**：每轮 disk-guard 执行必打 `[disk_check] used=X% action=Y` 日志，无论是否触发清理。静默失败零容忍。 | 生产容器内必须能 grep 到该日志 |
| INV-04 | **清理序列固定**：≥85% 触发清理时，顺序严格为：① docker container prune（24h+）② docker builder prune ③ harness worktrees（终态超24h）④ npm/homebrew 缓存。不可乱序。 | 序列单测断言顺序 |

---

## 累积 FR

### FR-01：磁盘哨兵 Job（disk-guard）

- **位置**：新文件 `packages/brain/src/cron/disk-guard.js`，注册到 `packages/brain/src/scheduler-jobs.js` JOBS 数组
- **节拍**：15min 自 gate（参考 launchd-patrol.js 模式：`lastRunAt + INTERVAL_MS`）
- **检测**：宿主机逃逸（SSH 到宿主，与 launchd-patrol 同模式）执行 `df /System/Volumes/Data`，取使用率百分比
- **级别判定**：
  - `< 80%`：仅打 `[disk_check] used=X% action=none` 日志，无操作
  - `≥ 80%`：打警戒日志 + 发飞书告警（INFO 级）
  - `≥ 85%`：触发清理序列（见 INV-04），清后复测 df
  - 清后仍 `≥ 90%`：发 Bark 推送给主理人
- **导出**：`runDiskGuard()` 供测试直接调用；`__resetDiskGuardForTest()` 重置 lastRunAt
- **失败处理**：任何步骤抛错必须 catch 并打 `[disk_check] error=...` 日志，不得吞掉

### FR-02：scheduler-jobs 注册

- 在 `packages/brain/src/scheduler-jobs.js` JOBS 数组新增条目
- name: `disk-guard`，handler: `runDiskGuard`，timeoutMs: `120_000`，needsPool: `false`

### FR-03：worktree-reaper 扩展

- **位置**：在 `packages/brain/src/janitor.js` REGISTRY 中新增 `worktree-reaper` job（或新文件 `packages/brain/src/cron/worktree-reaper.js` 在 janitor REGISTRY 引用）
- **逻辑**：
  1. 枚举 `<base_repo>/.claude/worktrees/harness-v2/` 下所有 `task-<short8>` 目录
  2. 从目录名提取 short taskId，查 Brain DB（`/api/brain/tasks?id_prefix=<short>`）
  3. 任务状态为 `completed / failed / archived` 且 `updated_at` 超过 24h → 删除整目录
  4. 任务状态为 `in_progress / pending`，或查不到记录 → **绝对跳过**（INV-01）
  5. 每次清理打 `[worktree_reap] task=<short> status=<status> action=deleted|skipped` 日志
- **函数**：`runWorktreeReaper()` 供测试调用

---

## NFR

| 维度 | 要求 |
|------|------|
| 性能 | disk-guard 单轮执行（含宿主 SSH + df）< 30s，不阻塞 tick loop |
| 可靠性 | 任何单步失败不影响后续步骤（try/catch 隔离每个清理阶段） |
| 可测试性 | df 输出、docker 命令、Brain DB 查询均可通过 jest mock 覆盖 |
| 回归防护 | in_progress worktree 不被删除的测试永久留在 CI（regression test，不可删） |
| 日志可观测 | 生产容器内 `grep "\[disk_check\]"` 必须有输出（验收条件） |

---

## 测试矩阵（先写 failing，再实现）

| 测试 ID | 场景 | 断言 |
|---------|------|------|
| T-01 | mock df 返回 87% | 清理序列按 INV-04 顺序全部调用；日志含 `[disk_check] used=87%` |
| T-02 | mock df 返回 75% | 无清理调用；日志含 `action=none` |
| T-03 | mock df 返回 82% | 飞书告警触发；无清理 |
| T-04 | mock df 返回 91%（清后仍高） | Bark 推送触发 |
| T-05 | 终态任务 worktree，updated_at 超 25h | 目录被删除 |
| T-06 | in_progress 任务 worktree | 目录绝对不删（回归，防第 6 次误杀）|
| T-07 | worktree 目录名无法匹配任何 task | 跳过，不删 |
| T-08 | scheduler-jobs 含 disk-guard 条目 | name/timeoutMs 断言 |

---

## 实现文件清单

```
packages/brain/src/cron/disk-guard.js          # 新建
packages/brain/src/cron/worktree-reaper.js     # 新建
packages/brain/src/scheduler-jobs.js           # 追加 disk-guard job
packages/brain/src/janitor.js                  # REGISTRY 追加 worktree-reaper
packages/brain/tests/disk-guard.test.js        # 新建（failing first）
packages/brain/tests/worktree-reaper.test.js   # 新建（failing first）
```

---

## 验收条件

1. 所有 T-01 ~ T-08 测试 green
2. 生产容器内手动触发一轮，`docker logs <brain>` 中能 grep 到 `[disk_check] used=X% action=Y`
3. CI（brain-ci.yml）全绿
4. in_progress worktree 回归测试永久保留在 CI

---

journey_type: local-backend
target_environment: local_api
