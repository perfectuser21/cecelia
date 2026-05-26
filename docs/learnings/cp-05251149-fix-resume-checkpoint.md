# Learning: harness_initiative resume-checkpoint 无限循环修复

**分支**: cp-05251149-fix-resume-checkpoint  
**日期**: 2026-05-25  
**关联**: harness-initiative-resume-checkpoint-bug.md (Memory)

---

### 根本原因

`runHarnessInitiativeRouter` 在 `existing && resumeRequested` 分支直接设置 `input = null`（resume 模式），**未检查 checkpoint 是否处于 error 状态**。

Brain 重启后 `syncOrphanTasksOnStartup` 对所有 in_progress 的 `harness_initiative` 任务设置 `resume_from_checkpoint=true`，包括因节点执行失败而停留在 error 状态的 checkpoint。

触发链：
1. ganLoop 节点执行失败 → checkpoint.channel_values.error 有值
2. Brain 重启 → startup-sync 设 resume_from_checkpoint=true
3. runHarnessInitiativeRouter 看到 existing + resumeRequested → input = null
4. resume 模式立即路由到 END（因为 error 已设置）
5. final = null → task 被标 failed
6. consciousness-loop 每 2min retry → 回到步骤 3 死循环

### 修复方案

在 `input = null` 之前增加 error 状态检测：

```javascript
const ckError = existing.channel_values?.error;
if (ckError) {
  // 坏 checkpoint：升 N，fresh start，避免无限 resume→END→loop
  attemptN = baseAttemptN + 1;
  threadId = `harness-initiative:${initiativeId}:${attemptN}`;
  input = { task };
  await dbPool.query('UPDATE tasks SET execution_attempts=$1 WHERE id=$2', [attemptN, task.id]);
} else {
  input = null;  // 正常 resume
}
```

### 下次预防

- [ ] **checkpoint 续跑必须先检查 error 状态**：任何 resume-from-checkpoint 逻辑在设置 `input = null` 前，必须检查 `checkpoint.channel_values?.error`
- [ ] **startup-sync 不能盲目设 resume_from_checkpoint=true**：只对无 error 的 checkpoint 设置此 flag，或在 router 层防御（本 PR 选择 router 层防御）
- [ ] **TDD 铁律**：先写 failing test 再写 production code，本次严格遵守（commit 1 = test, commit 2 = fix）
- [ ] **每个 LangGraph resume 点都需要 error 状态检测**：这是 LangGraph checkpoint 模式的通用陷阱，凡是 resume 都需要验证 checkpoint 健康
