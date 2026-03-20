# Learning: dev 关联审查任务必须留在美国

## 概要
cto_review/code_quality_review/prd_coverage_audit/intent_expand 是 /dev 流程的审查步骤，需要读美国 worktree 的 diff，不能路由到西安。

### 根本原因
初始的 DEV_ONLY_TYPES 只包含 'dev'，忽略了 dev 流程里由 dispatch-now 触发的 Codex 审查任务。这些任务虽然名字不含 'dev'，但读的是美国本机的 worktree diff。

### 下次预防
- [ ] 改路由规则时，检查 devloop-check.sh 里所有被引用的 task_type
