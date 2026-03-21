# Learning: Stage 4 成功回调 Brain + 去掉 30 次重试硬限制

**分支**: cp-03210830-stage4-callback-rescue
**日期**: 2026-03-21

### 根本原因

1. **PR 合并后 Brain 不知道任务完成**：devloop-check.sh 在 PR 合并成功后直接返回 status=merged，但从未回调 Brain 的 execution-callback 端点，导致 Brain 任务表中的任务状态永远停留在 in_progress。

2. **30 次重试硬限制过于粗暴**：stop-dev.sh 的 MAX_RETRIES=30 机制在 30 次后强制 exit 0 清理所有状态文件，这会导致正在被外部因素阻塞（如 CI 排队、Codex 审查延迟）的合法任务被错误终止。更智能的做法是让 Brain 的 Pipeline Patrol 诊断并处理。

### 下次预防

- [ ] 新增任何"自动完成"逻辑时，检查是否需要通知其他系统组件（Brain/Dashboard/调度器）
- [ ] 避免用硬编码次数作为退出条件，优先使用时间窗口 + 外部协调（Patrol/Brain）
- [ ] 测试文件需要同步更新：修改行为后搜索所有引用旧行为的测试用例
