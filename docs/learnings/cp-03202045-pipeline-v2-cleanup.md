# Learning: Pipeline v2 清理

## 任务
清理 Brain 中旧审查 task type 残留（cto_review, code_quality_review, prd_coverage_audit），
注册新的 initiative_execute task type。

### 根本原因
Pipeline v2 改造分多个 PR 完成，新的 Codex Gate 审查类型（prd_review, spec_review, code_review_gate, initiative_review）已注册，但旧类型未同步删除，导致：
1. task-router.js 中存在已废弃的路由映射
2. executor.js 中 US_ONLY_TYPES 包含已废弃类型
3. /request-cto-review API 端点仍可创建已废弃类型的任务
4. execution-callback 中审查回调硬编码为 cto_review 类型检查

### 下次预防
- [ ] 在注册新 task type 替代旧类型时，同一个 PR 中同时删除旧类型
- [ ] 使用 grep 扫描所有文件确认旧类型引用已清理完毕
- [ ] execution-callback 中的类型检查使用 Set 而非硬编码单个类型，便于扩展
- [ ] brain-manifest.generated.json 需要同步更新（容易遗漏）
