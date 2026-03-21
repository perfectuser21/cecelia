# Learning: stop-dev.sh fallback 死锁修复

## 背景
stop-dev.sh 的 fallback 路径（devloop-check.sh 未加载时使用）存在两个死锁风险，
与 devloop-check.sh 已修复的问题（PR #1294）同源但未同步修复。

### 根本原因
1. fallback 路径 PR 合并失败使用 `exit 1`（进程终止），而非 `exit 2`（重试）
2. fallback 路径的 code_review_gate 检查无超时保护，Codex 不响应时永久阻塞

这两个问题在 devloop-check.sh 主路径中已修复，但 stop-dev.sh 中的旧内联逻辑（fallback）未同步。

### 下次预防
- [ ] 修复一个路径的逻辑时，grep 全仓库搜索同类代码（fallback/备份路径）
- [ ] 对 exit code 语义建立约定文档：exit 0=成功, exit 1=致命错误, exit 2=可重试
- [ ] code_review_gate 类外部依赖检查必须有超时兜底
