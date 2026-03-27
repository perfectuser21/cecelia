# Learning: feat(dashboard) 文档+聊天分栏界面

## 根本原因

branch-protect.sh 在 packages/ 子目录开发时，要求 per-branch PRD 文件（`.prd-<branch>.md`），
而不是全局 `.prd.md`（旧任务残留文件）。同时 `.dev-mode` 需要 `tasks_created: true` 才允许写代码。
两个条件都要在第一次 Edit 之前满足。

## 下次预防

- [ ] Stage 2 开始前先检查 `.dev-mode` 有无 `tasks_created: true`，没有立即补上
- [ ] packages/ 子目录开发时，确认 per-branch PRD `.prd-<branch>.md` 存在（全局 `.prd.md` 不够）
- [ ] 分支日期超过 2 天会触发警告，属于正常提示，不影响执行
