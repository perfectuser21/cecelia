# Learning: 认证层故障救援风暴清理

## 根本原因

auth 故障期间，同一 worktree 分支的 `pipeline_rescue` 任务反复失败，watchdog 每次都创建新的 rescue 任务，导致同一分支积累 3-7 条 quarantined 任务（救援风暴）。  
`recoverAuthQuarantinedTasks` 明确跳过 `pipeline_rescue` 类型，因此这些重复任务永久堆积在 quarantine 队列。

## 下次预防

- [ ] `cleanupDuplicateRescueTasks` 已集成进凭据恢复流程（每 30 分钟 tick 执行一次）
- [ ] auth 恢复后会自动清理同分支重复 rescue 任务，保留最新的一条
- [ ] 新建 rescue 任务时可加防重检查（同分支 in_progress/queued 任务已存在则跳过）
