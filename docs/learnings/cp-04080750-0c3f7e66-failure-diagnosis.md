# Learning: 262失败样本根因诊断 — Rescue 风暴根因

**分支**: cp-04080750-0c3f7e66-e694-4fda-90b4-c3fcd7
**日期**: 2026-04-08

---

### 根本原因

Pipeline Patrol 的去重检查（dedup）只检查**已结束**（quarantined/completed/cancelled）状态的 rescue 任务，忽略了 `queued` 和 `in_progress` 状态的任务。

当 account3 认证全面失败时（401错误），rescue 任务在 `queued → in_progress → quarantined` 的整个生命周期内（约1-5分钟），下一个 patrol tick（每5分钟）检测到 `.dev-mode` 文件仍存在，认为没有活跃的 rescue 任务，于是创建新的 rescue 任务。这导致单个 PR 在35小时内积累了最多50次失败（cp-04062246-fix-eslint-hard-gate）。

现有的 `MAX_RESCUE_QUARANTINE = 3`（quarantined 封顶）在极端情况下无法快速触发，因为每次 rescue 任务都需要先经过 watchdog liveness_dead 流程（约3分钟）才被标记为 quarantined。在下一个 patrol tick 来临时，新的 rescue 任务已经创建。

### 下次预防

- [x] 新增 `MAX_RESCUE_PER_BRANCH = 5` 常量：检查同一分支**所有状态**的 rescue 任务总数，超限后立即标记 cleanup_done 并停止创建
- [x] rescue 风暴检查在 quarantine_cap 检查之前执行（更早触发）
- [x] 日志标记为 "rescue storm" 便于后续检索
- [ ] 后续优化：account 健康检查 — 连续 N 次 401 → 暂停向该 account 派任务（目前无此机制）
- [ ] 后续优化：rescue 任务支持 account 轮换，不只用 account3（account3 = 西安唯一账号）
