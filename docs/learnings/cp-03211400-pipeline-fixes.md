# Learning: Pipeline 小修复集合

分支: cp-03211400-pipeline-fixes

### 根本原因

四个独立的小 bug 积累在 pipeline 中，影响了 DevGate 可靠性：
1. Stage 1 正则只匹配无缩进的 checkbox，导致格式稍有变化就检测不到 DoD 条目
2. stop-dev.sh 的 fallback 路径（devloop-check.sh 未加载时）跳过了 code_review_gate 检查，导致未经审查的代码可以被合并
3. cleanup.sh 和 devloop-check.sh 都定义了 `_mark_cleanup_done()`，两个实现功能不同（前者额外管 step_4_ship），维护时容易遗漏同步
4. spec_review 降级时只写了 pass 标志，没记录降级事实，导致无法区分真正通过和降级跳过

### 下次预防

- [ ] 正则表达式写法应考虑输入格式的变体（缩进、空格差异）
- [ ] fallback 路径必须覆盖主路径的所有检查点，可用 checklist 对照
- [ ] 共享函数应在单一位置定义，通过 source 引用，避免重复定义导致功能漂移
- [ ] 状态降级时始终记录 degraded 标志和原因，便于事后审计
