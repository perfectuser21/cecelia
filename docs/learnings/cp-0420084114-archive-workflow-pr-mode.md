# archive-workflow-pr-mode（2026-04-20）

### 根本原因

PR #2448 的 archive-learnings workflow 写成 bot 直推 main。dispatch 后归档出 297 文件，commit 成功，push 被分支保护规则（`required_status_checks: ci-passed`）拒绝。

根本误判：我以为 cleanup-merged-artifacts.yml 那种 bot 直推 main 能跑通，就照搬。实际上 cleanup-merged-artifacts 从来没有真的 push 过（regex 失配找不到文件就早退）。所以分支保护从没考验过 cleanup workflow。一旦 archive-learnings 真要 push 东西就直接撞墙。

### 下次预防

- [ ] 任何 workflow 想"直推 main"之前，必须先确认：(a) 分支保护 ruleset 是否允许 bot bypass（多数情况不允许）；(b) GITHUB_TOKEN 自带权限不足以 bypass required status checks
- [ ] bot workflow 默认走 PR + auto-merge 流程，不直推：`git push origin cp-<purpose>-<timestamp>` → `gh pr create --label harness` → 等 ci-passed → auto-merge 自动 squash
- [ ] 参考 cleanup-merged-artifacts 之类的"示例"前，先确认它真跑过 push，而不是一直处于"无需 push"的早退路径
