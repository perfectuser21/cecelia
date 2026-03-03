# Changelog

All notable changes to this project will be documented in this file.

## [1.175.4] - 2026-03-04

### Fixed
- **quarantine**: 修复 releaseTask 未恢复任务原有字段的问题（priority/assignee/queued_at）
- **quarantine**: 添加 getActiveQuarantineTasks 函数，返回所有需要处理的隔离任务
- **quarantine**: 修复隔离信息中缺少 previous_* 字段导致释放后任务无法正常派发
