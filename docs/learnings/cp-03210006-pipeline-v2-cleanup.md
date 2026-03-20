# Learning: Pipeline v2 最终清理

## 背景

Pipeline v2（4-Stage）上线后，4 个旧 Skill 目录残留，旧编号引用散布在多个文件中。

### 根本原因

Pipeline v2 重构时只添加了新 Skill/Gate，未同时删除旧 Skill 目录和更新引用。
测试也未同步更新字段名（code_review_task_id → code_review_gate_task_id），导致 main 上 3 个测试持续失败。

### 下次预防

- [ ] 重构任务的 DoD 必须包含"删除旧实现"条目
- [ ] 字段名重命名时全局搜索测试文件中的旧名引用
- [ ] generate-feedback-report 测试使用绝对路径避免 vitest CWD 不一致
