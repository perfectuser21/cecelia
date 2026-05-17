# Learning: stop-dev.sh fallback 死锁修复

## 变更摘要
修复 stop-dev.sh fallback 路径两个死锁风险：PR 合并失败 exit 1→exit 2 + code_review_gate 15 分钟超时。

### 根本原因
devloop-check.sh 在 PR #1294 修复了死锁问题，但 stop-dev.sh 的 fallback 路径（devloop-check.sh 未加载时使用的旧内联逻辑）未同步修复，导致：
1. PR 合并失败时 exit 1 直接终止 pipeline（而非 exit 2 重试）
2. code_review_gate 检查无超时保护，Codex 永久不响应时永远阻塞

### 下次预防
- [ ] 修复主路径时，检查 fallback 路径是否有同类问题
- [ ] stop-dev.sh 的 fallback 路径应与 devloop-check.sh 保持逻辑一致
- [ ] Pipeline rescue 任务需要同时完成 Engine 版本 bump（5 个文件）才能通过 CI
