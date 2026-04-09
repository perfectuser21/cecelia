# Learning: Harness E2E 零干预 — 3 个断链修复

## 根本原因

### SESSION_TTL 4h 导致 dispatch 停止
harness pipeline 运行 9.5h，超过 `SESSION_TTL_SECONDS = 4h`，当前 session 被标 stale → absent 模式 → budget=0 → 所有任务停止派发。4h TTL 设计初衷是清理孤儿 worktree 进程，但误伤了长时间运行的合法 session。

**修复**: 改为 24h，覆盖一整天的 pipeline 运行场景。

### harness_report 静默失败（goal_id=null）
deploy_watch task 的 goal_id/project_id 为 null（harness 任务不关联 OKR），`_createHarnessReport()` 调用 createTask 时触发 `goal_id is required` 校验。`'harness_watcher'` 不在 `systemSources` 白名单，错误被 deploy_watcher 的 catch 静默吞掉，表现为 deploy_watch=completed 但无 harness_report。

**修复**: 将 `'harness_watcher'` 加入 `isSystemTask` 的 systemSources。

### Generator pr_url 缺失导致 callback 静默失败
6 层 fallback 后 pr_url 仍 null 时直接 throw，被上层 catch 吞掉，pipeline 卡死在 harness_generate=completed/无 ci_watch 状态。

**修复**: 不 throw，改为创建 `harness_fix` 重试任务，pipeline 自愈。

## 下次预防

- [ ] harness 任务（_watcher/_ci_watch/_report 等）均无需 goal_id，应在 isSystemTask 白名单维护
- [ ] createTask 的 goal_id 校验错误应在 catch 处重新抛出或告警，避免静默吞掉
- [ ] pipeline 断链的恢复策略：能创建 retry 任务的地方优先创建，不 throw 让上层 catch 静默处理
