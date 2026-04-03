## Engine 版本同步三处问题修复（2026-04-03）

### 根本原因

Engine 经历大规模重构（v13.78.x 清理 sprint → v14.0.0 CI重设计 → v14.1.x Harness v2.0），版本 bump 规则要求同步 6 个文件，但以下三处在重构过程中被遗漏：

1. `hooks/VERSION` — 仍停在 13.3.2，因 hooks 子目录有自己的 VERSION 文件，bump 时容易被忽略
2. `regression-contract.yaml` — 被某次清理 commit 误删（只留了 .bak），CI 读取此文件时若缺失会静默失败
3. `CHANGELOG.md` — 被 PR #1801 "极致精简"清空了 v13.4+ 记录，之后多次版本 bump 未补录

### 下次预防

- [ ] `check-version-sync.sh` 应覆盖 `hooks/VERSION`（当前只校验主版本 4 处）
- [ ] `regression-contract.yaml` 应加入 `.gitignore` 白名单或 CI 存在性检查，防止被误删
- [ ] Engine 版本 bump 完成后，应同步往 CHANGELOG.md 添加条目（可加入 bump checklist）
