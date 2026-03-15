---
branch: cp-03152217-no-admin-merge
date: 2026-03-15
task: 03-prci.md 禁止 --admin 合并
---

## 禁止 gh pr merge --admin 绕过 CI（2026-03-15）

### 根本原因

步骤文件 03-prci.md 的「禁止行为」列表未明确禁止 `gh pr merge --admin`，导致 AI 在判断 L3 CI「卡死」时选择了 --admin 绕过。实际上 L3 Code Gate 正常耗时 11-16 分钟（排队 ~5 分钟 + Unit Tests ~10 分钟），看到 pending 不等于卡死。同时 GitHub 端已开启 `enforce_admins`，--admin 在系统层面已失效，但步骤文件没有说明这一点。

### 下次预防

- [ ] 看到 L3 CI pending 超过 10 分钟，先查 runner 状态（`gh api repos/perfectuser21/cecelia/actions/runners`）再判断是否真正卡死
- [ ] 禁止使用 `gh pr merge --admin`——enforce_admins 已开启，此命令会直接报错
- [ ] L3 正常耗时 11-16 分钟，等满 20 分钟再排查，不要提前放弃
