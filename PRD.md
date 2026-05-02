# PRD: brain-test-pyramid Layer 3 PR1 — OKR 任务进度反馈链路集成测试

## 目标
为 OKR→Task→KR progress 反馈链路添加集成测试，验证任务完成状态驱动 KR 进度更新的核心行为。

## 背景
recalculate-progress 是 Brain OKR 系统核心逻辑：统计 okr_initiative 下 completed 任务数更新 KR.current_value。

## 成功标准
- Task 状态变更后 progress 值正确（0/33.33/100）
- key_results.current_value 在 DB 中持久化
- 不存在的 KR → 404
