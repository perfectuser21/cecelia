# Learning: Self-Drive 白名单修复

## 分支
`cp-03191714-selfdrive-whitelist`

### 根本原因

Self-Drive 引擎创建任务时 trigger_source='self_drive'，但 isSystemTask() 的 systemSources 白名单中没有 self_drive，导致 createTask 因缺少 goal_id 而拒绝。auto_fix 同理。

### 下次预防

- [ ] 新增会调用 createTask 的模块时，确认其 trigger_source 是否需要加入 systemSources
