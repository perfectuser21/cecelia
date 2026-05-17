# Learning: Harness auto-merge --auto 旗标静默失败

## 根本原因
`gh pr merge --squash --auto` 的 `--auto` 旗标需要 GitHub 仓库层面开启 "Allow auto-merge"（Settings → General → Pull Requests）。
未开启时命令 exit 0 但不执行合并，PR 状态保持 OPEN，autoMergeRequest 字段为 null。
这是 GitHub CLI 的设计：`--auto` 是"条件满足后自动合并"的排队操作，不是立即合并。

## 下次预防
- [ ] 在 harness pipeline 中直接用 `gh pr merge --squash`（去掉 --auto）
- [ ] 若需要 auto-merge 功能，先在 GitHub Settings 开启，并在代码注释中说明前提条件
- [ ] executor callback 应验证 PR state 已变为 MERGED，否则记录 warn 日志
